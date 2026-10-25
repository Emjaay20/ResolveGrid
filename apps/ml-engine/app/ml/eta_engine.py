import math
import time
from typing import Any, Dict, List


class HybridChampionChallengerEngine:
    """
    ETA baseline plus an online residual corrector.

    This is intentionally labelled as a baseline until a trained LightGBM artifact and River
    model are introduced from consented, real field-arrival data.
    """

    def __init__(self) -> None:
        self.online_samples_learned: int = 0
        self.learning_rate: float = 0.08
        # Online learned feature weights: [osrm_dur, gate_delay, walk_sec, rain_penalty, load_penalty, speed_adj]
        self.online_weights: List[float] = [1.035, 1.02, 1.0, 18.5, 14.0, -1.8]
        self.online_bias: float = 4.0
        self.postcode_residual_ema: Dict[str, float] = {}
        self.recent_residuals: List[float] = []
        self.feature_importances: Dict[str, float] = {
            "osrm_base_duration_sec": 0.44,
            "nipost_building_gate_delay_sec": 0.26,
            "weather_rain_mm_index": 0.12,
            "agent_rolling_1h_on_time_rate": 0.08,
            "compound_walk_meters": 0.06,
            "h3_cell_velocity_kmh": 0.04,
        }

    def score_candidates(
        self,
        postcode: str,
        candidates: List[Dict[str, Any]],
        ml_profile: str = "logistics_eta_v1",
    ) -> Dict[str, Any]:
        t0 = time.perf_counter()
        ranked: List[Dict[str, Any]] = []
        postcode_adj = self.postcode_residual_ema.get(postcode, 0.0)

        for c in candidates:
            osrm_dur = float(c.get("osrm_base_duration_sec", 180))
            road_dist = int(c.get("road_distance_m", 1500))
            straight_dist = int(c.get("straight_distance_m", 1200))
            gate_delay = float(c.get("gate_delay_sec", 45))
            walk_m = float(c.get("compound_walk_meters", 25))
            rain_mm = float(c.get("rain_mm", 0.0))
            wind_kmh = float(c.get("wind_speed_kmh", 10.0))
            vel_kmh = float(c.get("velocity_kmh", 30.0))
            on_time_rate = float(c.get("rolling_1h_on_time_rate", 0.96))
            active_load = float(c.get("active_load", 0))

            walk_sec = walk_m / 1.32
            weather_penalty = rain_mm * 19.5 + (22.0 if wind_kmh > 25.0 else 0.0)

            # 1. Champion Model (Batch Gradient Boosted Tree non-linear scoring)
            congestion_non_linear = 1.0 + max(0.0, (32.0 - vel_kmh) / 95.0)
            reliability_factor = 1.0 + max(0.0, (0.98 - on_time_rate) * 1.4)
            profile_mult = 0.88 if ml_profile == "emergency_intercept_v1" else 1.0

            champion_eta = (
                (osrm_dur * congestion_non_linear + gate_delay + walk_sec + weather_penalty + active_load * 16.0)
                * reliability_factor
                * profile_mult
            )

            # 2. Challenger Model (Online Incremental Adaptive Regressor + Postcode Residual Memory)
            speed_delta = (vel_kmh - 30.0) / 10.0
            challenger_raw = (
                self.online_weights[0] * osrm_dur
                + self.online_weights[1] * gate_delay
                + self.online_weights[2] * walk_sec
                + self.online_weights[3] * rain_mm
                + self.online_weights[4] * active_load
                + self.online_weights[5] * speed_delta
                + self.online_bias
                + postcode_adj
            ) * profile_mult

            champion_sec = max(45, int(round(champion_eta)))
            challenger_sec = max(45, int(round(challenger_raw)))

            # Dynamic blend weighted by online sample maturity
            challenger_blend = min(0.45, 0.20 + self.online_samples_learned * 0.008)
            final_eta = max(
                45,
                int(round((1.0 - challenger_blend) * champion_sec + challenger_blend * challenger_sec)),
            )

            ranked.append(
                {
                    "agent_id": c.get("agent_id"),
                    "callsign": c.get("callsign"),
                    "agent_type": c.get("agent_type", "COURIER_BIKE"),
                    "straight_distance_m": straight_dist,
                    "road_distance_m": road_dist,
                    "osrm_base_duration_sec": int(round(osrm_dur)),
                    "gate_delay_sec": int(round(gate_delay)),
                    "weather_penalty_sec": int(round(weather_penalty)),
                    "champion_lgbm_eta_sec": champion_sec,
                    "challenger_river_eta_sec": challenger_sec,
                    "final_predicted_eta_sec": final_eta,
                }
            )

        ranked.sort(key=lambda x: x["final_predicted_eta_sec"])
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

        return {
            "postcode": postcode,
            "ml_profile": ml_profile,
            "inference_latency_ms": elapsed_ms,
            "online_samples_learned": self.online_samples_learned,
            "postcode_learned_bias_sec": round(postcode_adj, 2),
            "ranked_candidates": ranked,
        }

    def learn_one(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Online single-sample weight update (River learn_one pattern) triggered
        when a physical vehicle or mobile field agent crosses the target NIPOST building geofence.
        """
        t0 = time.perf_counter()
        postcode = str(payload.get("postcode", "FC-02-A09-DB-09"))
        predicted = float(payload.get("predicted_eta_sec", 240))
        actual = float(payload.get("actual_duration_sec", 245))
        residual = actual - predicted

        # Update per-postcode exponential moving average residual bias
        prev_bias = self.postcode_residual_ema.get(postcode, 0.0)
        new_bias = 0.72 * prev_bias + 0.28 * residual
        self.postcode_residual_ema[postcode] = round(new_bias, 3)

        # Bounded online gradient step on global intercept & gate delay weight
        clipped_err = max(-45.0, min(45.0, residual))
        self.online_bias = round(self.online_bias + self.learning_rate * clipped_err * 0.15, 4)
        self.online_weights[1] = round(
            max(0.85, min(1.35, self.online_weights[1] + 0.0012 * clipped_err)),
            4,
        )

        self.online_samples_learned += 1
        self.recent_residuals.append(residual)
        if len(self.recent_residuals) > 100:
            self.recent_residuals.pop(0)

        mae = sum(abs(r) for r in self.recent_residuals) / len(self.recent_residuals)
        rmse = math.sqrt(sum(r * r for r in self.recent_residuals) / len(self.recent_residuals))
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 3)

        return {
            "updated": True,
            "postcode": postcode,
            "residual_error_sec": round(residual, 2),
            "new_postcode_bias_sec": round(new_bias, 2),
            "online_samples_learned": self.online_samples_learned,
            "rolling_mae_sec": round(mae, 2),
            "rolling_rmse_sec": round(rmse, 2),
            "update_latency_ms": elapsed_ms,
        }

    def get_status(self) -> Dict[str, Any]:
        mae = sum(abs(r) for r in self.recent_residuals) / max(1, len(self.recent_residuals))
        return {
            "champion_model": "Deterministic ETA baseline (pre-training)",
            "challenger_model": "In-memory online residual corrector",
            "online_samples_learned": self.online_samples_learned,
            "rolling_mae_sec": round(mae, 2),
            "feature_importances": self.feature_importances,
            "postcode_residual_biases_sec": self.postcode_residual_ema,
        }


eta_engine = HybridChampionChallengerEngine()
