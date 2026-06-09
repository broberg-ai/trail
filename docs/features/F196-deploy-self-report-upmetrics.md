# F196 — Deploy self-report to upmetrics (deploy-observe)

**Status:** shipping (engine live + verified; other 4 apps code-complete, dormant pending key)
**Date:** 2026-06-09
**Area:** packages/shared (helper) + apps/server, apps/admin-server (boot hook) + apps/landing, apps/docs, apps/widget (nginx entrypoint) + fly.toml [env] + ship scripts
**Depends on:** upmetrics F019 deploy-observe API (live in prod); the existing `UPMETRICS_API_KEY` Fly secret (cost-ingest, F190.5)
**Contract source:** upmetrics intercom #4219 → refined #4222/#4223 (cc-to-cc)

## Motivation

Christian asked Trail to integrate with upmetrics' new deploy-observe setup (F019):
Trail's deploys should appear on `upmetrics.org/deploys`, populate a release
register (`GET /release/:site → {version, sha, deployedAt}`), and — when a deploy
goes green — let upmetrics relay a ping back to this cc session. This is the
"Deploy Watcher → GREEN → ping" loop (Sentry-Releases pattern: correlate a deploy
with the error stream that follows it).

## The one real design constraint

upmetrics' first instinct was "POST from your deploy pipeline using the same
`X-Upmetrics-Key` you already have." But:

- The `UPMETRICS_API_KEY` lives **only as a prod Fly secret** (on `trail-engine-001`,
  used by the cost-ingest sink). It is **write-only** — not readable back.
- Trail's deploys run **locally** from `pnpm ship:*` (flyctl on Christian's Mac).
  The local ship script therefore has **no key** to POST with.
- Hard rule: never pull a secret over intercom, never inline it in code.

→ **Resolution (locked #4223): each app self-reports on boot.** The deployed app
already has `UPMETRICS_API_KEY` in its Fly env + its git sha baked in at build
time, so it POSTs its own `success` event when it boots. No secret leaves prod,
no key on the local ship path.

## Scope (in)

- A single `reportDeploy()` helper in `@trail/shared` (alongside the existing
  `UPMETRICS_DSN`). Fire-and-forget, fail-soft (never throws into a boot path),
  no-ops when `UPMETRICS_API_KEY` or `UPMETRICS_SITE` is unset.
- **Bun servers** (engine, admin-server): call `void reportDeploy()` once after
  the server starts listening.
- **nginx static apps** (landing, docs, widget): a `report-deploy.sh` dropped in
  `/docker-entrypoint.d/` (nginx:alpine runs these before launching nginx) that
  fires the same POST via `curl`.
- Per-app `UPMETRICS_SITE` in each `fly.toml [env]`; `GIT_SHA` baked via a
  build-arg passed by each `ship:*` script.

## Scope (non-goals)

- **No pending/running/failure events in v1.** One terminal `success` POST per
  deploy. A deploy that never boots cannot self-report — but that is *correct*:
  the registry stays on the last good version (the failed deploy never went
  live), and the relay only fires on terminal status. Failure-from-ship-script
  is a later story (needs a key path we don't have).
- No change to cost-ingest (`upmetrics-cost.ts`) — separate concern.
- No GitHub-Actions deploy path wiring (Trail deploys via local `pnpm ship:*`).

## Contract (locked with upmetrics #4223)

`POST https://upmetrics.org/api/deploys`, header `X-Upmetrics-Key: $UPMETRICS_API_KEY`:

```json
{ "site": "<surface>", "deploy_id": "<sha>-<site>", "status": "success",
  "sha": "<git sha>", "originator": "trail", "provider": "fly" }
```

- `site` = the deployed surface (registry key). `deploy_id` = `${sha}-${site}`
  (idempotent; upmetrics merges on (project, deploy_id) — a re-POST on restart
  never resets sha/originator).
- `originator = "trail"` so the relay pings this session regardless of which app
  deployed.
- Verify: `GET https://upmetrics.org/release/<site>` returns `{version, sha, deployedAt}`.

### Per-app site keys

| Fly app | site (registry key) | mechanism |
|---|---|---|
| `trail-engine-001` | `trail-engine-001` | Bun boot hook |
| `trail-admin` | `app.trailmem.com` | Bun boot hook |
| `trail-landing` | `trailmem.com` | nginx `/docker-entrypoint.d/` |
| `trail-docs` | `docs.trailmem.com` | nginx `/docker-entrypoint.d/` |
| `trail-widget` | `trail-widget` | nginx `/docker-entrypoint.d/` |

## Key distribution (the rollout gate)

Only `trail-engine-001` currently holds `UPMETRICS_API_KEY`, so only the engine
reports tonight (verified end-to-end). The other four apps are **code-complete
but dormant** — `reportDeploy()` no-ops until their key is set. Activating each is
one command (value needed from Christian / upmetrics; cannot be pulled from the
engine secret or intercom):

```
flyctl secrets set UPMETRICS_API_KEY=<value> -a trail-admin
flyctl secrets set UPMETRICS_API_KEY=<value> -a trail-landing
flyctl secrets set UPMETRICS_API_KEY=<value> -a trail-docs
flyctl secrets set UPMETRICS_API_KEY=<value> -a trail-widget
```

Setting the secret triggers a machine restart → the boot hook fires → the app
reports. So no extra deploy is needed to activate once the key lands.

## Rollout

1. Ship the helper + wiring for all 5 apps (this PR).
2. `pnpm ship:engine` → engine boots with key+site+sha → `GET /release/trail-engine-001`
   returns the sha (runtime proof).
3. Other 4 apps: wiring committed; they activate on their next deploy once the
   key secret is set.

## Verification

- Engine: after `ship:engine`, `GET https://upmetrics.org/release/trail-engine-001`
  returns the deployed sha — proves the boot hook + contract end-to-end.
- Helper is fail-soft: unset key/site → no-op (local dev never POSTs, never throws).
