# ResolveGrid Pitch Readiness

## What works today

- Deployed web operations console: address resolution, source provenance, dispatch-task creation and quality checks.
- Deployed API with MySQL and Redis health checks.
- Provisioned mobile field identity and short-lived, signed field sessions.
- Mobile GPS, consent capture, access-note capture and authenticated evidence submission.
- ETA candidate ranking based on route duration, weather, gate delay, walking distance, workload, speed and recent performance.

## What must be true before an operational claim

1. Register an organisation or developer profile through the official NIPOST dashboard.
2. Store the approved NIPOST staging or production credential only in the server environment.
3. Resolve one real location that returns a NIPOST source, rather than `LOCAL_DEVELOPMENT_FIXTURE`.
4. Submit a consented field observation for that official result.

The product intentionally rejects fixture-labelled postcodes for field evidence. This prevents a demo record from being presented as official evidence.

## Accurate ML statement

ResolveGrid currently uses an explainable ETA baseline with an online residual learner. It is not presented as a trained LightGBM or River model. Verified arrivals are the dataset required before training, evaluating and versioning a production model.

## External actions that require the founder

- Create or complete the NIPOST dashboard profile.
- Request and protect official staging access.
- Submit the pitch application at the official programme link.
- Obtain consent before recording any live visit location.
