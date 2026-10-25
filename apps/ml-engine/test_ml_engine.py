import unittest
from app.ml.eta_engine import eta_engine


class TestHybridChampionChallengerEngine(unittest.TestCase):
    def test_score_candidates_and_online_learn(self) -> None:
        candidates = [
            {
                "agent_id": "agent_abj_01",
                "callsign": "ABJ-RIDER-104",
                "agent_type": "COURIER_BIKE",
                "straight_distance_m": 1100,
                "road_distance_m": 1450,
                "osrm_base_duration_sec": 180,
                "velocity_kmh": 34.0,
                "rolling_1h_on_time_rate": 0.98,
                "active_load": 1,
                "gate_delay_sec": 35,
                "compound_walk_meters": 20,
                "rain_mm": 0.0,
                "wind_speed_kmh": 10.0,
            },
            {
                "agent_id": "agent_abj_02",
                "callsign": "ABJ-RIDER-218",
                "agent_type": "COURIER_BIKE",
                "straight_distance_m": 1600,
                "road_distance_m": 2100,
                "osrm_base_duration_sec": 260,
                "velocity_kmh": 28.0,
                "rolling_1h_on_time_rate": 0.95,
                "active_load": 0,
                "gate_delay_sec": 35,
                "compound_walk_meters": 20,
                "rain_mm": 0.0,
                "wind_speed_kmh": 10.0,
            },
        ]

        scored = eta_engine.score_candidates("FC-02-A09-DB-09", candidates)
        self.assertEqual(len(scored["ranked_candidates"]), 2)
        self.assertEqual(scored["ranked_candidates"][0]["agent_id"], "agent_abj_01")

        initial_samples = eta_engine.online_samples_learned
        learn_res = eta_engine.learn_one(
            {
                "task_id": "task_test_01",
                "postcode": "FC-02-A09-DB-09",
                "predicted_eta_sec": scored["ranked_candidates"][0]["final_predicted_eta_sec"],
                "actual_duration_sec": scored["ranked_candidates"][0]["final_predicted_eta_sec"] + 12,
            }
        )
        self.assertTrue(learn_res["updated"])
        self.assertEqual(eta_engine.online_samples_learned, initial_samples + 1)


if __name__ == "__main__":
    unittest.main()
