# ETA ML engineering: safety, reproducibility, and field-validation plan

## Honest model status

ResolveGrid implements an eight-feature, scikit-learn GradientBoostingRegressor trained
on **3,500 synthetic Nigerian last-mile observations**, plus a StandardScaler-normalized
SGDRegressor with online `partial_fit` and postcode residual EMA. **Neither model is
validated on real delivery arrivals.** Synthetic fit statistics must never be represented
as achieved field ETA accuracy. The baseline simulator contains the deterministic formula,
so synthetic validation can substantially overstate generalization.

The ML engine defaults to **deterministic ETA dispatch**. Set
`ML_ENABLE_EXPERIMENTAL_ETA=true` *only* in a controlled test environment to blend
unvalidated synthetic predictions. The online learner can receive and store authorized
verified-arrival observations, but a field validation gate is required before adopting
these predictions in a real dispatch strategy.

## Security and service topology

- Configure a random **32+ byte ML_SERVICE_TOKEN** on both the Node API and FastAPI
  service. Keep it in a secret store or private `.env`, never a `NEXT_PUBLIC_*` variable.
- The Node dispatch service includes `X-ML-Service-Token` on inference requests; its
  verification service includes the same header on confirmed-arrival updates.
- FastAPI returns 503 when the secret is not configured and 401 for missing or invalid
  credentials. Input schema validation limits durations and feature ranges.
- Docker Compose **does not publish** ML port 8000. API reaches ML by Docker DNS
  `http://ml-engine:8000`. Redis and MySQL development ports bind to localhost.
- Do not put the learning service behind a public reverse proxy. Service tokens do not
  replace network isolation. Use TLS or a trusted private overlay if services span hosts.
- Replace existing hard-coded database passwords in private deployment configuration.
  `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` and `ML_SERVICE_TOKEN` are required by Compose.
- The online model state is an application-owned joblib file. Joblib uses Python pickle:
  **never** load model files uploaded by users or from untrusted origins.

## Development / reproduction

From the repository root:

```bash
cp .env.example .env
# Set MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD, ML_SERVICE_TOKEN and other service secrets.
pnpm install
cd apps/ml-engine
python3 -m pip install -r requirements.txt
python3 -m app.ml.train_champion
python3 -m unittest discover -s . -p 'test_ml*.py' -v
python3 evaluate_eta.py
```

The committed binary model artifact was removed because stale pickles did not load on
newer scikit-learn releases. The synthetic model is now reproducibly generated from
versioned source code by `pnpm dev:ml`, the ML Docker image build, and GitHub Actions.
Version controlled model evaluation code and input-generation seed are the provenance.

Online state is stored at `ML_STATE_PATH`, defaulting to no persistence if unset.
The provided Docker Compose mounts a private named volume at
`/var/lib/resolvegrid-ml/online_state.joblib`. Atomic replacement prevents a partial
write from replacing a valid checkpoint. The service remembers task IDs so retries don't
retrain on the same delivery. A lost response for a verified arrival can be replayed from
the Node service without re-recording a second physical arrival.

**Deployment migration:** Keep existing MySQL volumes; do not run `docker compose down -v`.
Set the new secrets before rebuilding. Back up the database, deploy the new ML and Node
containers together, and perform a canary with a known test task. Existing `main`
deployments remain unchanged until this branch is merged and redeployed.

## Evaluation protocol

`python evaluate_eta.py` uses a new RNG seed for an independent **synthetic** dataset
of 1,000 examples. The report includes MAE, RMSE, R² and whether the regressor beats
the existing deterministic ETA formula. Since this is the same simulator used in
training, the report is a **software regression benchmark, not field validation**.

For a preliminary, consented real-data assessment, provide an external CSV (do not
commit or upload it publicly):

```bash
python evaluate_eta.py --real-data /secure/location/verified_arrivals.csv
```

Required columns:

```text
arrived_at,verified,actual_duration_sec,osrm_base_duration_sec,gate_delay_sec,compound_walk_meters,rain_mm,wind_speed_kmh,velocity_kmh,rolling_1h_on_time_rate,active_load
```

- `arrived_at`: ISO-8601 timestamp of verified arrival.
- `verified`: true/false; only verified entries are evaluated.
- `actual_duration_sec`: verified end-to-end duration, strictly positive.
- Feature values: measured or observed at **prediction time**, not filled with
  post-arrival knowledge. Otherwise the evaluation leaks future information.
- The harness requires at least 30 verified arrivals and reports performance on
  the latest 20% by arrival timestamp. **Thirty is a minimal smoke-test threshold,
  not a statistically sufficient production sample.**

### Field rollout quality gate (not yet met)

1. Collect consented pilot trips and retain only the data needed for ETA training.
   Store a verification source, observation time, feature timestamp and task ID.
2. Compare against the deterministic router and a simple constant/distance baseline.
3. Train on earlier trips and evaluate on strictly later trips; group or slice by
   district, vehicle, weather, distance and under-represented locations.
4. Report MAE, RMSE, p50/p90 absolute error, calibration or coverage, uncertainty,
   model/feature version, sample size and missing-value rates.
5. Check serving latency, tail latency, fallback rate, error rate and cost.
6. Run shadow mode first. Promote only after non-regression and meaningful improvement
   on genuine verified arrivals. Roll back automatically on drift or degradation.

## Known limitations and follow-up

- Online learning state lives in a single local volume. Multi-replica workers must
  share a managed state store or use a centralized, serialized learning service.
- Loss of the model service can cause a pending verified task to require retry;
  a durable transactional-outbox worker is still recommended for guaranteed delivery.
- The online challenger is trained with a fixed synthetic baseline scaler; model +
  scaler must be re-fitted together before a major feature-distribution change.
- Synthetic model metrics cannot prove real-world accuracy, and no genuine verified
  arrival dataset is included in this repository.
- Legacy API fields `champion_lgbm_eta_sec` and `challenger_river_eta_sec` are
  retained for compatibility; new response fields accurately name scikit-learn
  gradient boosting and SGD. Consumers should migrate off the legacy names.

## Suggested precise CV language

> Implemented a Python FastAPI ETA inference service using scikit-learn gradient
> boosting trained on a synthetic delivery simulator, scaled online SGD updates,
> per-postcode residual calibration, authenticated learning endpoints and
> reproducible baseline evaluation; designed field-validation gates before
> production use of predictive dispatch.

Do **not** claim production ML accuracy or X% operational improvement until
verified field measurements exist.
