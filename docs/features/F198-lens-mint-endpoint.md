# F198 — Lens mint endpoint (read-only authed-surface capture)

**Status:** shipping (code + verify; deploys DARK, activates on secret)
**Date:** 2026-06-11
**Area:** apps/admin-server (lens-session endpoint + global read-only guard)
**Depends on:** F193 membership-gated auth; cardmem F098.1/F074.13 mint-endpoint standard (recipe #4433)

## Motivation

Lens (cardmem's visual-verification engine) can only screenshot what it can
*reach* — and `app.trailmem.com` bounces an unauthenticated visitor to the login
wall. So Trail's admin-UI Lens baseline has been **blocked since F098.8** (cardmem
diagnosed exactly this: a missing trail-side mint endpoint). Christian made it a
**fleet requirement**: every cardmem-fleet product exposes a standard endpoint
that mints a short-lived, **read-only** session so Lens always logs in and
captures the REAL authed surface — never `cb@`, never a customer's data.

## Contract (cardmem standard, #4433)

`POST /api/lens-session`, `Authorization: Bearer <LENS_MINT_SECRET>` →
Playwright `storageState` `{ cookies: [<trail-session>], origins: [] }` for a
10-minute read-only lens principal.
- **Ship dark:** `503` until `LENS_MINT_SECRET` is provisioned (deploy is inert).
- `401` on missing/bad bearer (constant-time compare).

## Architecture (adapted to Trail's auth)

Trail's admin-server does **not** sign session tokens — the `trail-session`
cookie value *is* the random `sessions.id`, looked up server-side. So minting is
just: create the principal + a session row, hand back the cookie.

1. **Dedicated principal** — find-or-create a synthetic `control_users` row
   `lens@trailmem.com` (NEVER cb@), home org = the target tenant's org, + a
   `member` membership in **broberg-ai only** (our own KB — Lens never captures a
   customer tenant like sanne-andersen).
2. **Mint** — insert a `sessions` row (`id = randomHex`, `expiresAt = now+10min`),
   return the `storageState` cookie (`domain = LENS_COOKIE_DOMAIN ?? .trailmem.com`).
3. **Read-only — enforced two ways:**
   - the principal is a plain `member` in one tenant; AND
   - **`lensReadOnlyGuard`** — a GLOBAL middleware that hard-`403`s ANY
     POST/PUT/PATCH/DELETE carrying the lens session cookie, across **every**
     route (engine proxy AND admin-local invites/keys/switch-tenant). Write-guard
     in code > RBAC: can't-miss-a-route, no privilege-escalation surface. GET/HEAD
     pass through. The mint POST itself carries no lens cookie (it's bearer-authed)
     so it is never blocked.

Principal identified by sentinel email (`LENS_EMAIL`), so no schema migration.

## Scope (non-goals)

- No HMAC/jose token signing (Trail sessions aren't signed — opaque server-side id).
- No separate read-only RBAC role (the guard is the enforcement; `member` is fine).
- Lens membership is broberg-ai only — capturing a customer tenant is out of scope.
- Daemon-side Lens manifest wiring is cardmem/Lens's side; we expose the endpoint.

## Security

- `LENS_MINT_SECRET = openssl rand -hex 32`, Fly secret on `trail-admin` (never
  inline, never over intercom). The Lens daemon needs the same value in its env
  (`secretEnv: LENS_MINT_SECRET`) — coordinated out-of-band, not via intercom.
- `LENS_COOKIE_DOMAIN = .trailmem.com` (fly.toml [env]).
- The principal is `lens@trailmem.com` — the `cb@webhouse.dk`-is-always-admin rule
  is untouched (different, lower-privilege, read-only user).

## Verification

- `apps/admin-server/scripts/verify-f198-lens-mint.ts` (temp control.db):
  mintLensSession → asserts a lens principal (email = LENS_EMAIL, ≠ cb@), a
  `member` membership in broberg-ai, a session with ~10-min TTL, idempotent
  find-or-create; `isLensPrincipalSession` true for the lens session, false for a
  normal user's; `safeEqual` constant-time compare.
- Live (post-deploy, after secret): `503` before secret, `401` bad bearer, `200`
  + storageState good bearer, `403` when the minted cookie attempts a mutation.

## Rollout

1. Deploy admin with the code → endpoint `503` (inert, safe).
2. `flyctl secrets set LENS_MINT_SECRET=<openssl rand -hex 32> -a trail-admin` →
   live. Coordinate the same value into the Lens daemon's env.
3. Lens adds the manifest auth adapter → captures the authed admin surface.
