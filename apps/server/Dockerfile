# F33 Phase 1A — Trail engine container.
#
# Multi-stage build:
#   1. base    — pin Bun, install pnpm, set up workspace dir
#   2. deps    — copy package manifests, install all workspace deps
#                with pnpm fetch + install (cached when only source changes)
#   3. runtime — copy source, expose 8080, run engine
#
# Volume contract: /data is mounted by Fly. Trail reads
#   TRAIL_DATA_DIR (default /data) and TRAIL_DB_PATH (default
#   ${TRAIL_DATA_DIR}/trail.db) — Phase 1A sets these to point at
#   /data/{tenant-slug}/trail.db via fly.toml [env]. Multi-tenant
#   per-request routing lands in Phase 1B.

FROM oven/bun:1.3 AS base
WORKDIR /app

# pnpm via corepack (stable, version-pinned via packageManager field)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@9.0.0 --activate

# ─── deps stage ───────────────────────────────────────────────────────
FROM base AS deps

# Copy only manifest files first so docker can cache the install layer
# when source files change but deps don't.
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/pipelines/package.json packages/pipelines/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/

# Engine doesn't need admin/sdk/mcp/onboarding/web-clipper/model-lab —
# trim the workspace to just what trail-server imports.
RUN pnpm install --frozen-lockfile --filter @trail/server... \
    || pnpm install --filter @trail/server...

# ─── runtime stage ────────────────────────────────────────────────────
FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=8080
ENV TRAIL_DATA_DIR=/data

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages ./packages

# Copy source
COPY apps/server/src ./apps/server/src
COPY apps/server/tsconfig.json ./apps/server/
COPY apps/server/package.json ./apps/server/
COPY packages/core/src ./packages/core/src
COPY packages/db/src ./packages/db/src
COPY packages/db/drizzle ./packages/db/drizzle
COPY packages/pipelines/src ./packages/pipelines/src
COPY packages/shared/src ./packages/shared/src
COPY packages/storage/src ./packages/storage/src

# Re-link workspace symlinks (pnpm puts them under node_modules/.pnpm/);
# top-level packages/* dirs are referenced by name, the symlinks point
# back. No further build step — Bun runs TS directly.

EXPOSE 8080

# Healthcheck: the engine exposes /health (existing route).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

WORKDIR /app/apps/server
CMD ["bun", "run", "src/index.ts"]
