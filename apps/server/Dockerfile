# F33 Phase 1A — Trail engine container.
#
# Multi-stage build using two toolchains:
#   - deps stage:    node:20-slim — pnpm needs real node to resolve
#                     workspace deps (bun's node-fallback doesn't satisfy
#                     pnpm's `node --version` shell-out)
#   - runtime stage: oven/bun:1.3 — engine is run with `bun run`, which
#                     is faster than node for our TS workload and matches
#                     local-dev `bun run` semantics
#
# Volume contract: /data is mounted by Fly. Trail reads
#   TRAIL_DATA_DIR (default /data) and TRAIL_DB_PATH (default
#   ${TRAIL_DATA_DIR}/trail.db) — Phase 1A sets these to point at
#   /data/{tenant-slug}/trail.db via fly.toml [env]. Multi-tenant
#   per-request routing lands in Phase 1B.

# ─── deps stage (node + pnpm) ─────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@9.0.0 --activate

# Copy only manifest files first so Docker can cache the install layer
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

# ─── runtime stage (bun) ──────────────────────────────────────────────
FROM oven/bun:1.3 AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080
ENV TRAIL_DATA_DIR=/data

# F196 — git sha baked at build time (build-arg) for the on-boot deploy self-report.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

# Copy installed node_modules from deps stage (pnpm uses symlinks
# under node_modules/.pnpm/, COPY preserves them).
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

# F168 — Beam: install engine-side import helper. Invoked by the local
# beam.ts CLI via `fly ssh console -C "/usr/local/bin/beam-import.sh ..."`.
COPY apps/server/scripts/beam-import.sh /usr/local/bin/beam-import.sh
RUN chmod +x /usr/local/bin/beam-import.sh

EXPOSE 8080

# Healthcheck: the engine exposes /api/health (mounted via app.route('/api', healthRoutes)).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

WORKDIR /app/apps/server
CMD ["bun", "run", "src/index.ts"]
