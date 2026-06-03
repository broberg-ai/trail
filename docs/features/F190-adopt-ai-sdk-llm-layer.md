# F190 — Adopt @broberg/ai-sdk as Trail's discrete-LLM layer

> Route every **discrete** LLM call in Trail through `@broberg/ai-sdk` (`createAI()` + `ai.chat/vision/translate/…` + `upmetricsSink`), retiring the home-rolled provider plumbing, fallback chains, and cost-parsing. The **agentic ingest loop stays claude-code orchestration** (out of scope, by design). Tier: Phase 2 architecture · Effort: Medium-Large · Status: Planned.

## Problem

Christian's standing policy (ai-sdk broadcast 2026-06-02, severity warn): **all AI/LLM work across his repos MUST go through `@broberg/ai-sdk`** — never a direct provider SDK (Anthropic/OpenAI/Gemini/fal/raw fetch), never home-rolled failover or cost-tracking. Missing capability → extend the SDK + publish, don't bypass.

Trail is the most home-rolled repo for LLM plumbing:

| Site | Today |
|---|---|
| `services/vision.ts` | Anthropic API direct + home-rolled OpenRouter fallback |
| `services/translation.ts`, `tag-suggester.ts`, `source-inferer.ts`, `glossary-backfill.ts` | `spawnClaude` (`claude -p` subprocess) |
| `services/contradiction-lint.ts` | `spawnClaude` (Haiku, discrete pairwise analysis) |
| `routes/chat.ts` | `spawnClaude` / F159 pluggable backend + home-rolled tool-loop (MCP-as-functions) |
| `services/ingest/openrouter-backend.ts` | raw OpenRouter fetch |
| F149 / F159 | home-rolled fallback chains + `cost_cents` parsing |

Two facts make this more than a style cleanup:
1. **Cloud already needs API.** The `claude` CLI doesn't exist on Fly, so on the prod engine these `spawnClaude`-based discrete calls are already broken or must be API. Migrating them to ai-sdk HTTP is **cost-neutral on cloud** (they're metered today where they work) and a **prod-readiness win**.
2. **The boundary is settled** (ai-sdk ruling, intercom #2546→#2548): the SDK is *single-shot by design* — it normalises tool *definitions* and returns `toolCalls`, but does NOT run an agentic loop. Trail's **ingest** = claude-code-as-orchestrator calling our MCP `write` tool many times in a compile loop = an **agent-runtime**, not an LLM-call facade. It legitimately does NOT fall under the policy.

## Secondary Pain Points

- **Prod-readiness**: removes the "claude CLI absent on Fly" footgun for chat + the helper services.
- **Cost-tracking for free**: routing through `createAI({ costSink: upmetricsSink })` makes per-call cost land in upmetrics automatically — **absorbs F189** (the separate sink-wiring becomes inherent; only the read-API *display* remains, folded in as F190.5).
- **One fallback story**: ai-sdk owns provider fallback-chains, retiring Trail's F149/F159 home-rolled failover for the discrete paths.

## Solution

A single shared `createAI()` client (configured once with `upmetricsSink({ agentName: 'trail' })` + the project's tier/provider registry from `AI-MODELS.md`), consumed by every discrete-call site via `ai.vision/chat/translate/…`. On the **cloud engine, transport = HTTP/API** (metered — accepted; SaaS usage is metered/credited). Migrate site-by-site, retire the dead plumbing last, then fold in the F189 cost-display.

## Non-Goals

- **Ingest agentic MCP-loop stays claude-code orchestration.** `services/ingest.ts`'s `spawnClaude` compile-loop is NOT forced through the SDK. (If ingest-cost is wanted in the same telemetry later, ingest emits its own Usage to upmetrics directly — decided when relevant.)
- **The local Max-Plan $0 engine is a SEPARATE future plan-doc** (parked idea `019e87f9`). Christian's interactive-terminal local engine — driven by the fact Anthropic turned headless `claude -p` into an API-billed setup, so true $0 Max-Plan needs an interactive claude-code session — is explicitly out of F190. F190 is cloud = metered API.
- **No change to model *selection* intent** beyond mapping current models onto ai-sdk tiers/overrides.
- **No retirement of F149's ingest backend** — ingest stays, so its backend stays.

## Technical Design

### Shared client
```ts
// apps/server/src/lib/ai.ts (new) — one client, imported everywhere
import { createAI, upmetricsSink } from '@broberg/ai-sdk';
export const ai = createAI({
  costSink: upmetricsSink({
    baseUrl: process.env.UPMETRICS_BASE_URL ?? 'https://upmetrics.org',
    apiKey: process.env.UPMETRICS_API_KEY!,   // Trail project key, Fly secret
    agentName: 'trail',
    agentKind: 'chatbot',
  }),
});
```
Per-site: `ai.vision({image, mimeType, prompt})`, `ai.chat({messages, tools?})`, `ai.translate({...})`. Tier/provider/model per `docs/runbooks/AI-MODELS.md`; `override:{provider,model}` where a site pins a specific model (e.g. lint → cheap/Haiku tier).

### Chat tool-loop (the involved one)
`chat.ts` keeps owning the loop: `ai.chat({messages, tools})` returns `toolCalls`; Trail's existing `invokeTrailMcpTool` router executes them (tenant-scoped), appends results, calls `ai.chat()` again until no tool calls. The SDK provides each discrete turn; Trail provides the orchestration — exactly the boundary ai-sdk drew.

### Version
`@broberg/ai-sdk` latest (≥0.2.0 — facade + tiers + http/subprocess transports + upmetrics sink + `ai.contracts.*`, 131 tests green, xrt81-vision-proven).

## Interface
- New env/secret: `UPMETRICS_API_KEY` (Trail project cost-ingest key, Fly secret — NOT the DSN), `UPMETRICS_BASE_URL`.
- New shared module `apps/server/src/lib/ai.ts`.
- No change to Trail's own HTTP API surface. `ingest_jobs.cost_cents` stays (ingest unchanged); discrete-call cost moves to upmetrics telemetry.

## Rollout
Site-by-site behind nothing risky (each site is independently swappable + verifiable). Order = lowest-risk first (vision, pilot-proven) → helper services → chat (tool-loop) → cleanup → cost-display. Each story ships + verifies on its own.

## Success Criteria
- Every discrete-call site issues its LLM call via `ai.*`; `grep` finds **zero** direct provider calls / `spawnClaude` outside `services/ingest.ts` (+ the claude.ts agentic path it shares).
- A vision + a chat + a translate call each produce an `agent_run` in upmetrics tagged `agentName=trail` (verified by probe, not inferred).
- On cloud, chat + helper services work without the `claude` CLI present (prod-readiness).
- Ingest behaviour byte-unchanged (its `spawnClaude` agentic path untouched).
- No cost regression: discrete calls were already metered-or-broken on cloud; cost is now tracked, not newly incurred.

## Progress (2026-06-02)

- **F190.1 vision** — ✅ shipped + runtime-verified + **deployed live** (engine). Cost-sink active.
- **F190.2 helpers** (translation, tag-suggester, source-inferer, glossary-backfill, contradiction-lint) — ✅ migrated + verified + **deployed live**. Removed the contradiction-lint + glossary direct-fetch branches.
- **F190.3 chat** — ✅ **shipped + prod-verified**. ai-sdk 0.3.1 (F8.7) fixed the anthropic tool-loop serialization (0.3.0 fixed openai). `runChat` → `AiSdkChatBackend` (ai.chat per turn + Trail-owned MCP tool-loop + ai-sdk failover). Prod-verified on broberg.ai/buddy-sessions: coherent answer (backend=claude-api) AND tool-loop (count tool → "114 neuroner"). Deployed.
- **F190.4** — ✅ (core): `UPMETRICS_API_KEY` set on trail-engine-001 + deployed, sink live, real cost confirmed. **Follow-up:** sweep orphaned helper consts; retire the F159 chat backends + their chat-settings config UX (chat-settings.ts still imports `resolveChatChain`/`ChainStep` → a UX change, not just deletion); grep-confirm no `spawnClaude` outside ingest.
- **F190.6 cloud ingest** — ✅ **shipped + LIVE-verified** (2026-06-03). `OpenRouterBackend` migrated to `ai.chat({tools, override:{provider:'openrouter'}, labels:{tenantId,kbId}})`; runner keeps chain-fallback ownership. Vision + contradiction-lint labels folded in. Local probe proved the tool-loop converges (real gemini-2.5-flash, write fired, 2-turn convergence). Deployed to trail-engine-001 (arn); an in-container live run lands cost in upmetrics under `tag.tenantId=t-broberg-ai` → new `by_provider:openrouter` + `by_model:google/gemini-2.5-flash` rows (461 µ$, not 0 — F010 ground-truth holds). Per-tenant BYO key (Phase 2e) preserved via `aiForTenant()`. **Follow-up surfaced:** `action-recommender` still calls `spawnClaude` directly → fails on the cloud engine ("claude not found"); it's another discrete-call site for the F190.4 sweep to migrate to `ai.chat()`.
- **F190.5 cost-display** — scope **resolved** via ai-sdk `labels` (0.4.0, in flight): `labels:{tenantId,kbId}` on every ai.* call → `agent_runs.tags` → F151 filters per-tenant (no cross-tenant leak; no operator-gate needed). Trail convention agreed (#2678): `tenantId=tenants.id` (matches `ingest_jobs.tenant_id`), `kbId=knowledge_bases.id`. When 0.4.0 lands: add labels to all call-sites (vision.ts needs tenant/kb threaded), build read-client (GROUP BY tenantId tag), render per-tenant in panel + operator-only engine totals.

Deps bumped: `@broberg/ai-sdk` ^0.2.0→^0.3.0, `@upmetrics/sdk` ^0.1.4→^0.1.5.

## Stories
- **F190.1** — `lib/ai.ts` shared client + migrate `vision.ts` → `ai.vision()`. (Lowest risk; xrt81 already proved the vision path.)
- **F190.2** — Migrate the single-shot helpers → `ai.chat()`/`ai.translate()`: `translation.ts`, `tag-suggester.ts`, `source-inferer.ts`, `glossary-backfill.ts`, `contradiction-lint.ts` (cheap/Haiku tier).
- **F190.3** — Migrate `chat.ts`: `ai.chat({tools})` per turn, Trail keeps owning the MCP-tool-execution loop (tenant-scoped router). Retires the F159 home-rolled chat backend.
- **F190.4** — Retire dead plumbing for migrated paths (discrete-call `spawnClaude` usage, home-rolled OpenRouter fallback, `cost_cents` parsing for these) + mint Trail `UPMETRICS_API_KEY` + verify telemetry.
- **F190.5** — Cost display: read-client for upmetrics `GET /api/cost/summary` (frozen F014 contract) + render in the F151 Cost panel alongside `ingest_jobs.cost_cents`. **Absorbs F189.3/.4.**
- **F190.6** — Migrate the **cloud ingest backend** (`services/ingest/openrouter-backend.ts`) from its hand-rolled `fetch(OPENROUTER_URL)` function-calling loop → `ai.chat({tools})`, mirroring F190.3's `AiSdkChatBackend`. Trail keeps owning the guide/search/read/write tool-loop (`dispatchTool`); ai-sdk owns the HTTP transport + cost. **Keep OpenRouter** as the chosen provider (`override:{provider:'openrouter', model:<current cheap model>}`) — Christian's decision (cheaper, proven). Adds `labels:{tenantId,kbId}` so ingest cost finally lands in upmetrics (today it only writes `ingest_jobs.cost_cents`). Also folds in the remaining discrete-call labels (**vision** via factory/describeImageAsSource closures + caller wiring; **contradiction-lint** via the cross-package `ContradictionChecker`/`detectContradictions` signature). The **claude-cli ingest backend stays** (Max-Plan localhost agent-runtime) → superseded later by the local-ingest-engine idea (`019e87f9`).

### F190.6 rationale + scope (added 2026-06-03)
**Why it's possible (correcting an earlier imprecision):** cloud ingest is NOT claude-code — `OpenRouterBackend` is a `for(turn…)` function-calling tool-loop over HTTP (`tool_calls` → `dispatchTool(guide|search|read|write)` → loop). That's the identical pattern to chat (F190.3), which ai-sdk handles via `ai.chat({tools})` + caller-owned loop (proven converging on 0.3.1, both provider paths). **No ai-sdk extension needed.** Only the claude-CODE Max-Plan subprocess (full agent runtime, localhost) is genuinely outside ai-sdk's single-shot facade → that's the separate local-engine plan.
**Provider:** keep OpenRouter (cheaper model, works), routed via ai-sdk `override` — with the *option* to selectively override to Anthropic/others per-KB later (the existing F149 `ingest_backend`/`ingest_model`/`ingest_fallback_chain` columns map onto ai-sdk `override`+`fallback`).
**Gains:** policy-compliance (no hand-rolled provider fetch) · ingest cost → upmetrics with per-tenant/KB labels (unified cost telemetry) · selective provider/model choice without lock-in.
**Verify:** a real cloud ingest produces identical Neuron output before/after (tool-loop parity) + an `agent_run` lands in upmetrics tagged `agentName=trail, capability` with `tenantId/kbId` labels. Reconcile `total_micro_usd/10_000 ≈ ingest_jobs.cost_cents` for the same job.

### F190.6 — shipped (2026-06-03)
- **Ingest backend migrated.** `OpenRouterBackend.run()` now drives the tool-loop via the shared `ai.chat({tools, override:{provider:'openrouter', model}, labels:{tenantId,kbId}})` instead of `fetch(OPENROUTER_URL)`. `dispatchTool` + formatters unchanged. **No ai-sdk `fallback` here** — the runner (`runWithFallback`) already owns chain-level fallback + the "0 writes ⇒ advance" accounting; the backend throws on error exactly as before and the runner advances. `temperature:0.3`, `maxTokens:4096`, `purpose:'ingest'` preserved. Timeout is now a between-turns soft check (the high-level `ai.chat` exposes no abort signal — same as the live `AiSdkChatBackend`).
- **Tool defs** converted from OpenAI-compatible `{type:'function',function:{…}}` to flat ai-sdk `Tool[]` (`{name,description,parameters}`); the adapter converts per provider.
- **Per-tenant key (F149 Phase 2e) preserved, not dropped.** The SDK has no per-call `apiKey` override, so `lib/ai.ts` gained `aiForTenant({openrouter,anthropic})`: returns the shared `ai` when no tenant key, else mints a client that pins the BYO key onto the adapter (`createAI({providers:{...defaultProviders, openrouter: openrouterAdapter({apiKey})}})`). **No `process.env` mutation** → concurrent ingests with different tenant keys can't race. Both live tenants (broberg-ai, sanne-andersen) have **no** `tenant_secrets` key today → both use the engine-level Fly secret via the shared `ai`; the BYO path is dormant but intact. **Follow-up flagged to ai-sdk:** a first-class per-call `apiKey` on `override`/`CallOptions` would retire `aiForTenant`.
- **Vision labels.** `runVision`/`describeImageAsSource`/`createVisionBackend`/`createVisionBackendWithMetadata` gained an optional `labels?`. Wired live callers: `uploads.ts` (image-as-source) passes `{tenantId,kbId}` (single doc); `vision-rerun.ts` (PDF embedded images) passes `{tenantId}` only — a batch can span KBs (doc-scope), so only the tenant billing-key is constant. `documents.ts`'s `createVisionBackend` import is unused (dead) — left untouched per surgical-change rule.
- **Contradiction-lint labels.** Cross-package signature change: `ContradictionChecker` + `detectContradictions` gained an optional `labels?` (call-time, since one checker is reused across all docs). `runForEvent` supplies `{tenantId: doc.tenantId, kbId: doc.knowledgeBaseId}`.
- **Runtime proof.** `apps/server/scripts/verify-f190-6-ingest.ts` ran the migrated `OpenRouterBackend.run()` against a real `google/gemini-2.5-flash` OpenRouter call with a stub `CandidateQueueAPI`: routed via OpenRouter, model called `write(create)` with a real summary, **loop converged in 2 turns** (the F190.3 infinite-re-ask bug does not reappear on the ingest path), cost reported. Typecheck clean on `@trail/core` + `@trail/server`.

## Impact Analysis

### Files created (new)
- `apps/server/src/lib/ai.ts` (shared `createAI()` client)
- `apps/server/src/services/upmetrics-cost.ts` (read-client, ex-F189.3)
- `apps/server/scripts/verify-ai-sdk-telemetry.ts`

### Files modified
- `services/vision.ts`, `services/translation.ts`, `services/tag-suggester.ts`, `services/source-inferer.ts`, `services/glossary-backfill.ts`, `services/contradiction-lint.ts`, `routes/chat.ts` — swap LLM call to `ai.*`.
- `services/claude.ts` — `spawnClaude` stays ONLY for the ingest agentic path; discrete callers drop their dependency on it.
- `routes/cost.ts`, `apps/admin/src/panels/cost.tsx`, `apps/admin/src/api.ts` — cost-display (F190.5).
- `apps/server/package.json` — add `@broberg/ai-sdk`.
- `docs/FEATURES.md`, `docs/ROADMAP.md`.

### Downstream dependents
- `services/claude.ts` (`spawnClaude`) — after F190.2/.3 its only remaining caller is `services/ingest.ts` (the agentic path). Verify with grep before any further change; do NOT remove it (ingest needs it).
- `routes/cost.ts` imported only by `app.ts` (mount) — F190.5 additive.
- F149/F159 chain constants in `packages/shared/src/ingest-chains.ts` — ingest chain stays; chat chain (F159) is retired by F190.3. Check no other importer breaks.

### Blast radius
- **Chat tool-loop** is the highest-risk migration — getting the tool-call → execute → re-call loop right (tenant-scope must stay enforced in `invokeTrailMcpTool`). Regress-test chat with a multi-tool query.
- The shared `ai` client must fail gracefully if `UPMETRICS_API_KEY` is unset (cost-sink should no-op, never block the LLM call).
- Ingest must be provably untouched (grep + a real ingest run before/after).

### Breaking changes
None to Trail's external API. Internal: discrete-call cost leaves `ingest_jobs.cost_cents` (which was ingest-only anyway) and moves to upmetrics telemetry.

### Test plan
- [ ] `pnpm typecheck` (server + admin)
- [ ] Unit: shared `ai` client no-ops the sink when `UPMETRICS_API_KEY` unset (LLM call still returns).
- [ ] Integration: `verify-ai-sdk-telemetry.ts` runs a real vision + chat + translate call → asserts `agent_run` rows in upmetrics tagged `agentName=trail`.
- [ ] Integration: chat multi-tool query returns a cited answer; tenant-scope enforced (no cross-tenant tool result).
- [ ] Manual: F151 Cost panel shows upmetrics totals next to internal cents (F190.5).
- [ ] Regression: a full ingest run produces identical Neuron output before/after (ingest untouched).
- [ ] Regression: `grep` finds no direct provider/`spawnClaude` calls outside ingest.

## Implementation Steps
1. Add `@broberg/ai-sdk`; write `lib/ai.ts`; migrate `vision.ts`; verify telemetry (F190.1).
2. Migrate the five single-shot helpers; pin tiers per AI-MODELS.md (F190.2).
3. Migrate `chat.ts` with Trail-owned tool-loop; retire F159 chat backend (F190.3).
4. Mint Trail `UPMETRICS_API_KEY` (project cost key, like xrt81's), set Fly secret; retire dead plumbing; grep-verify (F190.4).
5. Build `upmetrics-cost.ts` read-client + F151 panel display against the frozen F014 contract (F190.5).

## Dependencies
- `@broberg/ai-sdk` ≥0.2.0 (live on npm). API: `docs/API.md`; models: `docs/runbooks/AI-MODELS.md`.
- upmetrics F014 cost read-API — ✅ shipped + frozen (see F189). Trail needs its own project cost-ingest key minted.
- F149/F159 (current plumbing being partially retired). F151 (Cost panel F190.5 extends).

## Open Questions
- **`claude -p` billing**: Christian reports Anthropic turned headless `claude -p` into an API-billed setup, which would mean ai-sdk's `transport:"subprocess"` is NOT $0. **Irrelevant to F190** (cloud = HTTP/API regardless), but it gates the parked local-Max-Plan engine idea (`019e87f9`) — verify there before relying on subprocess=$0.
- **Tier mapping**: exact ai-sdk tier per site (which model for translate vs lint vs chat) — pin against `AI-MODELS.md` during F190.2/.3.

## Related Features
- **Supersedes F189** (Upmetrics Cost Integration) — the sink half folds in inherently; the read-API display becomes F190.5.
- Retires the discrete-call halves of **F149** (ingest backend stays) and **F159** (chat backend retired).
- Extends **F151** (Cost panel). Counterpart to upmetrics **F014**.
- Followed by the parked **local Max-Plan ingest engine** (idea `019e87f9`) — separate plan-doc, designed after F190.

## Effort Estimate
**Medium-Large** — ~4–6 days. F190.1 ~0.5d (pilot-proven), F190.2 ~1d, F190.3 ~1.5–2d (tool-loop is the risk), F190.4 ~0.5d, F190.5 ~1d.
