# F33 Phase 1B — trail-admin Fly app.
# Same multi-stage pattern as apps/server/Dockerfile (node:20-slim deps,
# oven/bun:1.3 runtime). See that file for rationale.

# Need BuildKit syntax to use --mount=type=cache below.
# syntax=docker/dockerfile:1.7

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

# Root package.json's `prepare` runs scripts/install-hooks.sh on every
# pnpm install, including this one. The script is a no-op outside a git
# checkout, but pnpm still has to be able to FIND it — without this COPY,
# every deploy fails on "No such file or directory" and the app keeps
# serving its previous image.
COPY scripts/install-hooks.sh scripts/

# BuildKit cache-mount keeps pnpm's content-addressable store between
# builds. First build downloads, subsequent builds re-link instantly.
# Cuts pnpm install from ~3-5 min to ~10-30 s on warm cache.
RUN --mount=type=cache,id=pnpm-store-admin,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @trail/admin-server... \
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

# F196 — git sha baked at build time (build-arg) for the on-boot deploy self-report.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/admin-server/node_modules ./apps/admin-server/node_modules
COPY --from=deps /app/packages ./packages

COPY apps/admin-server/src ./apps/admin-server/src
COPY apps/admin-server/scripts ./apps/admin-server/scripts
COPY apps/admin-server/tsconfig.json ./apps/admin-server/
COPY apps/admin-server/package.json ./apps/admin-server/
COPY packages/shared/src ./packages/shared/src

# Pre-built SPA — `pnpm --filter @trail/admin build` is run by the
# pnpm ship:admin script before flyctl deploy, so apps/admin/dist
# exists in the build context. No need to install admin's deps inside
# the image.
COPY apps/admin/dist ./apps/admin/dist

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8081/api/health || exit 1

WORKDIR /app/apps/admin-server
CMD ["bun", "run", "src/index.ts"]
