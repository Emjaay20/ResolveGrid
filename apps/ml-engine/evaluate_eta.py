"""Reproducible ETA evaluation; explicitly distinguishes simulation from field evidence.

Run from apps/ml-engine:
  python evaluate_eta.py
  python evaluate_eta.py --real-data /secure/path/verified_arrivals.csv

Real CSV columns: arrived_at, verified, actual_duration_sec, and all
FEATURE_NAMES from app/ml/train_champion.py. Do not commit personal trip records.
"""
import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.metrics import mean_absolute_error, root_mean_squared_error, r2_score

from app.ml.train_champion import (
    FEATURE_NAMES,
    deterministic_eta,
    generate_synthetic_nigerian_telemetry,
    train_and_export,
)

MODEL = Path(__file__).resolve().parent / "app" / "ml" / "champion_model.joblib"


def evaluate(model, X, actual):
    predicted = np.maximum(45.0, np.asarray(model.predict(X), dtype=float))
    baseline = np.maximum(45.0, deterministic_eta(X))

    def metrics(y):
        abs_errors = np.abs(actual - y)
        return {
            "mae_sec": round(float(mean_absolute_error(actual, y)), 2),
            "rmse_sec": round(float(root_mean_squared_error(actual, y)), 2),
            "p50_abs_error_sec": round(float(np.percentile(abs_errors, 50)), 2),
            "p90_abs_error_sec": round(float(np.percentile(abs_errors, 90)), 2),
            "within_120s_rate": round(float(np.mean(abs_errors <= 120.0)), 4),
            "r2": round(float(r2_score(actual, y)), 4),
        }

    return {
        "trained_gradient_boosting": metrics(predicted),
        "deterministic_routing_baseline": metrics(baseline),
        "model_improves_mae": bool(mean_absolute_error(actual, predicted) < mean_absolute_error(actual, baseline)),
    }


def read_verified_arrivals(path: Path):
    """Only consented, verified field records; chronological holdout, no retraining."""
    records = []
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        needed = set(FEATURE_NAMES) | {"arrived_at", "verified", "actual_duration_sec"}
        if not needed.issubset(reader.fieldnames or []):
            raise ValueError("Missing columns: " + ", ".join(sorted(needed - set(reader.fieldnames or []))))
        for row in reader:
            if str(row["verified"]).lower() not in {"1", "true", "yes"}:
                continue
            timestamp = datetime.fromisoformat(row["arrived_at"].replace("Z", "+00:00"))
            x = [float(row[name]) for name in FEATURE_NAMES]
            actual = float(row["actual_duration_sec"])
            if not np.isfinite(x).all() or not np.isfinite(actual) or actual <= 0:
                raise ValueError("Non-finite or nonpositive verified arrival data")
            records.append((timestamp, x, actual))
    if len(records) < 30:
        raise ValueError("At least 30 verified arrivals are required for the preliminary field report")
    records.sort(key=lambda item: item[0])
    # Last 20% of observed arrivals: a chronological reporting slice.
    # The current champion is trained on simulation, not on these records.
    holdout = records[max(1, int(len(records) * 0.8)):]
    return np.array([r[1] for r in holdout]), np.array([r[2] for r in holdout]), len(records)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--real-data", type=Path,
                        help="Optional private CSV containing consented and verified arrival records")
    parser.add_argument("--write-promotion-gate", type=Path,
                        help="Optional path to write a versioned promotion-gate evaluation manifest")
    args = parser.parse_args()
    if not MODEL.exists():
        train_and_export()
    artifact = joblib.load(MODEL)  # Only load trusted artifacts shipped with this repository
    model = artifact["model"]
    evaluated_at = datetime.now(timezone.utc).isoformat()
    if args.real_data:
        X, actual, total = read_verified_arrivals(args.real_data)
        report = {
            "evaluated_at": evaluated_at,
            "dataset": "VERIFIED_FIELD_ARRIVALS",
            "status": "Preliminary field benchmark, not production validation",
            "records": total,
            "chronological_holdout_records": len(actual),
            "results": evaluate(model, X, actual),
        }
    else:
        # Different RNG seed than training; still from the SAME simulator.
        X, actual = generate_synthetic_nigerian_telemetry(n_samples=1000, seed=719)
        report = {
            "evaluated_at": evaluated_at,
            "dataset": "SYNTHETIC_SIMULATION",
            "real_arrival_validated": False,
            "records": len(actual),
            "note": "Independent synthetic seed, same simulator. This cannot predict field performance.",
            "results": evaluate(model, X, actual),
        }
    if args.write_promotion_gate:
        args.write_promotion_gate.parent.mkdir(parents=True, exist_ok=True)
        args.write_promotion_gate.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
