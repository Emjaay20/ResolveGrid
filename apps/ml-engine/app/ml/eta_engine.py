import math
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
import joblib
import numpy as np
from sklearn.linear_model import SGDRegressor
from sklearn.preprocessing import StandardScaler
from .train_champion import deterministic_eta, generate_synthetic_nigerian_telemetry

MODEL_PATH = Path(__file__).resolve().parent / "champion_model.joblib"

FEATURE_NAMES = [
    "osrm_base_duration_sec",
    "gate_delay_sec",
    "compound_walk_meters",
    "rain_mm",
    "wind_speed_kmh",
    "velocity_kmh",
    "rolling_1h_on_time_rate",
    "active_load",
]


class HybridChampionChallengerEngine:
    """
    Hybrid ETA Engine (prototype):
      1. Baseline Model: Scikit-Learn GradientBoostingRegressor fitted on 3,500
         SYNTHETIC, simulated last-mile samples (see train_champion.py). It has not
         been validated on real arrivals.
      2. Challenger Model: Streaming SGDRegressor (partial_fit) with adaptive learning
         rate and per-postcode exponential moving average (EMA) residual bias memory.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._state_path = Path(os.environ['ML_STATE_PATH']) if os.getenv('ML_STATE_PATH') else None
        self._saved_state = False
        # Unvalidated synthetic models must not drive real-world dispatch by default.
        self._experimental_eta_enabled = os.getenv("ML_ENABLE_EXPERIMENTAL_ETA", "false").lower() in {"1", "true", "yes"}
        self._seen_task_ids: set[str] = set()
        self.online_samples_learned: int = 0
        self.learning_rate: float = 0.08
        self.postcode_residual_ema: Dict[str, float] = {}
        self.recent_residuals: List[float] = []

        # 1. Load Pre-trained Champion Artifact if available
        self.champion_artifact: Optional[Dict[str, Any]] = None
        self.champion_model = None
        self.feature_importances: Dict[str, float] = {
            "osrm_base_duration_sec": 0.851,
            "rain_mm": 0.073,
            "gate_delay_sec": 0.032,
            "velocity_kmh": 0.020,
            "rolling_1h_on_time_rate": 0.019,
            "compound_walk_meters": 0.003,
            "active_load": 0.001,
            "wind_speed_kmh": 0.001,
        }
        self.val_mae: float = 26.99
        self.val_rmse: float = 36.46
        self.val_r2: float = 0.9953

        if MODEL_PATH.exists():
            try:
                self.champion_artifact = joblib.load(MODEL_PATH)
                self.champion_model = self.champion_artifact.get("model")
                self.feature_importances = self.champion_artifact.get("feature_importances", self.feature_importances)
                self.val_mae = self.champion_artifact.get("val_mae", self.val_mae)
                self.val_rmse = self.champion_artifact.get("val_rmse", self.val_rmse)
                self.val_r2 = self.champion_artifact.get("val_r2", self.val_r2)
            except Exception:
                self.champion_model = None

        # Fixed, reproducible normalization: never send unscaled durations to SGD.
        # This warm start also uses SYNTHETIC data, not real delivery outcomes.
        X_init, y_init = generate_synthetic_nigerian_telemetry(n_samples=1000, seed=314)
        self.scaler = StandardScaler().fit(X_init)
        self.sgd_challenger = SGDRegressor(
            loss="squared_error", penalty="l2", alpha=0.001,
            learning_rate="adaptive", eta0=0.005, max_iter=3000,
            tol=0.0001, random_state=42,
        )
        self.sgd_challenger.fit(self.scaler.transform(X_init), y_init)
        self._load_online_state()

    def _load_online_state(self) -> None:
        """Only read the application-owned state file; joblib must never load user uploads."""
        if self._state_path is None or not self._state_path.exists():
            return
        try:
            snapshot = joblib.load(self._state_path)
            if snapshot.get("version") != 1 or snapshot.get("features") != FEATURE_NAMES:
                return
            self.scaler = snapshot["scaler"]
            self.sgd_challenger = snapshot["model"]
            self.online_samples_learned = int(snapshot["online_samples_learned"])
            self.postcode_residual_ema = dict(snapshot["postcode_residual_ema"])
            self.recent_residuals = list(snapshot["recent_residuals"])[-100:]
            self._seen_task_ids = set(snapshot["seen_task_ids"])
            self._saved_state = True
        except Exception as exc:
            # Keep the service available; never interpret a corrupted state as verified learning.
            print(f"Warning: ignoring unreadable ML online state: {type(exc).__name__}")

    def _save_online_state(self) -> bool:
        if self._state_path is None:
            return False
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(prefix=".online-state-", suffix=".joblib", dir=self._state_path.parent)
        os.close(handle)
        try:
            os.chmod(temporary, 0o600)
            joblib.dump({
                "version": 1,
                "features": FEATURE_NAMES,
                "scaler": self.scaler,
                "model": self.sgd_challenger,
                "online_samples_learned": self.online_samples_learned,
                "postcode_residual_ema": self.postcode_residual_ema,
                "recent_residuals": self.recent_residuals[-100:],
                "seen_task_ids": sorted(self._seen_task_ids),
            }, temporary)
            os.replace(temporary, self._state_path)
            self._saved_state = True
            return True
        except OSError:
            self._saved_state = False
            return False
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _extract_feature_row(self, c: Dict[str, Any]) -> List[float]:
        return [
            float(c.get("osrm_base_duration_sec", 180)),
            float(c.get("gate_delay_sec", 45)),
            float(c.get("compound_walk_meters", 25)),
            float(c.get("rain_mm", 0.0)),
            float(c.get("wind_speed_kmh", 10.0)),
            float(c.get("velocity_kmh", 30.0)),
            float(c.get("rolling_1h_on_time_rate", 0.96)),
            float(c.get("active_load", 0)),
        ]

    def score_candidates(
        self,
        postcode: str,
        candidates: List[Dict[str, Any]],
        ml_profile: str = "logistics_eta_v1",
    ) -> Dict[str, Any]:
        t0 = time.perf_counter()
        ranked: List[Dict[str, Any]] = []
        postcode_adj = self.postcode_residual_ema.get(postcode, 0.0)

        if not candidates:
            return {
                "postcode": postcode,
                "ml_profile": ml_profile,
                "inference_latency_ms": 0.0,
                "online_samples_learned": self.online_samples_learned,
                "postcode_learned_bias_sec": round(postcode_adj, 2),
                "ranked_candidates": [],
            }

        # Vectorized feature matrix extraction
        X = np.array([self._extract_feature_row(c) for c in candidates])
        if not np.isfinite(X).all():
            raise ValueError("ETA features must be finite numeric values")

        # 1. Champion Model Predictions (GBDT Regressor)
        if self._experimental_eta_enabled and self.champion_model is not None:
            champion_preds = self.champion_model.predict(X)
        else:
            champion_preds = deterministic_eta(X)

        # 2. Challenger Model Predictions (Online Streaming SGD + Postcode Memory)
        try:
            challenger_preds = self.sgd_challenger.predict(self.scaler.transform(X)) + postcode_adj
        except Exception:
            challenger_preds = champion_preds + postcode_adj

        profile_mult = 0.88 if ml_profile == "emergency_intercept_v1" else 1.0
        challenger_blend = (
            min(0.45, 0.20 + self.online_samples_learned * 0.008)
            if self._experimental_eta_enabled else 0.0
        )

        for i, c in enumerate(candidates):
            c_eta = max(45, int(round(float(champion_preds[i]) * profile_mult)))
            ch_eta = max(45, min(86400, int(round(float(challenger_preds[i]) * profile_mult))))
            final_eta = max(45, int(round((1.0 - challenger_blend) * c_eta + challenger_blend * ch_eta)))

            osrm_dur = int(round(X[i, 0]))
            gate_delay = int(round(X[i, 1]))
            rain_penalty = int(round(X[i, 3] * 18.0 + (20.0 if X[i, 4] > 24.0 else 0.0)))

            ranked.append(
                {
                    "agent_id": c.get("agent_id"),
                    "callsign": c.get("callsign"),
                    "agent_type": c.get("agent_type", "COURIER_BIKE"),
                    "straight_distance_m": int(c.get("straight_distance_m", 1200)),
                    "road_distance_m": int(c.get("road_distance_m", 1500)),
                    "osrm_base_duration_sec": osrm_dur,
                    "gate_delay_sec": gate_delay,
                    "weather_penalty_sec": rain_penalty,
                    "champion_lgbm_eta_sec": c_eta,  # legacy compatibility field
                    "challenger_river_eta_sec": ch_eta,  # legacy compatibility field
                    "champion_gradient_boosting_eta_sec": c_eta,
                    "challenger_sgd_eta_sec": ch_eta,
                    "final_predicted_eta_sec": final_eta,
                }
            )

        ranked.sort(key=lambda x: x["final_predicted_eta_sec"])
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

        return {
            "postcode": postcode,
            "ml_profile": ml_profile,
            "prediction_mode": "EXPERIMENTAL_SYNTHETIC_ML" if self._experimental_eta_enabled else "DETERMINISTIC_BASELINE",
            "inference_latency_ms": elapsed_ms,
            "online_samples_learned": self.online_samples_learned,
            "postcode_learned_bias_sec": round(postcode_adj, 2),
            "ranked_candidates": ranked,
        }

    def learn_one(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Idempotent online learning from authenticated, task-verified arrivals."""
        t0 = time.perf_counter()
        task_id = str(payload.get("task_id", "")).strip()
        postcode = str(payload.get("postcode", "")).strip()
        actual = float(payload.get("actual_duration_sec", 0))
        predicted = float(payload.get("predicted_eta_sec", 0))
        if not task_id or not postcode or not (0 < actual <= 86400 and 0 < predicted <= 86400):
            raise ValueError("A valid task, postcode, actual and predicted duration are required")
        row = self._extract_feature_row(payload)
        if not np.isfinite(row).all():
            raise ValueError("Learning features must be finite")
        with self._lock:
            if task_id in self._seen_task_ids:
                return {"updated": False, "reason": "duplicate_task", "task_id": task_id,
                        "online_samples_learned": self.online_samples_learned}
            residual = actual - predicted
            # The scaler is fixed from baseline training to keep coefficients interpretable
            # across partial_fit calls. Refit scaler + model together in an offline release.
            sample = self.scaler.transform(np.array([row], dtype=float))
            self.sgd_challenger.partial_fit(sample, np.array([actual]))
            prev_bias = self.postcode_residual_ema.get(postcode, 0.0)
            new_bias = 0.72 * prev_bias + 0.28 * residual
            self.postcode_residual_ema[postcode] = round(new_bias, 3)
            self._seen_task_ids.add(task_id)
            self.online_samples_learned += 1
            self.recent_residuals.append(residual)
            self.recent_residuals = self.recent_residuals[-100:]
            mae = float(np.mean(np.abs(self.recent_residuals)))
            rmse = float(np.sqrt(np.mean(np.square(self.recent_residuals))))
            persisted = self._save_online_state()
            return {
                "updated": True,
                "persisted": persisted,
                "task_id": task_id,
                "postcode": postcode,
                "residual_error_sec": round(residual, 2),
                "new_postcode_bias_sec": round(new_bias, 2),
                "online_samples_learned": self.online_samples_learned,
                "rolling_mae_sec": round(mae, 2),
                "rolling_rmse_sec": round(rmse, 2),
                "update_latency_ms": round((time.perf_counter() - t0) * 1000, 3),
            }

    def get_status(self) -> Dict[str, Any]:
        # IMPORTANT: synthetic fit scores are not real delivery accuracy.
        recent_mae = float(np.mean(np.abs(self.recent_residuals))) if self.recent_residuals else None
        recent_rmse = float(np.sqrt(np.mean(np.square(self.recent_residuals)))) if self.recent_residuals else None
        return {
            "champion_model": "Synthetic-data ETA baseline (scikit-learn gradient boosting)",
            "champion_training_data": "SYNTHETIC_SIMULATION",
            "validated_on_real_arrivals": False,
            "experimental_eta_enabled": self._experimental_eta_enabled,
            "active_eta_strategy": "EXPERIMENTAL_SYNTHETIC_ML" if self._experimental_eta_enabled else "DETERMINISTIC_BASELINE",
            "synthetic_fit": {
                "r2": round(float(self.val_r2), 3),
                "mae_sec": round(float(self.val_mae), 1),
                "rmse_sec": round(float(self.val_rmse), 1),
                "note": "Synthetic holdout only; never present as real-world delivery accuracy.",
            },
            "challenger_model": "Scaled online SGDRegressor + postcode EMA",
            "online_samples_learned": self.online_samples_learned,
            "rolling_mae_sec": round(recent_mae, 2) if recent_mae is not None else None,
            "rolling_rmse_sec": round(recent_rmse, 2) if recent_rmse is not None else None,
            "online_state_persistence_configured": self._state_path is not None,
            "online_state_persisted": self._saved_state,
            "feature_importances": self.feature_importances,
            "postcode_residual_biases_sec": self.postcode_residual_ema,
        }


eta_engine = HybridChampionChallengerEngine()
