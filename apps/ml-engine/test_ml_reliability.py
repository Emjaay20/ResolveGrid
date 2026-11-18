"""Regression tests for private ML service access and reliable online learning."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.ml.eta_engine import HybridChampionChallengerEngine


CANDIDATE = {
    "agent_id": "rider_test_1",
    "osrm_base_duration_sec": 360,
    "gate_delay_sec": 40,
    "compound_walk_meters": 25,
    "rain_mm": 4,
    "wind_speed_kmh": 12,
    "velocity_kmh": 28,
    "rolling_1h_on_time_rate": 0.95,
    "active_load": 1,
}


class MLServiceSecurityTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_missing_server_configuration_fails_closed(self):
        with patch.dict(os.environ, {"ML_SERVICE_TOKEN": ""}):
            result = self.client.post("/v1/ml/dispatch-eta", json={
                "postcode": "FC-02-A09-DB-09", "candidates": [CANDIDATE]
            })
        self.assertEqual(result.status_code, 503)

    def test_invalid_candidate_numeric_input_returns_422(self):
        with patch.dict(os.environ, {"ML_SERVICE_TOKEN": "secret-for-tests"}):
            result = self.client.post("/v1/ml/dispatch-eta",
                headers={"X-ML-Service-Token": "secret-for-tests"}, json={
                    "postcode": "FC-02-A09-DB-09",
                    "candidates": [dict(CANDIDATE, rain_mm="not-a-number")],
                })
        self.assertEqual(result.status_code, 422)

    def test_rejects_wrong_key_for_inference_and_learning(self):
        with patch.dict(os.environ, {"ML_SERVICE_TOKEN": "secret-for-tests"}):
            result = self.client.post("/v1/ml/dispatch-eta",
                headers={"X-ML-Service-Token": "wrong"}, json={
                    "postcode": "FC-02-A09-DB-09", "candidates": [CANDIDATE]
                })
            learning = self.client.post("/v1/ml/learn",
                headers={"X-ML-Service-Token": "wrong"}, json={
                    "task_id": "forged", "postcode": "FC-02-A09-DB-09",
                    "road_distance_m": 500, "osrm_base_duration_sec": 100,
                    "gate_delay_sec": 10, "predicted_eta_sec": 200, "actual_duration_sec": 220,
                })
        self.assertEqual(result.status_code, 401)
        self.assertEqual(learning.status_code, 401)

    def test_authenticated_inference_and_bounded_learning_payload(self):
        with patch.dict(os.environ, {"ML_SERVICE_TOKEN": "secret-for-tests"}):
            headers = {"X-ML-Service-Token": "secret-for-tests"}
            result = self.client.post("/v1/ml/dispatch-eta", headers=headers, json={
                "postcode": "FC-02-A09-DB-09", "candidates": [CANDIDATE]
            })
            invalid = self.client.post("/v1/ml/learn", headers=headers, json={
                "task_id": "bad-duration", "postcode": "FC-02-A09-DB-09",
                "road_distance_m": 500, "osrm_base_duration_sec": 100,
                "gate_delay_sec": 10, "predicted_eta_sec": 200, "actual_duration_sec": -100,
            })
        self.assertEqual(result.status_code, 200)
        self.assertIn("final_predicted_eta_sec", result.json()["ranked_candidates"][0])
        self.assertEqual(invalid.status_code, 422)


class OnlineLearningReliabilityTests(unittest.TestCase):
    def test_updates_are_idempotent_and_survive_restart(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "state.joblib"
            with patch.dict(os.environ, {"ML_STATE_PATH": str(path)}):
                engine = HybridChampionChallengerEngine()
                request = dict(CANDIDATE, task_id="verified-task-001",
                    postcode="FC-02-A09-DB-09", actual_duration_sec=420,
                    predicted_eta_sec=390)
                first = engine.learn_one(request)
                self.assertTrue(first["updated"])
                self.assertTrue(first["persisted"])
                self.assertEqual(engine.online_samples_learned, 1)
                self.assertTrue(path.exists())
                self.assertTrue(np.isfinite(engine.sgd_challenger.coef_).all())
                restarted = HybridChampionChallengerEngine()
                self.assertEqual(restarted.online_samples_learned, 1)
                self.assertFalse(restarted.learn_one(request)["updated"])
                self.assertEqual(restarted.online_samples_learned, 1)
                scored = restarted.score_candidates("FC-02-A09-DB-09", [CANDIDATE])
                self.assertLess(scored["ranked_candidates"][0]["final_predicted_eta_sec"], 86400)

    def test_no_real_world_accuracy_claim_before_arrival_evidence(self):
        with patch.dict(os.environ, {"ML_STATE_PATH": ""}):
            engine = HybridChampionChallengerEngine()
        status = engine.get_status()
        self.assertEqual(status["champion_training_data"], "SYNTHETIC_SIMULATION")
        self.assertFalse(status["validated_on_real_arrivals"])
        self.assertEqual(status["active_eta_strategy"], "DETERMINISTIC_BASELINE")
        self.assertFalse(status["experimental_eta_enabled"])
        self.assertIsNone(status["rolling_mae_sec"])
        self.assertIsNone(status["rolling_rmse_sec"])
        self.assertFalse(status["online_state_persistence_configured"])
        self.assertFalse(status["drift_monitoring"]["drift_alert"])
        self.assertFalse(status["promotion_gate"]["eligible_for_production_ml"])

    def test_status_endpoint_requires_token_and_reports_drift_alert(self):
        client = TestClient(app)
        with patch.dict(os.environ, {"ML_SERVICE_TOKEN": "secret-for-tests"}):
            unauth = client.get("/v1/ml/status")
            self.assertEqual(unauth.status_code, 401)
            auth = client.get("/v1/ml/status", headers={"X-ML-Service-Token": "secret-for-tests"})
            self.assertEqual(auth.status_code, 200)
            body = auth.json()
            self.assertIn("drift_monitoring", body)
            self.assertIn("promotion_gate", body)

        with patch.dict(os.environ, {"ML_STATE_PATH": "", "ML_DRIFT_MAE_THRESHOLD_SEC": "50.0"}):
            engine = HybridChampionChallengerEngine()
            for i in range(10):
                engine.learn_one(dict(
                    CANDIDATE,
                    task_id=f"drift-task-{i}",
                    postcode="FC-02-A09-DB-09",
                    actual_duration_sec=800,
                    predicted_eta_sec=300,
                ))
            status = engine.get_status()
            self.assertTrue(status["drift_monitoring"]["drift_alert"])
            self.assertTrue(status["promotion_gate"]["blocked_by_drift"])
            self.assertGreater(status["drift_monitoring"]["rolling_p90_abs_error_sec"], 50.0)


if __name__ == "__main__":
    unittest.main()
