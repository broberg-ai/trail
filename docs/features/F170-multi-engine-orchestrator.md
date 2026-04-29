# F170 — Multi-engine orchestrator (router + tenant migration)

**Status:** Planned · **Phase:** 2 (lands when fleet ≥ 2 engines) · **Owner:** trail-server · **Depends on:** F33, F168, F169

## TL;DR

When the engine fleet grows past one machine, three new things are
needed: (1) a **routing layer** at `engine.trailmem.com` that picks
the right engine per request, (2) a **tenant migration** primitive
that moves a tenant from one engine to another with no downtime, and
(3) a **fleet-aware admin** view so Christian can see capacity and
shuffle tenants by hand.

F170 is the bridge between "engine-001 holds everything" (F33) and
"the fleet self-balances" (F171, future). The orchestrator runs
manually from a CLI in F170; F171 layers automated rules on top.

This plan-doc is **forward-state**: it ships when we have 2+ engines.
It is written now, atomic with F33, so F33's schema (`engines` +
`tenant_engines`) is forward-compatible. Implementation is paused
until customer #2 lands or Sanne's load demands a dedicated engine.

## Motivation

- F33's `engine.trailmem.com` is a CNAME directly to engine-001.
  When engine-002 spawns, that CNAME can't point at two places.
- Tenants need to be assignable to a specific engine. Today
  `tenant_engines` carries that mapping; tomorrow it must drive
  request routing.
- Operator needs to migrate tenants between engines without taking
  the customer offline (e.g. moving a heavy tenant from a busy
  engine to a fresh one). That's Beam-with-zero-downtime.

## Scope (in)

### 1. Routing layer at `engine.trailmem.com`

Two viable architectures, decision deferred to implementation:

**Option A — Cloudflare Worker** (preferred)
- Worker bound to `engine.trailmem.com/*`
- On every request, parse the Bearer token, hash, query
  `https://app.trailmem.com/api/internal/resolve-route?key_hash=…`
- Cache `(key_hash → engine_url)` for 60 s in Worker KV
- Rewrite request URL to the resolved engine and forward
- Edge-fast, infinite scale, fits Cloudflare's free-tier easily

**Option B — Hono micro-service on Fly**
- New Fly app `trail-router` at `engine.trailmem.com`
- Same logic as Option A but server-side
- Pros: same stack everywhere, easier local-dev parity
- Cons: another machine to maintain; not at the edge

Decision: Option A. Cloudflare Worker. Deploy via Wrangler CLI;
source lives in `apps/router/`.

### 2. Tenant migration command

```
pnpm trail tenant migrate <slug> --to <engine-id>
```

Flow:

```
1. Pre-flight:
   - Verify tenant exists in tenant_engines (current engine = source)
   - Verify destination engine has capacity (engines.capacity_*)
   - Verify destination engine is healthy (GET /health)
   - Acquire migration lock in control.db (one migration per tenant)
2. Drain source:
   - Set tenant_engines.draining_since = now
   - Router begins serving 503 with Retry-After to public traffic for this tenant
   - Wait up to 30 s for in-flight jobs (F164) to checkpoint
3. Beam:
   - Source engine F168-exports tenant → streams tar.gz to destination
   - Destination F168-imports atomically
   - Verify checksums via /internal/beam/manifest
4. Flip routing:
   - UPDATE tenant_engines SET engine_id=destination, engine_url=…, draining_since=NULL
   - Bust router cache (POST internal cache-bust to Cloudflare Worker)
   - Public traffic now reaches destination
5. Cleanup source:
   - Source engine moves /data/{slug}/ → /data/_archive/{slug}-{ts}/
   - Manual cleanup later; allows quick rollback
6. Release lock; emit migration audit row
```

Tenant downtime is the drain window (typically 5-30 s). Acceptable
for Phase 2; Phase 3 layers shadow-write replication for true
zero-downtime if customers demand it.

### 3. Fleet view in admin

`/admin/fleet` page (admin app):
- Engine cards: id, region, public_url, tenant count,
  total trail.db bytes, free volume bytes, last health check
- Tenant list per engine: slug, name, db size, last activity
- Actions:
  - "Migrate tenant" → modal → pick destination → confirm → run
  - "Retire engine" (only enabled when 0 tenants assigned)
  - "Spawn engine" → calls F169's CLI server-side via admin
- Real-time refresh via SSE from each engine's /health endpoint

### 4. Health + capacity reporting

Each engine exposes `GET /internal/health-detail` (admin-only):

```json
{
  "engine_id": "engine-001",
  "tenants_count": 12,
  "trail_db_total_bytes": 4123456789,
  "volume_free_bytes": 1234567890,
  "in_flight_jobs": 3,
  "p50_query_ms": 45,
  "p99_query_ms": 320,
  "uptime_seconds": 86400
}
```

Admin polls every 60 s and caches in `engine_health_snapshots` table.

### 5. Schema additions on control.db

```sql
-- Migration 0030 (admin only)

ALTER TABLE tenant_engines ADD COLUMN draining_since TEXT;
ALTER TABLE tenant_engines ADD COLUMN previous_engine_id TEXT;

-- FK that F33 deferred:
-- (DROP existing tenant_engines table; CREATE new with FK to engines.id;
--  copy rows. SQLite ALTER doesn't add FKs in-place.)

CREATE TABLE migration_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES control_tenants(id),
  from_engine_id TEXT NOT NULL,
  to_engine_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,                  -- 'running' | 'completed' | 'failed'
  drain_ms INTEGER,
  beam_ms INTEGER,
  error_message TEXT
);

CREATE TABLE engine_health_snapshots (
  engine_id TEXT NOT NULL REFERENCES engines(id),
  recorded_at TEXT NOT NULL,
  tenants_count INTEGER NOT NULL,
  trail_db_total_bytes INTEGER NOT NULL,
  volume_free_bytes INTEGER NOT NULL,
  in_flight_jobs INTEGER NOT NULL,
  p50_query_ms REAL,
  p99_query_ms REAL,
  PRIMARY KEY (engine_id, recorded_at)
);
```

## Scope (out / explicit non-goals)

- **Auto-scaling** (spawn engines based on metrics) — F171.
- **Zero-downtime migration** (shadow writes, dual-read window) —
  Phase 3 if/when a customer's SLA demands it.
- **Cross-region routing** — all engines in `arn`; geo-routing
  is a future feature.
- **Tenant sharding within a single engine** (one trail.db per KB
  instead of per tenant) — explicitly rejected; per-tenant is the
  unit of isolation.
- **Self-service tenant migration via UI without operator** — admin
  Fleet view is operator-only; tenants don't get a "move me" button.

## Architecture sketch

```
              Public traffic
                    ↓
         engine.trailmem.com (Cloudflare)
                    ↓
        ┌───────────┴───────────┐
        │  Cloudflare Worker    │
        │  - parse Bearer       │
        │  - lookup → engine_id │   ←── HTTPS lookup ───┐
        │  - forward request    │                       │
        └─────┬───────────┬─────┘                       │
              │           │                             │
              ↓           ↓                             │
   ┌─────────────┐   ┌─────────────┐                    │
   │ engine-001  │   │ engine-002  │   ┌────────────────┴─────────────┐
   │ tenants:    │   │ tenants:    │   │  app.trailmem.com (admin)    │
   │  sanne      │   │  customer-2 │   │  /api/internal/resolve-route │
   │  customer-3 │   │  customer-4 │   │  /admin/fleet                │
   └─────────────┘   └─────────────┘   └──────────────────────────────┘
```

### Key invariants

- **Single source of truth for routing.** Cloudflare Worker is
  cache-only; control.db's `tenant_engines` is canonical. Worker
  cache TTL is 60 s — propagation lag for routing changes is
  bounded.
- **Migrations are atomic at flip-time.** The `UPDATE
  tenant_engines` is the cutover; everything before is
  drain-then-copy, everything after is cleanup. If post-flip cleanup
  fails, public traffic is already on the new engine and an operator
  can re-run cleanup manually.
- **Source engine retains data until manual cleanup.** `/data/_archive/`
  on source holds the post-migration tenant copy. Operator cleans it
  up after a soak window (e.g. 24 h).

## Dependencies

- **F33** — admin + control.db + tenant_engines.
- **F168** — Beam primitive that powers migration.
- **F169** — engine spawning (`engines` table).
- **Cloudflare Worker subscription** — already on Christian's
  account for DNS Manager.

## Rollout

### Phase 1 (Beam-ready prep, ships in F33's commit)

- F33's `tenant_engines` schema includes the columns F170 will use
  (`engine_url`, `engine_internal_url`). No schema change needed in
  F170 Phase 1.
- F33's engine code reads tenant→engine routing from control.db;
  Phase 1 has 1 row, but the code path is the real one.

### Phase 2A — Worker + manual migration (lands when customer #2 onboards or Sanne demands dedicated engine)

1. `apps/router/` — Cloudflare Worker source.
2. Migration 0030 — schema additions.
3. `pnpm trail tenant migrate` CLI.
4. Admin Fleet view (read-only first).
5. Verify-script: synthetic 2-engine setup, migrate a tenant
   between them, assert public traffic continuity.

### Phase 2B — Admin migrate UI

- "Migrate" button on Fleet view kicks off the same flow as the CLI.
- SSE progress in admin while migration runs.

### Phase 2C — Engine retire flow

- Admin lets operator retire an engine; UI walks them through "all
  tenants must be migrated first".

### Phase 3 — F171 auto-scale

Out of F170's scope.

## Open questions

- **Worker vs. micro-service** — leaning Worker. Reconsider if
  Cloudflare's free-tier req limits become tight (~100k req/day) or
  if local-dev parity becomes painful (Wrangler dev server is OK
  but not as fast as `bun --watch`).
- **Migration drain window** — can we get below 5 s? Phase 2 doesn't
  optimize for this; Phase 3 might via shadow-write streaming.
- **What happens if the source engine dies mid-migration?** The
  destination has the data (Beam was atomic on import); flipping
  `tenant_engines` is a single SQL update on admin. Admin remains
  the canonical authority. Manual operator step: confirm imported
  data integrity then issue the flip.
- **Cost-tracking attribution** — per-tenant compute cost on a
  shared engine is a Phase 3 concern; F170 doesn't address it.

## Verification plan

`apps/server/scripts/verify-f170-orchestrator.ts`:

1. **Synthetic 2-engine fleet** — spin up two engines via F169
   spawn (dry-run), seed `engines` + `tenant_engines` for two
   tenants on engine-001.
2. **Migration end-to-end** — invoke `pnpm trail tenant migrate
   tenant-A --to engine-002`. Assert: drain flag set, beam runs,
   destination has the data, tenant_engines updated, source data
   moved to _archive, migration_log row written with status=completed.
3. **Worker resolution test** — POST a fake request to a local
   Wrangler dev server with a Bearer key, assert the Worker
   forwarded to the right engine_url after lookup.
4. **Cache-bust** — change tenant_engines for a tenant, send
   cache-bust to Worker, next request goes to new engine within 1 s.
5. **Health snapshot polling** — admin reads `/internal/health-detail`
   from each engine, inserts into `engine_health_snapshots`, Fleet
   view renders without N+1 queries.
