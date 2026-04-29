# F33 — Fly.io deploy: multi-tenant admin + stateless engine fleet (Phase 1)

**Status:** Planned · **Phase:** 1 · **Owner:** trail-server · **Drives:** F168, F169, F170

## TL;DR

Move Trail off `127.0.0.1:58031` and onto Fly.io with the architecture
that scales: **one** multi-tenant admin (`app.trailmem.com`) for all
customers, a **stateless engine fleet** behind `engine.trailmem.com`,
and **one trail.db per tenant** on the engine's volume. Phase 1 is one
admin + one engine; the schema and routing are forward-compatible with
the F170 multi-engine orchestrator so we don't migrate later.

First customer: Sanne Andersen. Tonight's gate is "Eir chat on Sanne's
website talks to `engine.trailmem.com` and answers with knowledge from
her beamed trail.db".

## Motivation

- Sanne's website is being prepared in a peer cc session. The chat
  endpoint needs a real production URL — `127.0.0.1:58031` won't
  cut it.
- Trail's existing architecture (single `data/trail.db`, single
  admin+engine bundled together) was correct for solo-dev local use
  but does not match a SaaS deployment model.
- Christian's mind-map (TRAIL.md) clarifies the right model:
  - `www.trailmem.com` — landing/marketing/onboarding (already shipped)
  - `app.trailmem.com` — ONE shared admin codebase for all tenants
  - `engine.trailmem.com` — proxy/router → stateless engine fleet
  - `{tenant}.db.trailmem.com` (Phase 2+) — addressable per-tenant
    storage

  Phase 1 of this plan implements the parts marked above as Phase 1.
  Phase 2 work (`{tenant}.db.trailmem.com` separate hosts, self-service
  onboarding) is explicitly deferred — see F170, F172.

## Scope (in)

### 1. Two Fly apps, both in org `broberg-ai`, region `arn`

**`trail-admin`** at `app.trailmem.com`:
- Bun + Hono + Preact admin SPA (existing `apps/admin` + `apps/server`)
- Owns its own small **`control.db`** on a Fly volume — see schema below
- Multi-tenant: magic-link login routes user to their tenant scope
- Reads from + writes to the right engine's tenant.db via internal
  network calls (Phase 1: localhost since admin and engine-001 may
  share a machine; Phase 2: over Fly internal `*.flycast` mesh)
- Single source-of-truth for org/user/tenant/api_key data

**`trail-engine-001`** at `engine-001.trailmem.com`:
- Same Bun + Hono codebase as today's `apps/server`, configured
  to host **N tenants** (one tenant.db file per tenant in
  `/data/{tenant-slug}/trail.db`)
- Public traffic enters via `engine.trailmem.com` (CNAME → engine-001
  in Phase 1; F170 router in Phase 2)
- Bearer-key auth carries tenant scope (per F111.2): engine looks up
  tenant from key → opens that tenant's trail.db → handles request
- Stateless except for the trail.db files on its volume; ephemeral
  job-runner, in-process queue

### 2. DNS via Cloudflare DNS Manager MCP

Records to create (in `trailmem.com` zone, all proxied=false initially
so Fly TLS terminates directly):

| Record | Target | Purpose |
|---|---|---|
| `app.trailmem.com` CNAME | `trail-admin.fly.dev` | Admin SPA + API |
| `engine.trailmem.com` CNAME | `engine-001.trailmem.com` | Public engine entry (Phase 1: direct alias to engine-001; Phase 2: replaced by F170 router) |
| `engine-001.trailmem.com` CNAME | `trail-engine-001.fly.dev` | First engine machine |

Fly cert provisioned per app via `flyctl certs create`. Cloudflare
DNS records created via `mcp__dns-manager__dns_create_record` calls
in the deploy script.

### 3. New `control.db` schema (admin's own DB)

Lives on `trail-admin`'s volume at `/data/control.db`. Separate from
any tenant's data. Initial schema:

```sql
-- Migration 0027 (admin only — does NOT run on engine machines)

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Billing/plan/quota live here later. Empty for Phase 1.
);

CREATE TABLE control_users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE control_tenants (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  slug TEXT NOT NULL UNIQUE,        -- 'sanne-andersen', 'tenant-002'
  name TEXT NOT NULL,
  language TEXT DEFAULT 'da',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tenant_engines (
  tenant_id TEXT PRIMARY KEY REFERENCES control_tenants(id),
  engine_id TEXT NOT NULL,           -- 'engine-001'
  engine_url TEXT NOT NULL,          -- 'https://engine-001.trailmem.com'
  engine_internal_url TEXT,          -- 'http://engine-001.flycast' (Phase 2)
  provisioned_at TEXT NOT NULL,
  retired_at TEXT,                   -- NULL while active
  notes TEXT
);

CREATE TABLE control_api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES control_tenants(id),
  prefix TEXT NOT NULL,              -- first 8 chars of key for display
  key_hash TEXT NOT NULL UNIQUE,     -- argon2 hash of full Bearer key
  scope TEXT NOT NULL,               -- 'tool' | 'public' | 'admin' (per F111.2/F160)
  name TEXT,                         -- human label
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE TABLE magic_links (
  token TEXT PRIMARY KEY,            -- random 32-byte hex
  user_id TEXT NOT NULL REFERENCES control_users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX idx_tenant_engines_engine ON tenant_engines(engine_id, retired_at);
CREATE INDEX idx_api_keys_tenant ON control_api_keys(tenant_id, revoked_at);
```

Naming: `control_*` prefix on tables that exist in both schemas (users,
tenants, api_keys) so future code can grep `control_users` vs `users`
and know which DB it's reading. Avoids cross-DB foot-guns.

### 4. Per-tenant `trail.db` schema — UNCHANGED from today

The existing `trail.db` schema (documents, knowledge_bases,
document_images, chunks, jobs, audit, etc.) stays as-is. It's already
tenant-scoped at the row level — we just have multiple files now,
one per tenant slug, each containing exactly one tenant's data.

The local dev setup keeps using `data/trail.db` (single file) because
solo-dev doesn't need multi-tenancy. The engine code reads
`TRAIL_TENANT_DB_DIR` env (default `/data`) and opens
`{TRAIL_TENANT_DB_DIR}/{tenant-slug}/trail.db` based on the request's
resolved tenant.

### 5. Routing — how a request reaches the right tenant.db

```
Sanne's site → POST https://engine.trailmem.com/api/v1/chat
                Authorization: Bearer trail_sanne_abc…
              ↓
          Cloudflare DNS: engine.trailmem.com CNAME → engine-001.trailmem.com
              ↓
          Fly: engine-001 receives request
              ↓
          Hono middleware: parse Bearer key, hash, lookup in control.db
              ├─ control.db lives on admin (trail-admin.fly.dev)
              ├─ Engine calls admin's internal API: GET https://trail-admin.flycast/api/internal/resolve-key
              │   (Phase 1: HTTPS to public host since flycast unfamiliar; Phase 2: switch to flycast)
              └─ Returns { tenant_id, tenant_slug, scope }
              ↓
          Engine opens /data/sanne-andersen/trail.db
              ↓
          Existing /api/v1/chat handler executes against that DB
```

**Key cache:** engine memoizes Bearer-key→tenant lookups for 60 s
(in-memory `Map<keyHash, {tenant_id, tenant_slug, scope, expires}>`)
so we don't hit admin on every request. Revocation is eventually
consistent inside the cache window — acceptable for Phase 1.

**Why bearer-via-admin and not bearer-in-tenant.db?** Two reasons:
(a) keys are global control-plane state — when F170 migrates a tenant
between engines, the keys must continue working without touching
tenant.db; (b) revocation lookups must hit one canonical place,
not be racing with active engine writes.

### 6. Admin app — Phase 1 surface

Phase 1 admin doesn't need to be feature-complete. Required:
- Magic-link login (POST email → email with link → click → session cookie)
- Tenant resolver: from session, resolve which tenant + which engine
- Reverse-proxy tenant-scoped admin UI to the right engine: when
  Christian (logged in as tenant=sanne-andersen) opens
  `app.trailmem.com/sources`, admin proxies to
  `engine-001.trailmem.com/api/v1/knowledge-bases/.../documents` etc.
- API key management UI: list / create / revoke keys for the active tenant

What's deferred to Phase 2 (F172):
- Self-service org sign-up
- "Initialize trail — the first trail" onboarding flow
- Org-level user invites
- Billing/quotas

For tonight's Sanne ship: I + Christian hand-create the org,
control_tenant, and Bearer key via SQL on `control.db`. UI for that
follows. Keep moving.

### 7. Two deploy paths

**`pnpm ship` (root-level script):**
```jsonc
// package.json scripts
"ship:admin":  "pnpm --filter @trail/admin build && flyctl deploy -c apps/admin/fly.toml",
"ship:engine": "pnpm --filter @trail/engine build && flyctl deploy -c apps/server/fly.toml",
"ship":        "pnpm ship:admin && pnpm ship:engine",
```

Direct flyctl. For "I'm at the keyboard, I want this live in 90 seconds."

**`pnpm deploy` (GitHub Actions):**

`.github/workflows/deploy.yml` triggers on push to `main` (or tag),
runs the same flyctl commands inside CI with `FLY_API_TOKEN` secret.
Artifacts cached. Slower but auditable.

For tonight: `pnpm ship`. GitHub Actions wired in same commit but not
the critical path.

### 8. Beam wiring point (forward-reference to F168)

The deploy scripts must support seeding a tenant.db onto the engine.
F33 includes the engine endpoint that receives a beam:
`POST /internal/beam/import` (admin-only, requires `BEAM_TOKEN` env).
F168 implements the export side + CLI. Tonight: the Sanne ship is
F33-deploy → F168-beam → smoke test.

## Scope (out / explicit non-goals)

- **Multi-engine routing** (F170) — Phase 1 has one engine. The router
  layer is a CNAME, not a worker.
- **Auto-scaling** (F171) — manual orchestration only in Phase 1.
- **Self-service onboarding** (F172) — orgs are hand-created in
  control.db.
- **Separate per-tenant DB host machines** (`{tenant}.db.trailmem.com`)
  — Phase 1 has tenant.db files on engine volumes. The
  `tenant_engines.engine_internal_url` column reserves the schema room
  for moving to dedicated DB hosts later.
- **Replacing local-dev workflow.** `127.0.0.1:58031` keeps working
  unchanged. Local dev stays single-tenant single-DB.
- **R2 backup** (F153) — admin's `control.db` is small, will be
  trivially included once F153 ships. Not a Phase 1 blocker.
- **Edge replicas / Turso integration** — not yet. Engine reads + writes
  the local SQLite directly.
- **TLS pinning, mTLS between admin↔engine** — Phase 1 uses public
  HTTPS. Phase 2 switches to Fly internal mesh (`.flycast`).

## Architecture sketch

```
                                   ┌─────────────────────────────┐
                                   │  www.trailmem.com           │
                                   │  (trail-landing, shipped)    │
                                   │  Marketing + future signup   │
                                   └─────────────────────────────┘
                                                ⋮
              ┌──────────────────────────────────┴──────────────────────────────────┐
              │                                                                      │
   ┌──────────▼──────────┐                                                ┌──────────▼─────────────┐
   │  app.trailmem.com    │                                                │  engine.trailmem.com    │
   │  trail-admin (Fly)   │  ←── magic-link login                          │  Phase 1: CNAME         │
   │                      │                                                │  → engine-001            │
   │  /data/control.db    │                                                │  Phase 2 (F170): router │
   │  - organizations     │                                                └──────────┬─────────────┘
   │  - control_users     │                                                           │
   │  - control_tenants   │                                                           │
   │  - tenant_engines    │←──── HTTPS lookup ────┐                                   │
   │  - control_api_keys  │                       │                                    │
   │  - magic_links       │                       │                                    │
   └──────────────────────┘                       │                                    │
                                                  │                                    │
                                          ┌───────┴────────┐                ┌──────────▼─────────────┐
                                          │  Bearer-key    │                │  engine-001.trailmem.com │
                                          │  → tenant      │                │  trail-engine-001 (Fly)  │
                                          │  → engine_url  │                │                          │
                                          │  resolution    │                │  /data/sanne-andersen/   │
                                          │  (memoized 60s)│                │    trail.db              │
                                          └────────────────┘                │  /data/{tenant-002}/     │
                                                                             │    trail.db              │
                                                                             │   …                      │
                                                                             └──────────────────────────┘
```

### Key invariants

- **One trail.db per tenant.** No cross-tenant SQLite queries ever.
- **Engine is stateless except for tenant.db files.** It can be
  destroyed and recreated; the data lives on the volume; only the
  volume matters.
- **Admin owns the control plane.** Engine never writes to
  `control.db`. Engine only reads via the resolve-key endpoint.
- **Bearer keys carry tenant scope.** No path-based or subdomain-based
  tenant indication on `engine.trailmem.com` traffic — keys are the
  routing identity. Subdomain-based routing is a future addition.
- **Phase 1 routing is dead-simple.** CNAME, no logic. F170 inserts the
  routing layer when needed; F33 stays untouched.

## Dependencies

- **F111.2** — Bearer-key minting + scoping (`tool` / `public` /
  `admin`). Already shipped. F33 just moves the keys' canonical home
  from per-tenant trail.db into control.db.
- **F160** — three-tier integration contract. Already shipped. The
  engine API surface F33 exposes is exactly what F160 documented.
- **F162** — source dedup via SHA-256. Already shipped. Per-tenant.
- **F164** — background jobs framework. Already shipped. Each engine
  runs its own job-runner; jobs are tenant-scoped because they live
  in the tenant.db.
- **No new third-party deps.** Bun, Hono, Drizzle, libSQL, Preact,
  Tailwind — already in the tree.

## Rollout

### Phase 1A — Engine + Sanne (TONIGHT)

1. `flyctl apps create trail-engine-001 --org broberg-ai`,
   provision 5 GB volume in `arn`.
2. Build engine Docker image; deploy via `pnpm ship:engine`.
3. Cloudflare DNS: `engine-001.trailmem.com` CNAME →
   `trail-engine-001.fly.dev`; `engine.trailmem.com` CNAME →
   `engine-001.trailmem.com`.
4. Fly certs for both.
5. F168 Beam Sanne's local trail.db → engine-001 at
   `/data/sanne-andersen/trail.db`.
6. Hand-create Bearer key for Sanne's website, share with
   sanne-andersen peer session.
7. Smoke test: `curl https://engine.trailmem.com/api/v1/chat` with
   Bearer.

### Phase 1B — Admin (this week)

1. `flyctl apps create trail-admin --org broberg-ai`, 1 GB volume.
2. Build admin Docker image.
3. Migration 0027 creates `control.db` schema.
4. Hand-seed organizations + control_tenants + tenant_engines for
   Sanne via SQL on volume.
5. Magic-link login flow.
6. Reverse-proxy tenant-scoped admin UI to engine-001.
7. DNS: `app.trailmem.com` CNAME → `trail-admin.fly.dev`.

### Phase 1C — Provisioning script (rest of this week)

Implemented per F169.

### Phase 2 — Multi-engine

Implemented per F170 when load requires.

## Open questions

- **Admin and engine on same machine, or separate?** Question for
  Phase 1 cost: admin is low-traffic (Christian + maybe Sanne logged in
  once a week) and engine is the hot path. Easiest: separate apps so
  scaling rules diverge later. Decision: **separate apps**.
- **Engine memory size?** `shared-cpu-1x` 256 MB matches `trail-landing`
  but engine has Vision-rerun jobs running. Bump to 512 MB or 1 GB.
  Decision: **`shared-cpu-1x` with 1 GB RAM** for engine; admin stays
  256 MB. Revisit when we have real metrics.
- **Volume size for engine?** Sanne's full corpus is small (~50 MB DB
  + ~500 MB images). 5 GB volume gives 10× headroom for first year +
  N additional tenants. Decision: **5 GB**.
- **Backup before F153?** `flyctl ssh sftp` weekly tarball is
  acceptable interim. F153 lands proper continuous R2 backup.

## Verification plan

`apps/server/scripts/verify-f33-multi-tenant-routing.ts`:

1. Stand up local mock control.db with two test tenants (`sanne-test`
   + `customer-002-test`) pointing at the same engine.
2. POST to engine `/api/v1/chat` with each tenant's Bearer key.
3. Assert the engine opened the right `/data/{slug}/trail.db` for
   each request (instrument the DB-open call).
4. Revoke `sanne-test` key in control.db; wait 61 s for cache TTL;
   assert next request returns 401.
5. Run `flyctl deploy --dry-run` for both apps to verify Dockerfiles
   compile cleanly.

For prod smoke test (after Phase 1A ships):
- `curl -H 'Authorization: Bearer <sanne-key>' https://engine.trailmem.com/api/v1/retrieve?q=test`
- Assert 200 + JSON shape matches F160 contract.
