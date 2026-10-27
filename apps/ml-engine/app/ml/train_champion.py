import os
from pathlib import Path
import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, root_mean_squared_error, r2_score

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


def generate_synthetic_nigerian_telemetry(n_samples: int = 3500, seed: int = 42):
    """
    Generates realistic last-mile delivery telemetry across Nigerian metropolitan areas
    (Lagos, Abuja, Kano, Port Harcourt, Ibadan) with high-density estate gates, compound walks,
    and tropical rain factors.
    """
    rng = np.random.default_rng(seed)

    osrm_dur = rng.uniform(60, 1500, n_samples)
    gate_delay = rng.choice([0, 30, 45, 90, 150, 240, 420], size=n_samples, p=[0.20, 0.25, 0.20, 0.15, 0.10, 0.07, 0.03])
    walk_m = rng.uniform(5, 120, n_samples)
    rain_mm = rng.choice([0.0, 2.5, 8.0, 18.0, 35.0], size=n_samples, p=[0.65, 0.15, 0.10, 0.07, 0.03])
    wind_kmh = rng.uniform(5, 35, n_samples)
    velocity_kmh = rng.uniform(12, 45, n_samples)
    on_time_rate = rng.uniform(0.82, 0.99, n_samples)
    active_load = rng.integers(0, 5, n_samples)

    walk_sec = walk_m / 1.30
    weather_penalty = rain_mm * 18.0 + np.where(wind_kmh > 24.0, 20.0, 0.0)
    congestion_factor = 1.0 + np.maximum(0.0, (30.0 - velocity_kmh) / 80.0)
    rider_reliability = 1.0 + np.maximum(0.0, (0.97 - on_time_rate) * 1.3)
    load_penalty = active_load * 14.0

    # Ground truth actual delivery arrival time with realistic noise
    noise = rng.normal(0, 18.0, n_samples)
    y_actual = (
        (osrm_dur * congestion_factor + gate_delay + walk_sec + weather_penalty + load_penalty)
        * rider_reliability
        + noise
    )
    y_actual = np.maximum(45.0, y_actual)

    X = np.column_stack([
        osrm_dur,
        gate_delay,
        walk_m,
        rain_mm,
        wind_kmh,
        velocity_kmh,
        on_time_rate,
        active_load,
    ])
    return X, y_actual


def train_and_export():
    print("Generating 3,500 Nigerian last-mile spatial telemetry samples...")
    X, y = generate_synthetic_nigerian_telemetry()

    split = int(len(X) * 0.85)
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    print("Fitting GradientBoostingRegressor (Champion Model)...")
    model = GradientBoostingRegressor(
        n_estimators=120,
        learning_rate=0.07,
        max_depth=4,
        subsample=0.85,
        random_state=42,
    )
    model.fit(X_train, y_train)

    val_preds = model.predict(X_val)
    mae = mean_absolute_error(y_val, val_preds)
    rmse = root_mean_squared_error(y_val, val_preds)
    r2 = r2_score(y_val, val_preds)

    print(f"Validation MAE:  {mae:.2f} seconds")
    print(f"Validation RMSE: {rmse:.2f} seconds")
    print(f"Validation R^2:  {r2:.4f}")

    importances = dict(zip(FEATURE_NAMES, [float(round(imp, 4)) for imp in model.feature_importances_]))
    print("Feature Importances:")
    for k, v in sorted(importances.items(), key=lambda x: x[1], reverse=True):
        print(f"  - {k}: {v * 100:.1f}%")

    out_dir = Path(__file__).resolve().parent
    out_file = out_dir / "champion_model.joblib"
    artifact = {
        "model": model,
        "feature_names": FEATURE_NAMES,
        "feature_importances": importances,
        "val_mae": float(round(mae, 2)),
        "val_rmse": float(round(rmse, 2)),
        "val_r2": float(round(r2, 4)),
        "version": "1.0.0",
        "trained_samples": len(X_train),
    }

    joblib.dump(artifact, out_file)
    print(f"Saved Champion model artifact to {out_file} ({out_file.stat().st_size} bytes)")


if __name__ == "__main__":
    train_and_export()
