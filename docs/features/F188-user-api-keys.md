# F188 — Personal API Keys (admin-level)

**Status:** Spec locked 2026-05-30 · **Phase:** 2
**Effort:** S–M (1d — `control_api_keys` table already existed; the work is
admin endpoints + proxy auth + UI)
**Depends on:** F40.2a (multi-tenant routing, shipped) · F186 (Account Preferences UI)
**Spawned by:** F186 (Account Preferences → Developer-sektion landede som "Coming Soon")

## Resolved decisions (locked 2026-05-30 — Option B)

The spec was locked after discovering two things in the code:

1. **The engine already has a complete API-key system** (F40.2a-B):
   `GET/POST/DELETE /api/v1/api-keys` in each tenant's `trail.db`, dual-written
   to `/data/key-index.db`, `trail_<64hex>` format, one-time raw reveal. But
   those keys are keyed by **engine `users`** and resolve **directly at the
   engine**.
2. **The admin proxy collapses identity.** `apps/admin-server/src/proxy.ts`
   forwards every `/api/v1/*` request with a **shared per-tenant bearer**
   (`tenant_engines.bearer`); the engine's `requireAuth` derives the user from
   *that* bearer and ignores `X-Trail-Admin-User`. So wiring the admin
   Developer UI straight to the engine endpoint would attribute every
   "personal" key to the shared tenant-bearer user — a mis-attribution, not a
   personal key. (no-quick-fix rule.)

**Decision — Option B:** Personal keys live at the **admin layer** (the
front door, where the `control_users` identity exists), reusing the
already-present-but-unused `control_api_keys` table (it even has `prefix` +
`scope` columns the engine table lacks — clearly created in anticipation of
this). The key authenticates **at the admin proxy** as a drop-in alternative
to the session cookie; the proxy then forwards to the engine with the same
per-tenant bearer as a cookie request would. **Zero engine change.**

| # | Spørgsmål | Beslutning |
|---|---|---|
| 1 | Auth-model | Key **acts as the logged-in admin user**, scoped to ONE tenant (the active tenant at creation). NOT cross-tenant — that was the plan's assumption, deferred to Phase 2+. |
| 2 | Tenant-scope / key-index | **N/A** — keys resolve at the admin proxy (`control.db`), never at the engine. The engine's `key-index.db` is untouched. The key row stores its `tenant_id`; the proxy uses it to pick the engine + bearer. |
| 3 | Permission-model | Acts as the user (no extra per-key scoping in v1). `scope='full'` stored as forward-compat metadata, not enforced — consistent with [[f187-invitations-built-on-the-existing-one-user-one-org-mode]]'s role decision. |
| 4 | Audit | Out of scope. Downstream attribution is unchanged (proxy already sets `X-Trail-Admin-User`). |
| 5 | Rate-limiting | Out of scope — same path as cookie requests. |
| 6 | Revoke-flow | Soft-revoke (`revoked_at`); the **next** request 401s at the proxy. In-flight requests complete (graceful). |
| 7 | CLI-tooling | Deferred. A `trail` CLI is a later F-feature; the raw key works today via `Authorization: Bearer trail_<key>` against `app.trailmem.com/api/v1/*`. |

### Explicit non-goals (locked)

- **Cross-tenant keys** (one key, many tenants) — Phase 2+ when multi-tenant-per-user exists.
- **Engine-direct personal keys** — that's the existing F40.2a-B system, a different surface (websites/MCP hitting an engine directly).
- OAuth tokens, service-accounts (tenant-level), key-rotation automation, per-key rate limits, audit-log split.

## Motivation

F186 leverer Account Preferences med Developer-sektion. Designet
(`docs/design/trail_app/src/user-settings.jsx::Section.developer`) viser en
tabel over personal API keys med navn, prefix, created, last-used, revoke,
plus "Generate new key" CTA.

Indtil F188 lander viser F186 "Coming Soon"-card i Developer-sektionen
med disabled "Generate"-knap.

## Scope (locked)

### In scope

- **Reuse existing `control_api_keys` table** (control.db) — no new table,
  no migration (id, tenant_id, user_id, prefix, key_hash unique, scope,
  name, created_at, revoked_at, last_used_at all already present).
- **Admin endpoints** (under `/api/control`, session-cookie auth):
  - `POST /api/control/api-keys {name}` — generate `trail_<64hex>`, store
    sha256 hash + a `trail_<8hex>` display prefix, `scope='full'`, bind to
    the user's active tenant. Returns the raw key **once**.
  - `GET /api/control/api-keys` — list the user's non-revoked keys
    (id, name, prefix, createdAt, lastUsedAt).
  - `DELETE /api/control/api-keys/:id` — soft-revoke (user-owned only).
- **Proxy auth extension** (`proxy.ts`): a `/api/v1/*` request carrying
  `Authorization: Bearer trail_<key>` resolves the key → user → its bound
  tenant → engine + per-tenant bearer, and stamps `last_used_at`. Drop-in
  alternative to the session cookie.
- **One-time secret-reveal modal** on generate (raw key shown once with
  copy + "won't be shown again"; only prefix + hash persisted).
- **Account Preferences Developer-section** functional (table + Generate
  modal + revoke), replacing the F186 "Coming Soon" card.

### Non-goals

See "Explicit non-goals (locked)" above.

## Architecture (locked)

```
Generate (Account Preferences → Developer)
  → POST /api/control/api-keys {name}
    → admin generates trail_<64hex>, hash=sha256, prefix=trail_<8hex>
    → INSERT control_api_keys (user_id, tenant_id=active, scope='full', …)
    → return {id, name, prefix, key}  ← raw key ONCE
  → modal reveals raw key + copy button + "save now, won't be shown again"

Use (headless caller)
  → GET app.trailmem.com/api/v1/…  with  Authorization: Bearer trail_<key>
    → proxy.resolveApiKey: hash → control_api_keys (non-revoked)
      → user → key.tenant_id → tenant + tenant_engines.bearer
      → stamp last_used_at
    → forward to engine with the per-tenant bearer (same as a cookie request)

Revoke
  → DELETE /api/control/api-keys/:id → revoked_at set → next request 401s
```

## Verification plan

`apps/admin-server/scripts/verify-f188.ts` against a temp control.db:
- POST create → row in control_api_keys, raw key returned once, prefix stored.
- GET list → key present (no hash/raw leaked).
- proxy.resolveApiKey(bearer) → resolves user + tenant + engine bearer;
  last_used_at stamped.
- DELETE revoke → row revoked_at set; resolveApiKey now returns null (401).
- Auth guard: unauthenticated create/list/delete → 401.

## Rollout

- Phase 1 — backend (endpoints + proxy auth). ✅
- Phase 2 — UI (Developer section → functional). ✅
- One push to `main` (Trail not in production yet).
