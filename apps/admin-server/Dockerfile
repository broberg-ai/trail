# F33 Phase 1B — trail-admin Fly app.
# Same multi-stage pattern as apps/server/Dockerfile (node:20-slim deps,
# oven/bun:1.3 runtime). See that file for rationale.

# ─── deps stage ───────────────────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@9.0.0 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY apps/admin-server/package.json apps/admin-server/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile --filter @trail/admin-server... \
    || pnpm install --filter @trail/admin-server...

# ─── runtime stage ────────────────────────────────────────────────────
FROM oven/bun:1.3 AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8081
ENV TRAIL_DATA_DIR=/data

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/admin-server/node_modules ./apps/admin-server/node_modules
COPY --from=deps /app/packages ./packages

COPY apps/admin-server/src ./apps/admin-server/src
COPY apps/admin-server/tsconfig.json ./apps/admin-server/
COPY apps/admin-server/package.json ./apps/admin-server/
COPY packages/shared/src ./packages/shared/src

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8081/api/health || exit 1

WORKDIR /app/apps/admin-server
CMD ["bun", "run", "src/index.ts"]
