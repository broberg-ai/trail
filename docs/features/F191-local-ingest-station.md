# F191 — Local Ingest Station

**$0 Max-plan ingest into cloud tenants, driven by an interactive Claude Code session.**

Status: planned · Priority: high · Decided 2026-06-03 (Christian) · Supersedes idea `019e87f9`.

## Problem — the one reason this exists

Anthropic now **API-bills headless `claude -p`** across all of Christian's projects. Headless would otherwise have been the obvious way to run free Max-plan ingest. It isn't anymore: `claude -p` calls the metered API. The ONLY surface where Max-plan compute is genuinely **$0** is an **interactive, open Claude Code session**.

Consequences:
- The cloud engine has no `claude` CLI at all, so cloud ingest runs on **paid OpenRouter** (F190.6). For customers Christian implements + pays for himself, that cost is avoidable.
- **F190.6's premise that the `claude-cli` ingest backend (which spawns `claude -p`) is "free (Max plan)" is now FALSE** — that backend is API-billed too. The first thing F191 does is verify this and stop treating `claude -p` as $0. (Also contradicts ai-sdk's `transport:"subprocess"` = $0 assumption — flag to ai-sdk.)

**The escape hatch:** when Christian implements a customer himself, he runs ALL ingest through his own interactive cc session (Max plan, $0) and the Neurons land directly in the customer's cloud tenant. Cloud Trail stays API/metered via F190; this is the $0 path for self-implemented customers.

## Solution — pure Model B (cloud-native, free local compute)

The interactive cc session runs claude **locally (free)** but writes Neurons **directly to the cloud KB via trail MCP**. No local DB, no sync. The Station is a thin intake + dispatch + live-progress surface.

The elegant reuse: **split extract from compile** (already two phases — the Sources view has an "Extracted" tab):

1. **Drop file → Station uploads → cloud runs EXTRACT** (parsing only, no LLM cost) → source parked as `awaiting-local-compile`. The cloud OpenRouter compile is skipped for Station uploads.
2. **The interactive cc session runs COMPILE** via a new `/local-ingest` skill: it reads the awaiting sources + the compile prompt via trail MCP, compiles in-session (claude itself = $0 Max-plan compute), and `write`s the Neurons into the cloud KB. This is exactly the existing `/reingest` semantics (compile-only over already-extracted content) — but driven by the human's session instead of cloud OpenRouter.
3. **The Station follows live via `/api/v1/stream` SSE** — `candidate_created`/`candidate_resolved` tick in as the cc session writes. (Directly reuses the SSE-through-proxy fix shipped 2026-06-03.)
4. **Free-run telemetry:** every local compile still reports to upmetrics — a FREE run (cost=0, `subprocess:true`, connector `mcp:claude-code`, labels `{tenantId,kbId}`, capability `ingest`). The engine stamps it server-side on the trail MCP write, so `UPMETRICS_API_KEY` never leaves the engine. The cost panel then shows local ingest volume (free) alongside cloud ingest (paid).

Pickup is **skill-drain** (Christian's choice): the Station fills a pending queue cloud-side; any cc session with the trail MCP + the skill drains it (`/local-ingest`, or a SessionStart auto-drain hook like the existing `queue-drain`). Decoupled — "any cc session" satisfies the requirement. (buddy-intercom auto-notify is an optional later enhancement, not core.)

## Non-Goals (explicit — Model A is OUT)

- **No local DB.** No local mirror of per-tenant `trail.db`.
- **No sync engine.** No local-first source-of-truth, no conflict/merge resolution, no push-up step. Data is cloud-native from the first write.
- **No offline mode.** Online-only; the Station needs the cloud engine reachable.
- **No new LLM integration.** The compile is the human's cc session via trail MCP — no ai-sdk call, no provider SDK.
- **No full admin surface.** Sources/ingest only; everything else (queue review, neurons, graph, settings) stays in the full admin.

## Architecture sketch

```
Drop file → ingest-station (localhost)
   → POST upload to cloud engine → EXTRACT (free, no LLM)
   → source.status = 'extracted', awaiting-local-compile flag set

Interactive cc session  (Max plan = $0)
   /local-ingest skill:
     → read awaiting-local-compile sources via trail MCP (tenant-scoped)
     → compile each (compile prompt + content) IN-SESSION
     → trail MCP write → Neuron into CLOUD KB
     → engine stamps a FREE upmetrics run (mcp:claude-code, cost=0, {tenantId,kbId})
     → mark source done

ingest-station ← /api/v1/stream SSE  (candidate_created/resolved, live)
```

Reused wholesale: upload+extract endpoints · `/reingest` compile semantics · trail MCP `write` · `/api/v1/stream` SSE (just fixed) · control-plane auth · F95 `mcp:claude-code` connector · the Sources/drop-zone/ingest-status components. New: a thin shell app, a shared UI package, one cc skill, a small `awaiting-local-compile` source state, and the engine's free-run stamp.

## Stories

- **F191.1 — De-risk gate + `awaiting-local-compile` lifecycle.** FIRST: verify interactive-cc compile via trail MCP is genuinely $0 on Max (and confirm headless `claude -p` is API-billed). THEN: add the `awaiting-local-compile` source state, make Station uploads skip the cloud compile, expose a query for pending sources. If the $0 premise fails, the epic stops here.
- **F191.2 — `/local-ingest` cc skill.** The $0 compile driver: drain pending sources for the active tenant, run the compile prompt in-session, write Neurons via trail MCP, mark done. Optional SessionStart auto-drain hook (queue-drain pattern).
- **F191.3 — `apps/ingest-station` shell.** Thin Vite+Preact app; extract Sources/drop-zone/ingest-status into a shared `packages/ingest-ui` (single source, shared with apps/web); cloud control-plane auth + tenant picker; drop-zone → upload+extract.
- **F191.4 — Live progress + UX.** SSE-driven per-source compile progress in the Station; clear "waiting for an active ingest session" empty-state when nothing is draining.
- **F191.5 — Free-run upmetrics telemetry.** Engine stamps a FREE agent_run (cost=0, subprocess:true, connector mcp:claude-code, labels {tenantId,kbId}, capability ingest) when it receives a local-ingest MCP write, so the cost panel reflects local ingest volume. Key stays server-side.

## Dependencies

- Trail MCP `write` against the cloud engine from an interactive cc session (exists).
- `/api/v1/stream` SSE through the admin proxy (fixed 2026-06-03).
- Control-plane auth + tenant routing (F186/F188).
- F95 connectors (`mcp:claude-code` already defined).
- upmetrics free-run support (`metered.free_run_count` already in the cost API).

## Rollout

1. F191.1 de-risk gate — prove $0 before building anything else.
2. F191.2 skill — usable from any cc session even before the Station exists (drains pending sources).
3. F191.3 + F191.4 — the Station shell + live UX.
4. F191.5 — telemetry.

Christian dogfoods on a self-implemented customer tenant first.

## Open questions

- Auth for the Station: reuse the cloud magic-link session, or a pasted personal API key (F188 `trail_`)? (Leaning personal key for a thin tool.)
- Token counts for the free-run telemetry: does the interactive cc session expose its own usage to itself, or do we record run-count + $0 with tokens null/estimated?
- Does the `awaiting-local-compile` flag live as a new `documents` column/status, or a lightweight side-table? (Lean: a status/flag on the existing row.)
