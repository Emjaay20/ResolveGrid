# ResolveGrid — Autonomous National Postcode Intelligence, Last-Mile Dispatch & Ground-Truth Telemetry Engine

**ResolveGrid** is a polyglot, production-grade address intelligence, spatio-temporal resource allocation, and self-correcting machine learning telemetry platform built natively on **Nigeria's National Digital Alphanumeric Postcode System (NDAPS / `api.postcode.gov.ng`)**.

---

## 1. System Architecture (`aetherhost.com.ng`)

```
[Web Console (resolve.aetherhost.com.ng)]   [Mobile Field App (React Native / Expo)]
                   │                                           │
                   └─────────────────────┬─────────────────────┘
                                         ▼
        ┌────────────────────────────────────────────────────────────────┐
        │ 1. Node.js Core & Official NIPOST Gateway (apps/api :4000)     │
        │  • NIPOST SDK (/v1/search/*, /v1/lookup L1–L5, /v1/assembly/*) │
        │  • Legacy 6-Digit Postal Zone Dual-Bridge (900288 ↔ FC02A09DB09│
        │  • Redis GEOADD/GEOSEARCH + Uber H3 Velocity Cells + Redlock   │
        │  • MySQL 8.0 ACID Transactions + Transactional Outbox Pattern  │
        │  • Live Open-Meteo Weather + OSRM Road Routing + OpenSky ADS-B │
        └────────────────────────────────┬───────────────────────────────┘
                                         │
                                         ▼
        ┌────────────────────────────────────────────────────────────────┐
        │ 2. Python FastAPI AI Agent & ML Engine (apps/ml-engine :8000)  │
        │  • Stage A: Multi-Provider LLM Tool-Calling Agent              │
        │    (Gemini / Groq / OpenAI / Anthropic + Deterministic Chain)  │
        │  • Stage B: Hybrid Champion / Challenger Last-50m ETA Engine   │
        │    - Champion: Vectorized LightGBM / GBDT Urban Regressor      │
        │    - Challenger: Online River Residual Corrector (learn_one)   │
        └────────────────────────────────────────────────────────────────┘
```

---

## 2. Monorepo Structure

- [`packages/shared`](./packages/shared): Canonical NIPOST 5-segment parser/assembler (`AA-99-H77-BB-55`), 36-State + FCT Legacy 6-Digit Postal Zone Bridge, Haversine & H3 spatial indexers.
- [`apps/api`](./apps/api): Node.js + TypeScript Core API, Official NIPOST Client (`https://api.postcode.gov.ng`), Circuit Breaker, Redis `GEOSEARCH`, Redlock (`SETNX`), OSRM + Open-Meteo + OpenSky live telemetry, and HMAC-SHA256 KYC Proof-of-Location Pass signer.
- [`apps/ml-engine`](./apps/ml-engine): Python FastAPI service running the Multi-Provider LLM Tool-Calling NIPOST Agent and the Hybrid Champion (LightGBM) + Challenger (Online River) ETA engine.
- [`apps/web`](./apps/web): Next.js 15 App Router dark-mode engineering console with interactive H3 vector radar map, live Agent Tool-Call Trace, Self-Grading Ground-Truth Ledger, Golden Nigerian Address Benchmark (`/evals`), and Banking/KYC Verifier.
- [`apps/mobile`](./apps/mobile): React Native (Expo) Field Companion App (`expo-location`) for real hardware GPS building verification, KYC check-in passes, live courier geofence telemetry, and crowdsourced estate gate delay logging.
- [`infra/mysql/init.sql`](./infra/mysql/init.sql) & [`infra/nginx/aetherhost.conf`](./infra/nginx/aetherhost.conf): Production MySQL 8.0 schema and Nginx reverse-proxy configuration for `aetherhost.com.ng`.

---

## 3. Quick Start (Local & Docker Production)

### Option A: One-Command Docker Compose Stack
```bash
cp .env.example .env
# Add your NIPOST_API_KEY from https://dashboard.postcode.gov.ng/register
docker compose up --build -d
```

### Option B: Direct Development Mode
```bash
# 1. Install dependencies & build shared + API packages
pnpm install
pnpm test

# 2. Start Python FastAPI ML & Multi-Tool Agent Engine (Port 8000)
pnpm dev:ml

# 3. Start Node.js Core & NIPOST Gateway API (Port 4000)
pnpm dev:api

# 4. Start Next.js 15 Web Console (Port 3000)
pnpm dev:web
```

### Field evidence configuration

The mobile field app submits append-only access observations (GPS accuracy, gate delay,
walk distance, and access notes). It never silently changes trusted building data. Configure
`FIELD_ADMIN_KEY` and `FIELD_SESSION_SECRET` on the API server. An administrator provisions
approved agents through `POST /v1/field/agents`; each agent then signs in through
`POST /v1/field/auth/login` and the mobile app sends the resulting short-lived bearer token.
Never place either server secret in `EXPO_PUBLIC_*` variables or commit them to the app.

For an existing MySQL database, apply
[`infra/mysql/migrations/001_field_observations.sql`](./infra/mysql/migrations/001_field_observations.sql)
and [`infra/mysql/migrations/002_field_agents.sql`](./infra/mysql/migrations/002_field_agents.sql)
before deploying this version. Fresh Docker databases receive the same tables from `init.sql`.
