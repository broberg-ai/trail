# F189 — Upmetrics Cost Integration (ai-sdk sink + read-API display)

> Route Trail's LLM calls through `@broberg/ai-sdk` so per-call cost lands in upmetrics, then read it back via upmetrics' F014 cost read-API and render it in the F151 Cost panel alongside the internal `ingest_jobs.cost_cents`. Tier: Phase 2 observability · Effort: Medium · Status: Planned (BLOCKED on deps).

## Problem

Trail already captures LLM cost (F151) — but only **per ingest-job**, only for the two ingest backends (`claude-cli`, `openrouter`), and only what those backends self-report (`total_cost_usd` → `Math.round(usd*100)`). Everything else that spends tokens is invisible to the Cost panel:

- **Chat turns** (`routes/chat.ts`) — metered in F159 but not surfaced in cost aggregates.
- **Vision** (`services/vision.ts`), **translation**, **tag-suggester**, **source-inferer**, **glossary-backfill**, **contradiction-lint** — all call LLMs, none feed the Cost dashboard.
- Cost is per-job, not per-call, so a job that fanned out 5 model calls is one opaque number with no provider/model/tier breakdown beyond `model_trail`.

Meanwhile upmetrics is building a **fleet-wide cost sink**: `@broberg/ai-sdk` now logs every LLM/agent call (tokens + `cost_usd` + provider/model/tier) to upmetrics' `agent_runs`, and upmetrics is shipping a public **F014 cost read-API** that lets each app pull its own accumulated cost. That API was shaped 1:1 from Trail's F151 pitfalls (see intercom thread #2379→#2381→#2415→#2416→#2417). Christian's directive: Trail adopts the SDK as its cost sink and reads the numbers back into Trail's own cost illustrations/tables.

## Secondary Pain Points

- **No single fleet view.** Today Trail cost lives only in Trail; upmetrics aggregates the whole `broberg-ai` fleet. Routing through the SDK puts Trail's spend in the same ledger as every other app.
- **Per-call granularity unlocks model-choice insight** that F151's per-job number can't give — finer data for F152's runtime-model recommendations.
- **Validates the SDK contract from the consumer side.** Trail is the design partner for upmetrics F014; dogfooding it confirms the read-API is actually usable.

## Solution

Two additive layers, both gated behind a per-tenant feature flag:

1. **Sink** — wrap Trail's LLM call-sites so each call also reports to upmetrics via `@broberg/ai-sdk`. The thinnest viable seam is the central subprocess wrapper `services/claude.ts` (`spawnClaude`) plus the OpenRouter path, tagging each call with `agent_name`, `tier`, and `transport` (`subprocess` for Max-Plan $0, `http` for metered API calls).
2. **Display** — a server-side upmetrics cost client (`services/upmetrics-cost.ts`) calls `GET /api/cost/summary` + `/api/cost/timeseries`, and the F151 Cost panel renders the upmetrics totals **next to** the internal `ingest_jobs.cost_cents` (cross-source, not replacement).

`ingest_jobs.cost_cents` stays the source-of-truth for ingest cost and the offline/Max-Plan fallback; upmetrics is the richer cross-call overlay.

## Non-Goals

- **Do NOT remove `ingest_jobs.cost_cents` capture.** It remains source-of-truth + offline fallback. This feature is additive cross-source display.
- **Do NOT replace the F151 SQL aggregator.** upmetrics data is shown alongside it, not instead of it.
- **No credits/billing logic.** That is F156's domain — F189 is observability only, no user-facing credits.
- **No retroactive backfill** of historical Trail LLM calls into upmetrics — the sink starts logging from cutover forward.
- **No change to the chat/ingest model-selection logic** (F149/F159) — F189 only observes calls, never reroutes them.

## Technical Design

### Sink — `@broberg/ai-sdk` wrapper at the LLM seam
Central seam is `apps/server/src/services/claude.ts` (`spawnClaude`) — every subprocess LLM call funnels through it (per the `spawnClaude`-not-`fetch` convention). The OpenRouter HTTP path (`services/ingest/openrouter-backend.ts`) is the second seam.

```ts
// apps/server/src/services/llm-metering.ts (new)
import { reportAgentRun } from '@broberg/ai-sdk';
export function meterCall(args: {
  agentName: string;          // 'ingest' | 'chat' | 'vision' | 'translation' | …
  provider: string;           // 'anthropic' | 'openrouter' | …
  model: string;
  tier: string | null;        // plan/tier tag
  transport: 'subprocess' | 'http';
  inputTokens: number; outputTokens: number;
  costUsd: number;            // 0 for Max-Plan subprocess
}): void; // fire-and-forget, never throws into the LLM path
```

Mirrors the existing fire-and-forget pattern of `recordReinforcement` (F182.4) and the `@upmetrics/sdk` error-telemetry already wired in `app.ts`. `metered:false` ⇔ `transport === 'subprocess' || costUsd === 0` (Trail's Max-Plan skel).

### Display — upmetrics cost read-client
```ts
// apps/server/src/services/upmetrics-cost.ts (new)
export interface UpmetricsCostSummary {
  generatedAt: string;        // upmetrics' as_of
  totalMicroUsd: number;      // integer micro-USD ($1 = 1_000_000)
  inputTokens: number; outputTokens: number;
  byProviderModel: Array<{ provider: string; model: string; tier: string | null; microUsd: number; metered: boolean }>;
}
export async function getUpmetricsCost(window: string, opts): Promise<UpmetricsCostSummary | null>;
```
Auth via per-project `X-Upmetrics-Key` stored as a Fly secret (`UPMETRICS_READ_KEY`), NOT the public DSN. Read-key is read-only and scoped to the `trail` project. Same 60s TTL cache + `candidate_approved` bust as `cost-aggregator.ts`; `null` on fetch failure so the panel degrades to internal-only.

### Units cross-check (display reconciliation)
`upmetrics_micro_usd / 10_000 ≈ trail_cost_cents`, with Trail slightly **lower** due to its per-row `Math.round(usd*100)` sub-cent loss. The panel shows both numbers; a reconciliation tooltip explains the expected small gap rather than treating it as an error.

## Interface

- New env/secret: `UPMETRICS_READ_KEY` (Fly secret, per-engine), `TRAIL_UPMETRICS_COST=1` feature flag.
- New server route: `GET /api/v1/knowledge-bases/:kbId/cost/upmetrics?window=…` → `UpmetricsCostSummary | null` (auth + tenant-scoped, same as existing `/cost`).
- New SDK dependency: `@broberg/ai-sdk` in `apps/server/package.json`.
- No change to the existing `CostSummary` shape — upmetrics data is a sibling payload.

## Rollout

Phased, flag-gated:
1. **Phase A (sink, dark):** wire `meterCall` at the two seams behind `TRAIL_UPMETRICS_COST`. Off by default. Verify rows land in upmetrics via the xrt81 pilot's data path.
2. **Phase B (read-client):** add `upmetrics-cost.ts` + route, verify against live `/api/cost/summary` once upmetrics F014.1 ships and Trail green-lights the JSON shape (freeze-gate obligation below).
3. **Phase C (UI):** render the cross-source overlay in `cost.tsx`. Ship to `broberg-ai/trail` tenant first (dogfood), then flip the flag per-tenant.

## Success Criteria

- A chat turn + a vision call + an ingest job each produce a corresponding `agent_runs` row in upmetrics within one polling window (verified by a `verify-upmetrics-sink.ts` probe, not inferred).
- The Cost panel shows upmetrics total and internal `ingest_jobs.cost_cents` side-by-side, and `upmetrics_micro_usd/10_000` is within the expected sub-cent band of the internal cents for the same window.
- With `TRAIL_UPMETRICS_COST` off, the Cost panel is byte-identical to today (zero regression).
- upmetrics fetch failure degrades to internal-only with no panel error.

## Stories

- **F189.1** — `@broberg/ai-sdk` dependency + `services/llm-metering.ts` `meterCall` helper (fire-and-forget, never throws). Unit-test the `metered` derivation.
- **F189.2** — Wire `meterCall` at the `spawnClaude` + OpenRouter seams with `agent_name`/`tier`/`transport` tags; flag-gated dark. `verify-upmetrics-sink.ts` end-to-end probe.
- **F189.3** — `services/upmetrics-cost.ts` read-client + `GET …/cost/upmetrics` route + 60s cache. (Gated on upmetrics F014.1 freeze-gate.)
- **F189.4** — F151 Cost-panel cross-source overlay UI + reconciliation tooltip; per-tenant flag flip, dogfood on `broberg-ai/trail`.

## Impact Analysis

### Files created (new)
- `apps/server/src/services/llm-metering.ts`
- `apps/server/src/services/upmetrics-cost.ts`
- `apps/server/scripts/verify-upmetrics-sink.ts`

### Files modified
- `apps/server/package.json` — add `@broberg/ai-sdk`.
- `apps/server/src/services/claude.ts` — call `meterCall` after a subprocess call completes.
- `apps/server/src/services/ingest/openrouter-backend.ts` — call `meterCall` after the HTTP call (already computes `totalCostUsd`).
- `apps/server/src/routes/cost.ts` — mount the new `/cost/upmetrics` handler.
- `apps/admin/src/api.ts` — add `getUpmetricsCost()` + `UpmetricsCostSummary` type.
- `apps/admin/src/panels/cost.tsx` — render the cross-source overlay.
- `docs/FEATURES.md`, `docs/ROADMAP.md` — index rows.

### Downstream dependents
- `apps/server/src/services/claude.ts` (`spawnClaude`) is imported by ~9 call-sites: `routes/chat.ts`, `services/{source-inferer,tag-suggester,translation,contradiction-lint,glossary-backfill,vision,ingest}.ts`, `lib/mcp-config.ts`. **All unaffected** — `meterCall` is added *inside* `spawnClaude`, so the wrapper's signature and return value are unchanged; callers see no difference.
- `apps/server/src/services/cost-aggregator.ts` is imported only by `routes/cost.ts` (1 ref) — unaffected; the new route handler is additive.
- `apps/admin/src/panels/cost.tsx` is referenced by `apps/admin/src/main.tsx` (route mount, 1 ref) — unaffected; route unchanged.
- `apps/admin/src/lib/currency.ts` (`formatCostForLocale`) is reused by the overlay — additive consumer, no change to the function.

### Blast radius
- The sink is fire-and-forget; a failing/slow upmetrics report must NEVER block or throw into the LLM path (same guarantee as `recordReinforcement`). This is the single highest-risk seam — an uncaught throw in `spawnClaude` would break every LLM feature.
- The read-client is behind a flag and returns `null` on failure → panel degrades gracefully.
- No schema/migration changes → no DB blast radius.
- No change to existing `/cost` route shape → existing Cost panel unaffected.

### Breaking changes
None — all changes are additive and flag-gated.

### Test plan
- [ ] TypeScript compiles: `pnpm typecheck`
- [ ] Unit: `meterCall` derives `metered:false` for `transport:'subprocess'` and for `costUsd:0`; `true` otherwise.
- [ ] Unit: `getUpmetricsCost` returns `null` (not throw) on non-200 / network error.
- [ ] Integration: `verify-upmetrics-sink.ts` spawns one real metered call and confirms an `agent_runs` row appears (script proof, not inference).
- [ ] Integration: `/cost/upmetrics` returns a summary whose `micro_usd/10_000` is within the sub-cent band of the same-window internal cents.
- [ ] Manual: Cost panel shows both numbers + reconciliation tooltip.
- [ ] Regression: with `TRAIL_UPMETRICS_COST` off, Cost panel byte-identical to today.
- [ ] Regression: an LLM call still succeeds when upmetrics is unreachable (kill the read-key, confirm ingest/chat unaffected).

## Implementation Steps
1. Add `@broberg/ai-sdk` to `apps/server/package.json`; confirm its `reportAgentRun` (or equivalent) signature against the SDK's published types.
2. Write `services/llm-metering.ts` with the fire-and-forget `meterCall` + `metered` derivation + unit tests.
3. Call `meterCall` inside `spawnClaude` (subprocess, `transport:'subprocess'`) and in `openrouter-backend.ts` (`transport:'http'`), behind `TRAIL_UPMETRICS_COST`.
4. Write `verify-upmetrics-sink.ts`; run it to prove rows land (after the SDK sink is live via the xrt81 pilot).
5. Build `services/upmetrics-cost.ts` read-client + `/cost/upmetrics` route + cache, against the F014.1 JSON shape Trail green-lit.
6. Add `getUpmetricsCost()` + type to `api.ts`; render the cross-source overlay + reconciliation tooltip in `cost.tsx`.
7. Set `UPMETRICS_READ_KEY` Fly secret; flip the flag on `broberg-ai/trail` tenant; verify in the live admin.

## Dependencies
- **`@broberg/ai-sdk` cost sink** — the SDK→upmetrics path itself is **verified live** (xrt81 vision pilot, 2026-06-02: an `agent_run` landed with `cost_usd=$0.007407`, tier=vision, `tags.transport=http`). What remains for F189 is wiring *Trail's own* call-sites (F189.2) + minting a Trail cost-read-key.
- **upmetrics F014.1 (`GET /api/cost/summary`)** — ✅ **SHIPPED + frozen 2026-06-02**. Trail green-lit the JSON shape (freeze-gate, intercom #2487→#2488). Frozen contract below; full doc: `github.com/broberg-ai/upmetrics/blob/main/docs/COST-API.md`.
- F151 (Cost & Quality Dashboard) — the panel F189 extends. **Done (in Review).**
- F149 (Pluggable Ingest Backends) — provides the OpenRouter cost seam. Done.

### Frozen upmetrics F014 contract (target for F189.3)
`GET https://upmetrics.org/api/cost/summary?window=day|week|month` (auth `X-Upmetrics-Key`):
```
{ generated_at, window:{from,to}, total_micro_usd, input_tokens, output_tokens,
  cache_read_tokens, cache_creation_tokens, run_count,
  metered:{ metered_micro_usd, free_run_count },
  by_provider[], by_model[], by_tier[], by_capability[] }
```
`GET /api/cost/timeseries?bucket=day|hour` → `{ points:[{ ts, micro_usd, input_tokens, output_tokens, run_count }] }` (non-zero buckets only — Trail pads).

Cross-check (post-F189.2): `total_micro_usd / 10_000 ≈ SUM(ingest_jobs.cost_cents)` for the same window (upmetrics slightly higher — no per-row `Math.round` loss). `metered.free_run_count` ↔ Max-Plan-$0 jobs. The numeric reconciliation can only run once Trail actually sinks to upmetrics (F189.2) — until then upmetrics has 0 Trail `agent_runs`.

## Open Questions
- ~~**SDK call surface**~~ — **RESOLVED 2026-06-02.** `@broberg/ai-sdk@0.1.2` is live on npm (the shared facade for all repos; provider-agnostic, per-call cost, real fallback-failover as of 0.1.2 — the v0.1.1 `CallOptions.fallback` stub is gone). Cost is NOT reported via a manual `reportAgentRun`; instead you configure `createAI({ costSink: upmetricsSink({ baseUrl, apiKey, agentName: 'trail', agentKind }) })` once and every `ai.vision()/...` call auto-reports to upmetrics (tags `{capability, transport, sdk}`). So F189.2's seam is "route Trail's LLM calls through a shared `createAI()` client with `upmetricsSink` configured" rather than a hand-rolled `meterCall` after each call — simpler than the original sketch. API: `github.com/broberg-ai/ai-sdk/blob/main/docs/API.md`; model menu: `docs/runbooks/AI-MODELS.md`. Verified live via the xrt81 vision pilot.
- **Tier tagging:** what `tier` value should Trail send per call (plan name? KB tier? fixed `'trail'`?) — needs a one-line decision with upmetrics so the breakdown is meaningful fleet-wide.
- **Per-project read-key issuance:** how upmetrics mints the scoped `X-Upmetrics-Key` for the `trail` project (manual vs. self-serve) — coordinate when F014.1 lands.

## Related Features
- Depends on / extends **F151** (Cost & Quality Dashboard) and **F149** (Pluggable Ingest Backends).
- Sibling to **F156** (Credits-Based LLM Metering) — F156 is user-facing billing, F189 is internal observability; they may later share the per-call cost stream.
- Counterpart epic **upmetrics F014** (Cost read-API). Trail is the **freeze-gate reviewer** for upmetrics F014.1: upmetrics pings with the proposed `/api/cost/summary` JSON and Trail green-lights it against the `CostSummary` TS type in `apps/server/src/services/cost-aggregator.ts` before they freeze. Trail already sends error-telemetry to upmetrics via `UPMETRICS_DSN` (`packages/shared/src/upmetrics.ts`).
- Intercom thread: #2379 → #2381 → #2415 → #2416 → #2417.

## Effort Estimate
**Medium** — ~3–4 days once unblocked. Phase A (sink) ~1 day, Phase B (read-client) ~1 day, Phase C (UI) ~1–1.5 days. Most calendar time is the external blockers (ai-sdk sink + upmetrics F014.1), not Trail's own work.
