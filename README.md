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
        │  • Stage B: Explainable Last-Mile ETA Engine                   │
        │    - Deterministic route, weather, access and workload baseline│
        │    - In-memory online residual correction from verified arrivals│
        └────────────────────────────────────────────────────────────────┘
```

---

## 2. Monorepo Structure

- [`packages/shared`](./packages/shared): Canonical NIPOST 5-segment parser/assembler (`AA-99-H77-BB-55`), 36-State + FCT Legacy 6-Digit Postal Zone Bridge, Haversine & H3 spatial indexers.
- [`apps/api`](./apps/api): Node.js + TypeScript Core API, Official NIPOST Client (`https://api.postcode.gov.ng`), Circuit Breaker, Redis `GEOSEARCH`, Redlock (`SETNX`), OSRM + Open-Meteo + OpenSky live telemetry, and HMAC-SHA256 KYC Proof-of-Location Pass signer.
- [`apps/ml-engine`](./apps/ml-engine): Python FastAPI service running the NIPOST tool-calling agent and an explainable ETA baseline with an online residual learner. A trained model is deliberately not claimed until consented, verified arrival data is available.
- [`apps/web`](./apps/web): Next.js 15 operations console for source-aware address resolution, dispatch, field-evidence review, quality checks, and KYC verification.
- [`apps/mobile`](./apps/mobile): React Native (Expo) field companion for provisioned agents to resolve a visit, capture consented device GPS and access observations, and retry a failed submission before leaving the app.
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
approved field identities through `POST /v1/field/agents`; each agent then signs in through
`POST /v1/field/auth/login` and the mobile app sends the resulting short-lived bearer token.
Never place either server secret in `EXPO_PUBLIC_*` variables or commit them to the app.

Fixture-labelled results are deliberately blocked from accepting real field evidence. Use an
approved NIPOST staging or production credential before carrying out operational field work.

For an existing MySQL database, apply
[`infra/mysql/migrations/001_field_observations.sql`](./infra/mysql/migrations/001_field_observations.sql)
and [`infra/mysql/migrations/002_field_agents.sql`](./infra/mysql/migrations/002_field_agents.sql)
before deploying this version. Fresh Docker databases receive the same tables from `init.sql`.

### Mobile release configuration

Before making an Android or iOS build, copy [`apps/mobile/.env.example`](./apps/mobile/.env.example)
to `apps/mobile/.env` and set `EXPO_PUBLIC_API_URL` to the full HTTPS API address of the deployed
ResolveGrid service (including its `/api` path). This is a public client setting, not a place for NIPOST or field-agent
server secrets. The current retry queue is deliberately session-only; a durable encrypted
offline queue is the next mobile hardening step.
