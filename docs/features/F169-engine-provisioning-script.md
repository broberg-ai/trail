# F169 — New-engine provisioning script (`pnpm trail engine spawn`)

**Status:** Planned · **Phase:** 1 · **Owner:** trail-server · **Depends on:** F33

## TL;DR

Spinning up a new Trail engine on Fly should be one command, not a
checklist. F169 wraps `flyctl` + the Cloudflare DNS Manager MCP +
control.db registration into a single script:

```
pnpm trail engine spawn engine-002
```

… and the engine is live, DNS is wired, and the `tenant_engines`
table knows about it. Phase 1 lets us onboard customer #2 the moment
they walk through the door.

## Motivation

- F33 ships engine-001 by hand. That's fine for tonight.
- The MOMENT a second customer says yes, "by hand" becomes a
  reproducibility risk: `flyctl apps create` flags, volume size,
  region, secret-set, DNS A vs CNAME, cert provision order — every
  manual step is a chance to mis-configure prod.
- F170's orchestrator (auto-scale, fleet rebalancing) needs a
  programmatic primitive to spawn engines. F169 is that primitive.
- Christian asked for this script "allerede nu" — it gets written
  once and used N times.

## Scope (in)

### CLI surface

```bash
# Create + deploy a new engine
pnpm trail engine spawn <engine-id>
   [--region arn]              # default arn per global policy
   [--memory-mb 1024]          # default 1 GB
   [--volume-gb 5]             # default 5 GB
   [--image registry.fly.io/trail-engine:<tag>]  # default = current main

# List all engines (queries control.db tenant_engines + flyctl status)
pnpm trail engine list

# Retire an engine (only if zero tenants assigned — F170 migrates first)
pnpm trail engine retire <engine-id>

# Rotate the BEAM_TOKEN secret on a single engine
pnpm trail engine rotate-beam-token <engine-id>

# Rotate BEAM_TOKEN across the entire fleet
pnpm trail engine rotate-beam-token --all
```

All commands are idempotent — re-running `spawn engine-002` after
the app already exists prints "already provisioned" and continues to
the next not-yet-done step (DNS, cert, control.db row).

### What `spawn` does, step by step

```
1. validate engine-id matches /^engine-\d{3}$/
2. flyctl apps create trail-engine-{NNN} --org broberg-ai
3. flyctl volumes create trail_engine_data \
      --region {REGION} --size {VOLUME_GB} --app trail-engine-{NNN}
4. flyctl secrets set --app trail-engine-{NNN} \
      BEAM_TOKEN=$(openssl rand -hex 32) \
      ANTHROPIC_API_KEY=$(passread anthropic-prod) \
      OPENROUTER_API_KEY=$(passread openrouter-prod) \
      CONTROL_PLANE_URL=https://app.trailmem.com
5. flyctl deploy -c apps/server/fly.toml --app trail-engine-{NNN} \
      --image-label spawn-{git-sha}
6. mcp__dns-manager__dns_create_record \
      zone=trailmem.com type=CNAME \
      name=engine-{NNN}.trailmem.com value=trail-engine-{NNN}.fly.dev
7. flyctl certs create engine-{NNN}.trailmem.com --app trail-engine-{NNN}
8. wait until cert status == 'verified' (poll every 5s, max 2 min)
9. POST https://app.trailmem.com/api/internal/engines/register
      { "engine_id": "engine-{NNN}",
        "engine_url": "https://engine-{NNN}.trailmem.com",
        "engine_internal_url": "http://trail-engine-{NNN}.flycast",
        "region": "arn",
        "provisioned_at": now }
   ← admin inserts a row into the engines table (NEW: see schema below)
10. smoke test: curl /health on the new engine, assert 200.
11. print summary + paste-ready Bearer-key minting command for the
    operator if they want to test routing.
```

### New `engines` table on admin's control.db

F33 already adds `tenant_engines` (tenant→engine assignment). F169
adds the engine catalog itself:

```sql
-- Migration 0028 (admin only)
CREATE TABLE engines (
  id TEXT PRIMARY KEY,                  -- 'engine-001'
  fly_app_name TEXT NOT NULL UNIQUE,    -- 'trail-engine-001'
  public_url TEXT NOT NULL,             -- 'https://engine-001.trailmem.com'
  internal_url TEXT,                    -- 'http://trail-engine-001.flycast'
  region TEXT NOT NULL,                 -- 'arn'
  provisioned_at TEXT NOT NULL,
  retired_at TEXT,                      -- NULL while serving
  capacity_tenants INTEGER DEFAULT 50,  -- soft target; F170 enforces
  capacity_db_mb INTEGER DEFAULT 4096,  -- soft target; F170 enforces
  notes TEXT
);

-- F33's tenant_engines.engine_id becomes a FK to engines.id
-- (Phase 1 doesn't enforce; Phase 2 adds the FK constraint via
-- migration 0029 once we have multiple rows.)
```

`engines` is the catalog; `tenant_engines` is the assignment.
Separation matters because F170 needs to query "which engine has
the most spare capacity?" without scanning every tenant row.

### Configuration files

`apps/server/fly.toml` (engine) — single canonical config; the script
doesn't generate per-engine fly.toml files. Per-engine difference is
just the `--app` flag.

```toml
# apps/server/fly.toml — used for all trail-engine-* apps
app = "trail-engine-001"  # overridden per-deploy via --app flag
primary_region = "arn"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"     # let engines hibernate
  auto_start_machines = true
  min_machines_running = 1        # always 1 warm copy per engine

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 1024

[mounts]
  source = "trail_engine_data"
  destination = "/data"
```

### `apps/admin/fly.toml` (admin) — F33 ships this; F169 just references.

## Scope (out / explicit non-goals)

- **Auto-scaling.** F169 only spawns when a human runs the command.
  F171 layers metric-driven auto-spawn on top.
- **Tenant migration.** F169 does NOT move tenants. `engine retire`
  refuses if `tenant_engines.engine_id = ?` returns rows; F170
  provides the migration command.
- **Engine downgrade / right-sizing.** Memory/CPU adjustment after
  spawn is `flyctl scale` directly; F169 doesn't wrap it.
- **Multi-region engine.** All engines in `arn` (Stockholm) per
  policy. Multi-region is a future feature with proper data-residency
  thinking.
- **Custom engine images.** All engines run the same trail-engine
  image. Per-tenant code variations live as feature-flags inside
  the engine, not as separate images.

## Architecture sketch

```
Operator at terminal:
  $ pnpm trail engine spawn engine-002

apps/cli/engine.ts:
  ├─ shell out to flyctl (apps, volumes, secrets, deploy, certs)
  ├─ MCP call: mcp__dns-manager__dns_create_record (Cloudflare zone)
  ├─ HTTP POST to admin: /api/internal/engines/register (BEAM_TOKEN auth)
  └─ HTTP GET to new engine: /health (smoke)

admin /api/internal/engines/register:
  └─ INSERT INTO engines(...) → returns row

After spawn returns, control.db state:
  engines table:
    engine-001  | trail-engine-001  | https://engine-001.trailmem.com  | arn | 2026-04-29 | NULL
    engine-002  | trail-engine-002  | https://engine-002.trailmem.com  | arn | 2026-04-29 | NULL  ← new
  tenant_engines:
    sanne-andersen | engine-001 | ... | NULL    (still on engine-001)
    customer-002   | engine-002 | ... | NULL    (← onboard sets this)
```

### Key invariants

- **Spawn never assigns tenants.** A freshly-spawned engine has zero
  tenants. `tenant_engines` insert happens at onboard-time (F172) or
  via F170 migration command, not as part of spawn.
- **DNS update before cert.** `flyctl certs create` requires DNS to
  be resolving; we add the CNAME first, then ask Fly for the cert.
- **Idempotent re-runs.** Every step is "if-not-exists": apps create
  fails idempotently → check `flyctl apps list` first; volume create
  same; DNS record same (mcp_dns_upsert_record handles this); etc.

## Dependencies

- **F33** — admin + control.db + `tenant_engines` table must exist.
- **F168** — `BEAM_TOKEN` mechanism reused; F169 sets the secret on
  every spawned engine.
- **DNS Manager MCP** — already configured in `.mcp.json`.
- **`flyctl`** — Christian's machine has it. CI runs use
  `superfly/flyctl-actions/setup-flyctl@master` in GH Actions.
- **`passread` or equivalent** — script needs read access to the
  shared API keys (Anthropic, OpenRouter). Phase 1: read from
  `~/.trail/secrets.env`. Phase 2: 1Password CLI. Don't hardcode.

## Rollout

### Phase 1 (this week — after F33 + F168 ship)

1. `apps/cli/engine.ts` (or `apps/server/scripts/engine-cli.ts`)
   implements `spawn`, `list`, `retire`, `rotate-beam-token`.
2. Migration 0028 adds `engines` table.
3. `/api/internal/engines/register` endpoint on admin.
4. Verify-script: dry-run spawn against a fake-flyctl shim, assert
   call sequence + DNS payload + control.db inserts.
5. Real spawn of `engine-002` (parked, no tenants) as a smoke test.

### Phase 2 (when F170 lands)

`engine-list` gains capacity columns ("75% full"); `engine-retire`
delegates tenant migration to F170's command; `auto-scale` daemon
calls `engine spawn` based on metrics.

## Open questions

- **Where does the script live?** Three plausible homes:
  - `apps/cli/` (new package, `@trail/cli`) — clean separation, but
    new package overhead.
  - `apps/server/scripts/engine-cli.ts` — fits today's pattern.
  - Root-level `scripts/trail.ts` — visible at repo top.
  
  Decision deferred to implementation: probably `apps/server/scripts/`
  to start, promote to `@trail/cli` if/when other CLI surfaces emerge
  (Beam already wants its own).
- **Should `spawn` also create the `apps/server/Dockerfile` if
  missing?** No — that's a build-system concern. Script assumes the
  Dockerfile exists (F33 ships it).
- **`engine-list` output format?** Plain text table by default,
  `--json` for machine consumption (used by F170 orchestrator).

## Verification plan

`apps/server/scripts/verify-f169-engine-cli.ts`:

1. **Spawn dry-run** — set `TRAIL_FLY_DRY_RUN=1`, run `spawn
   engine-002`, assert the script printed the exact flyctl + DNS +
   admin-register call sequence we expect, in the right order.
2. **Spawn idempotency** — run twice in a row (with dry-run), assert
   second run prints "already provisioned, skipping" for each step
   that succeeded the first time.
3. **List** — pre-seed `engines` with two rows, run `engine list`,
   assert the rendered table has both.
4. **Retire-with-tenants-fails** — pre-seed an engine with a tenant
   assigned, run `engine retire`, assert exit code 1 + clear error
   pointing at F170's migration command.
5. **Rotate-beam-token** — run `rotate-beam-token engine-001`, assert
   `flyctl secrets set BEAM_TOKEN=…` was called with a fresh 64-byte
   hex value and the new value was POSTed to admin so it knows to
   use the new token for `/internal/beam/*` calls.
