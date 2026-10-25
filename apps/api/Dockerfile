FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @resolvegrid/shared build && pnpm --filter @resolvegrid/api build
EXPOSE 4000
CMD ["pnpm", "--filter", "@resolvegrid/api", "start"]
