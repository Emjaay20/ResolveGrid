# Single-container demonstration build for platforms that accept one Docker app.
# Production should run the API, ML service, web app, database, and Redis as
# separately managed services (see docker-compose.yml).
FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

# The browser calls same-origin /api; Next forwards this to the internal API.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm build

FROM node:20-bookworm-slim

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app
RUN python3 -m venv /opt/resolvegrid-venv \
  && /opt/resolvegrid-venv/bin/pip install --no-cache-dir -r apps/ml-engine/requirements.txt

ENV PATH="/opt/resolvegrid-venv/bin:$PATH" \
  NODE_ENV=production \
  API_PORT=4000 \
  ML_PORT=8000 \
  PORT=3000 \
  NEXT_PUBLIC_API_URL=/api \
  ENABLE_LIVE_TELEMETRY_WORKER=false

EXPOSE 3000
CMD ["node", "deployment/start.mjs"]
