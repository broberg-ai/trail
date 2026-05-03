# F181 — Trail Routines: User-Defined Scheduled KB Workflows

> The action layer Trail's compile-and-query design has been missing. A Routine is a user-authored markdown file that declares a deterministic query (FTS5 or SQL against the KB), an LLM synthesis prompt, a schedule, and a write-target — and runs itself on cron. Outputs land as candidates in the F143 queue, never as direct writes; F19 confidence-policy + F106 Solo Mode govern auto-approval. Tier: Pro+. Effort: Medium-Large — 5-7 days for Phase 1 + Phase 2. Status: Planned.

## Open questions (interim plan-doc)

This is an **interim plan-doc** written 2026-05-03 from Yanli Liu's "RAG, LLM Wiki, or GBrain" article (see [LIU-ARCHITECTURES](../thinking/LIU-ARCHITECTURES.md)). Several scope decisions are still fuzzy and recorded here so the implementation session can resolve them rather than re-derive context:

1. **Per-KB or per-tenant scoping?** Per-KB is simpler (Routines live alongside `_schema.md` in each KB) but cross-KB digests ("show me what changed across all my KBs this week") are an obvious power-user need. Phase 1 ships per-KB; cross-KB is Phase 4.

2. **Always-on layer?** GBrain's `signal-detector` pattern fires on every inbound message — runs as a cheap sub-agent in parallel with the main response. For Trail this could mean "on every chat-question, log the question to a `query-log/` Neuron for later review." Powerful but expensive; explicitly **out of scope for Phase 1**. Re-evaluate after Phase 1+2 prove the cron-only path.

3. **MCP-tool calls from Routines?** If a Routine can call any MCP tool, the surface area explodes (auth, blast-radius, cost). Phase 1 limits Routines to: FTS5/SQL query against the local trail.db + a single LLM call. No external tool-use. MCP integration is a separate F-number when/if it ships.

4. **Mutating Routines?** Should a Routine be able to *modify* existing Neurons (e.g. add a backlink, refresh an `lastReviewed` field) or only *emit new candidates*? Phase 1 is **emission-only** — strict alignment with F91/F17 queue-mediation. Mutating routines are Phase 5+.

5. **Webhook / event-triggered routines?** Cron is the simplest model. Webhook-fired routines (`POST /webhook/routine/:name`) and event-fired routines (`on candidate_approved`) are Phase 4.

6. **How does a Routine declare its query language?** YAML frontmatter `query.type: fts5|sql` is the proposal. Alternative: split into two files (`routine.md` for prompt + behaviour + `routine.sql` for the deterministic step). YAML is denser; two-file is more editable. Default to YAML, revisit if frontmatter gets unwieldy.

7. **Default model?** Per F149 + F179: Routines default to `gemini-2.5-flash` (cheap + Hobby-tier-friendly), Pro tier can opt into `sonnet` per-routine. Hardcode default in Phase 1, expose model-picker in Phase 2 admin UI.

These open questions are blocking neither the plan nor the F-number, but the implementer should resolve them before writing migration code.

## Motivation

Trail today has a **passivity gap** — Yanli Liu's framing of the LLM Wiki architecture in *RAG, LLM Wiki, or GBrain? How Your Agent Remembers Changes Everything* (April 2026):

> *"And the wiki is passive. It compiles knowledge beautifully, but it doesn't act on it. It won't notice that a deadline mentioned in three sources has passed. It won't trigger a notification when a new document contradicts a standing policy. It knows — but it doesn't do."*

Trail's lint scheduler (F32/F118/F158) and scheduled re-compilation (F79) close part of this gap, but only for **system-defined maintenance work**. A user cannot say "every Monday morning, summarise new Neurons I added last week into a `weekly-brief-{date}` digest" or "every day at 09:00, scan my contract Neurons for new force-majeure references and surface them to the queue."

Liu's article positions this as the third architecture in agent memory — alongside RAG (retrieve at scale) and LLM Wiki (compile at depth) sits **Fat Skills / GBrain (act on what is known)**. The Garry Tan reference implementation runs 21 cron jobs across 24 fat-skill markdown files, with a deterministic-vs-latent split: skills call SQL/API for repeatable parts and LLM for synthesis parts.

Trail's natural translation of this pattern is **Routines**: user-authored markdown files that declare a schedule, a deterministic query against the KB, an LLM synthesis prompt, and a write-target. The scheduler runs them, the queue mediates the writes, the credits-system meters the cost.

### Why now (and why interim)

The plan-doc lands now while the source article is fresh and the architectural shape is clear. **Implementation is explicitly deferred** until at least one paying tenant (Sanne) is shipped on the basic compile-and-query path — Routines is feature-creep before product-market-fit if we ship it during onboarding. Reserved as "Planned, post-Sanne-launch" priority.

### The vision-fit argument

Trail's pitch is "compile your knowledge, query it forever cheap." Routines extends this to "compile, query, **and let the system do recurring synthesis work for you while you sleep**" — without changing the underlying compile-time invariant. Every Routine output goes through the same F143 queue path as ingest candidates, so the curator stays in control. The KB as document of record never silently mutates.

This is consistent with Trail's existing divergence from Karpathy's "humans read wiki, don't write to wiki" rule: Trail already has F91 Neuron Editor + F17 queue-mediated curation that allows curated LLM-writes to land. Routines reuses the same trust model.

## Scope

### In scope (Phase 1 + Phase 2)

- **Routine files** at `/routines/{name}.md` per KB, with YAML frontmatter declaring schedule + query + prompt + write-target + cost-controls
- **Routine-scheduler service** (`apps/server/src/services/routine-scheduler.ts`) mirroring the structural pattern of `lint-scheduler.ts` — polls DB every 5 min, picks routines where `next_run_at < NOW()`
- **Idempotency-signature pattern** ported from F158 — routine that has already produced output for the same query+source-set skips the LLM call
- **Deterministic query step** supporting `fts5` (full-text search against `documents_fts`) and basic `sql` (SELECT-only, sandboxed)
- **Latent synthesis step** — single LLM call via existing `apps/server/src/services/llm/router.ts`, with model + provider per F149 + F179
- **Queue-mediated write-back** — Routine output emits one candidate to F143 with `kind: routine` and `metadata.connector: routine`. Confidence policy per F19 + F106 governs auto-approval.
- **Admin Routines tab** — list view (routine name, next-run, last-run, last-status, paused/active toggle), Monaco edit-view for routine markdown, frontmatter validator, test-run button (dry-runs deterministic step + LLM call without queue-emit)
- **Per-routine cost metering** — F156 credits debited per Routine run, visible in admin (per-routine spend over last 30 days)
- **Per-routine quiet-hours support** — Routine declares `quiet_hours: 23-08` in frontmatter; scheduler respects it. Default = no quiet hours.
- **Audit trail** — every Routine run produces a row in `activity_log` (existing infrastructure) with kind `routine_run`, status (success/skipped/failed), cost, output candidate id

### Non-goals (Phase 1)

- Always-on / signal-detector layer (fires on every inbound message)
- Mutating Routines (modifies existing Neurons in-place)
- MCP tool-calls from inside a Routine
- Webhook / event-triggered Routines
- Cross-KB Routines
- Sharing Routines between tenants (Routine marketplace / templates library)
- Implicit intent-routing (RESOLVER.md pattern from GBrain — matching user chat to a Routine via skill descriptions)
- Multi-step workflows (Routine A's output triggers Routine B)
- Routines that call external APIs (Slack, Notion, etc.)

Several of these are deferred to Phase 4-5 explicitly.

## Architecture sketch

### Data model

New table `routines`:

```sql
CREATE TABLE routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kb_id INTEGER NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                  -- slug, unique within KB
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'errored'
  frontmatter_json TEXT NOT NULL,      -- parsed YAML, validated against zod schema
  body TEXT NOT NULL,                  -- markdown body (the LLM prompt template)
  schedule_cron TEXT,                  -- denormalised from frontmatter for query-perf
  next_run_at INTEGER,                 -- unix-ms; NULL when paused or unschedulable
  last_run_at INTEGER,
  last_run_status TEXT,                -- 'success' | 'skipped' | 'failed'
  last_run_signature TEXT,             -- F158-style sha256 over (query-result-set + frontmatter-hash)
  last_run_error TEXT,
  last_run_cost_credits REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (kb_id, name)
);

CREATE INDEX idx_routines_next_run ON routines(next_run_at) WHERE status = 'active';
```

Source-of-truth is `/routines/{name}.md` files in the KB filesystem (synced to DB on save, like Neurons). Migration TBD when assigned an implementation slot.

### Frontmatter shape

```yaml
---
name: weekly-brief
schedule: "0 8 * * 1"           # cron, Monday 08:00
quiet_hours: "23-08"            # optional, scheduler skips
query:
  type: fts5                    # fts5 | sql
  q: "created_at >= datetime('now', '-7 days') AND tag:#mondaybrief"
  limit: 50
prompt_path: "./prompt.md"      # OR inline body below
writes_to:
  kind: candidate                       # candidate | log (log = activity_log only, no queue)
  candidate_kind: routine-digest        # surfaces in queue UI as "Routine: weekly-brief"
  target_path: /neurons/digests/        # naming hint for the LLM, slug derived from prompt
model:
  provider: openrouter               # openrouter | anthropic-direct | google-direct
  id: gemini-2.5-flash
  budget_credits: 5                  # max credits per run; abort if exceeded mid-call
mutating: false                       # phase-1 enforcement: must be false
---

You are running the weekly-brief Routine for KB {{kb.name}}.

Query results follow:
{{query_results}}

Synthesise these into a single coherent weekly-digest Neuron in markdown.
Use the format: ...
```

Validation: Zod schema in `packages/shared/src/routines.ts`. Implementation copies the F101 type-frontmatter validation pattern.

### Scheduler

`apps/server/src/services/routine-scheduler.ts`:

```ts
export function startRoutineScheduler(deps: { tenant: TenantContext, db: TrailDatabase }): () => void {
  const tick = async () => {
    const now = Date.now();
    const due = deps.db.prepare(`
      SELECT * FROM routines
       WHERE status = 'active'
         AND next_run_at IS NOT NULL
         AND next_run_at <= ?
       LIMIT 5  -- batch size, prevents thundering herd
    `).all(now) as RoutineRow[];

    for (const routine of due) {
      if (isInQuietHours(routine.frontmatter.quiet_hours, now)) {
        rescheduleSkipped(routine);
        continue;
      }
      await runRoutine(routine, deps).catch(err => recordRoutineError(routine, err));
    }
  };
  const handle = setInterval(tick, 5 * 60_000).unref();
  return () => clearInterval(handle);
}
```

Pattern matches `lint-scheduler.ts`. Per-engine, multi-tenant: each tenant's scheduler instance is started in `apps/server/src/lib/multi-tenant/tenant-bootstrap.ts` alongside the existing lint-scheduler.

### Execution flow

```
runRoutine(routine):
  1. Compute query_signature = sha256(frontmatter_hash + query_result_ids + neuron_versions)
  2. If query_signature == routine.last_run_signature: skip, log 'idempotent-skip', stamp last_run_at
  3. Resolve query (fts5 or sql) → rows
  4. If rows.length == 0 and routine.skip_empty (default true): skip, stamp last_run_at + signature
  5. Render prompt template (handlebars-ish, hardcoded {{query_results}} + {{kb.*}} placeholders)
  6. Call LLM via router.ts with model from frontmatter, budget cap = budget_credits
  7. If LLM output != null:
     - emit candidate to F143 queue with metadata.connector = 'routine', metadata.routine_id = routine.id
     - log activity_log row (kind: routine_run, status: success, cost, output_candidate_id)
     - update routine.last_run_at, last_run_status, last_run_signature, last_run_cost_credits
  8. Compute next_run_at from cron expression, write back
```

Idempotency is critical: F158's signature pattern guarantees a re-run of the same Routine on unchanged source material produces zero LLM cost. This makes "weekly digest" cheap on quiet weeks.

### Queue integration (F143)

Routine outputs are F143 candidates with:

- `kind` = `'routine'`
- `metadata.connector` = `'routine'` (new connector id, registered in F95 `packages/shared/src/connectors.ts`)
- `metadata.routine_id` = routine.id
- `metadata.routine_name` = routine.name
- `confidence` = derived from prompt + output (F19 axis-2 dynamic confidence — when that lands; until then, hardcoded `0.7` per Routine, overridable via frontmatter)
- `action_zone` per F174 = `green` if `confidence >= 0.85`, else `yellow`

Queue UI gets a new connector-chip filter `Routine` (already auto-picked-up per F95 filter pattern).

### Admin UI (Phase 2)

New `/routines` route in `apps/admin`:

- List view: table of routines per KB, columns = name, schedule (human-readable cron via cronstrue), next-run, last-run, last-status, last-cost, paused-toggle
- Edit view: Monaco editor with YAML+markdown highlighting. Frontmatter validation inline. "Test run" button executes deterministic query + LLM call, shows result in side panel, **does not emit to queue** (dry-run).
- Create flow: starter templates (weekly-brief, daily-lead-scan, weekly-orphan-report) — one-click create + open editor
- Per-routine spend graph (last 30d cost in credits)

### Cost controls

- Per-Routine `budget_credits` hard cap — LLM call aborts if exceeds
- Per-tenant Routines-monthly-cost cap (default 100 credits/month for Hobby, 500 for Pro, 5000 for Business)
- F149 + F179 routing: default model = `gemini-2.5-flash` via OpenRouter; tenant can opt into Anthropic-direct + batch-API-mode (50% off) for non-urgent Routines

## Dependencies

- **F143** (persistent ingest queue) — Routines emit here; reuse candidate lifecycle, not a parallel system
- **F19** (confidence-based auto-approval) — governs whether Routine outputs auto-publish or wait for curator
- **F106** (Solo Mode) — bypasses approval for solo curators who trust their Routines
- **F156** (credits) — meters Routine cost; admin UI exposes per-routine spend
- **F149** + **F179** (model selector + provider-direct bulk) — Routine picks cheap path by default
- **F158** (idempotent contradiction-lint signature pattern) — reuse the signature-skip pattern for Routine idempotency
- **F140** (hierarchical schema files) — Routines live in `/routines/` mirroring `_schema.md` placement; same markdown-with-frontmatter authoring story
- **F95** (connector attribution) — register `routine` connector in `CONNECTORS` registry
- **F174** (Action Zone Governance) — Routine outputs map to action zones; surface in Red Digest if zone = red

## Rollout phases

**Phase 1 — Foundation (3 days)**
- Migration: `routines` table + indexes
- Zod schema for routine frontmatter
- `routine-scheduler.ts` service with FTS5 query support only (no SQL)
- F143 queue emission with `connector: routine`
- F95 connector registration
- One starter Routine ("weekly-brief") shipped as DB seed for new KBs (paused by default)
- F47-style verification script (`apps/server/scripts/verify-routine.ts`) — runs end-to-end with synthetic KB

**Phase 2 — Admin UI (2 days)**
- `/routines` list + edit + test-run + create-from-template
- Monaco editor with YAML+markdown highlighting + frontmatter validation
- Per-routine spend graph (reuses F156 instrumentation)
- Connector-chip filter `Routine` in queue UI

**Phase 3 — Polish (1-2 days, optional Phase 1 GA)**
- SQL query support (with strict SELECT-only + table-allowlist)
- Per-tenant monthly-cost cap enforcement
- Quiet-hours edge cases (overnight schedules, DST handling)
- Activity-log filter by `kind: routine_run`
- Documentation page at `docs/ROUTINES.md` for curators

**Phase 4 — Future, separate F-number**
- Always-on signal-detector layer
- Mutating Routines (in-place Neuron edits)
- MCP tool-calls from inside Routines
- Webhook / event-triggered Routines
- Cross-KB Routines

**Phase 5 — Speculative**
- Routine marketplace / template library
- RESOLVER.md style implicit intent-routing from chat
- Routine-chains (A's output triggers B)

## Effort estimate

Phase 1 + Phase 2 combined: **5-7 days** of focused engineering. Comparable to F138 Work Layer's 3-4 day estimate when it was deferred — F181 is bigger because it crosses scheduler + queue + admin UI + cost-metering + new connector. Phase 3 polish: optional, +1-2 days.

## Verification (per CLAUDE.md "Verification before 'this works'")

Implementation MUST ship with `apps/server/scripts/verify-routine.ts` proving end-to-end:

1. Create synthetic KB with 5 Neurons tagged `#test`
2. Insert a Routine row with FTS5 query for `#test` + minimal LLM prompt
3. Force `next_run_at = NOW`
4. Tick scheduler once
5. Assert: candidate appeared in `queue_candidates` with correct `metadata.routine_id`
6. Assert: `routines.last_run_status = 'success'`, `last_run_signature` populated
7. Re-tick scheduler with same source data
8. Assert: second run logged as `idempotent-skip`, no new candidate emitted
9. Assert: `activity_log` has 2 rows with `kind = 'routine_run'`

This script is the F47-style runtime probe — typecheck alone does not prove the scheduler is doing what it claims.

## Status

**Planned, deferred to post-Sanne-launch.** F-number reserved + plan-doc captured 2026-05-03 per CLAUDE.md hard rule (plan written in same turn as F-number, not faked-skipped). Implementation date: TBD by Christian.

Reserved-not-implemented is intentional. The architectural shape is clear, but shipping Routines before Trail's basic compile-and-query path is rock-solid for a paying tenant would be feature-creep against the product-market-fit thesis. Liu's article makes the case for the action-layer; that case is correct but not urgent.

---

_Plan-doc derived from [docs/thinking/LIU-ARCHITECTURES.md](../thinking/LIU-ARCHITECTURES.md) — 2026-05-03 trail-research session._
