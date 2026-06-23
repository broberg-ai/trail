# F199 — AI-provider exit (de-Anthropic)

> Migrate ALL Trail engine AI usage off the paid Anthropic API (haiku-4.5 + sonnet-4.6) to Mistral (EU) / non-Anthropic. One phase per usage. Tier: high. Effort: Medium. Status: Planned (Phase 1 = Chat, starts first).

## Problem
Every discrete AI call in the Trail cloud engine bills the **paid Anthropic API** — `claude-haiku-4.5` ($1/$5 per Mtok) for 8 features and `claude-sonnet-4.6` ($3/$15) for cloud-ingest. Even the *fallback* on every feature is an Anthropic model (`anthropic/claude-haiku-4.5` via OpenRouter), so Trail is doubly bound to Anthropic. This is API cost that was never meant to accrue (the Max plan was the intent), and it ties Trail's data path to a US provider — a GDPR concern given Trail stores customer knowledge (often personal data).

## Secondary Pain Points
- **GDPR/EU-residency:** chat, vision and translation process customer data through a US provider today.
- **Cost:** haiku-4.5 is ~10× more expensive than the EU alternative for identical-quality discrete tasks.
- **Single-vendor lock-in:** a model suspension (cf. Fable 5, 2026-06-12) or price change has no non-Anthropic escape hatch today.

## Solution
Standardize the engine's discrete AI on **Mistral (EU)** — `mistral-small-latest` ($0.10/$0.30) for text-quality tasks and `mistral-small-3.2` ($0.075/$0.20, vision-capable) for trivial/vision tasks. Both are cheaper than haiku-4.5 AND EU-hosted. Migrate one usage per phase, flipping **both primary and fallback** so nothing silently falls back to Anthropic. Cloud-ingest routes to the existing **$0 local-ingest (Max)** path with `gemini-2.5-flash` as the only unattended cloud fallback.

## Non-Goals
- NOT replacing `@broberg/ai-sdk` — it is provider-agnostic; we only change which provider/model it routes to.
- NOT changing search (FTS5 keyword, no embeddings, already $0).
- NOT building a new in-house model or self-hosting.
- NOT touching the admin SPA's claude -p translate path (separate, F-future).
- NOT a pricing-tracking feature — prices come from `@broberg/ai-sdk/pricing`.

## Technical Design

Each engine AI feature already exposes its model via an env var + a hardcoded default + an `override`/`fallback` pair passed to `ai.chat()`/`ai.vision()`. The migration per feature is: change the default constant + the `override` provider/model + the `fallback` entry (which is currently `anthropic/claude-haiku-4.5` everywhere).

### Routing decision (cross-cutting — resolve in Phase 1)
Two ways to reach Mistral:
- **Mistral-direct adapter** (`provider:'mistral'`, api.mistral.ai) → true EU residency. Requires `@broberg/ai-sdk` to expose a mistral adapter + `MISTRAL_API_KEY` Fly secret.
- **Via OpenRouter** (`provider:'openrouter', model:'mistralai/mistral-small-...'`) → easy/cheap but the request transits OpenRouter (US), weakening the GDPR claim.
Confirm with ai-sdk whether a direct-mistral adapter exists; prefer it for chat/vision/translation.

### Per-feature target (prices: ai-sdk pricing API, snapshot 2026-06-04)
| Feature | File | Target model | $ in/out |
|---|---|---|---|
| Chat/RAG | services/chat/ai-sdk-backend.ts + chain.ts | mistral-small-latest | 0.10/0.30 |
| Vision | services/vision.ts | mistral-small-3.2 | 0.075/0.20 |
| Translation | services/translation.ts | mistral-small-latest | 0.10/0.30 |
| Tag-suggester | services/tag-suggester.ts | mistral-small-3.2 | 0.075/0.20 |
| Auto-link | services/source-inferer.ts | mistral-small-3.2 | 0.075/0.20 |
| Glossary | services/glossary-backfill.ts | mistral-small-latest | 0.10/0.30 |
| Contradiction-lint | services/contradiction-lint.ts | mistral-small-latest (gemini-2.5-flash if quality dips) | 0.10/0.30 |
| Action-recommender | services/action-recommender.ts | mistral-small-latest | 0.10/0.30 |
| Cloud-ingest | services/ingest/chain.ts + openrouter-backend.ts | $0 local-ingest + gemini-2.5-flash fallback | 0 / 0.30/2.50 |

## Interface
Internal only — no public API change. The `ai.*` facade signatures are unchanged; only env-var defaults + override/fallback values change. New optional Fly secret `MISTRAL_API_KEY` (+ possibly `mistralAdapter` in lib/ai.ts) if direct-routing is chosen.

## Rollout
Phased, one feature per story, lowest-risk first — EXCEPT Christian's directive to start with Chat (#1, highest value/visibility) and test it live before continuing. Each phase: flip primary+fallback → verify on the new model → deploy via Mac/CI (the edge cannot deploy) → confirm live. Reversible per-feature via env var.

## Success Criteria
- Zero `provider:'anthropic'` and zero `anthropic/claude-*` model strings remain in any engine AI primary OR fallback (grep-clean).
- Each migrated feature passes its verification on the new model (chat coherent, glossary clean JSON, contradiction-lint calibration 5/5, vision describes a known figure).
- Per-call cost for the 8 discrete features drops ~10× (haiku $1/$5 → mistral $0.10/$0.30), confirmed via upmetrics cost telemetry.
- Chat/vision/translation run on an EU-resident path (if direct-mistral routing is adopted).

## Stories
- **F199.1** — Chat/RAG → mistral-small-latest (PHASE 1, start here; also resolves the routing decision)
- **F199.2** — Vision → mistral-small-3.2
- **F199.3** — Translation → mistral-small-latest
- **F199.4** — Tag-suggester → mistral-small-3.2
- **F199.5** — Auto-link → mistral-small-3.2
- **F199.6** — Glossary → mistral-small-latest
- **F199.7** — Contradiction-lint → mistral-small-latest (re-run calibration)
- **F199.8** — Action-recommender → mistral-small-latest
- **F199.9** — Cloud-ingest → $0 local-ingest + gemini-2.5-flash unattended fallback

## Impact Analysis

### Files created (new)
- Possibly `apps/server/src/lib/ai.ts` gains a `mistralAdapter` wiring (if direct-mistral routing chosen) — modification, not new file.
- No new source files expected; verification reuses existing `scripts/verify-*.ts`.

### Files modified
- `apps/server/src/services/chat/ai-sdk-backend.ts`, `apps/server/src/services/chat/chain.ts`
- `apps/server/src/services/vision.ts`
- `apps/server/src/services/translation.ts`
- `apps/server/src/services/tag-suggester.ts`
- `apps/server/src/services/source-inferer.ts`
- `apps/server/src/services/glossary-backfill.ts`
- `apps/server/src/services/contradiction-lint.ts`
- `apps/server/src/services/action-recommender.ts`
- `apps/server/src/services/ingest/chain.ts`, `apps/server/src/services/ingest/openrouter-backend.ts`
- `apps/server/src/lib/ai.ts` (if mistral adapter added)
- `apps/server/fly.toml` (model env vars + MISTRAL_API_KEY secret reference)

### Downstream dependents
Each `services/*.ts` file above is a **leaf consumer** of the shared `ai` client from `lib/ai.ts` — they are imported by their respective route/subscriber wiring but expose no model-specific types downstream. Changing a model constant/override inside a service has **no downstream type or interface impact**. `lib/ai.ts` is imported by all ~10 service files; the only change there (optional mistral adapter) is additive to `aiForTenant`/`createAI` config and does not alter exported signatures, so all importers are unaffected. (Grep to confirm per-file before each phase's PR.)

### Blast radius
Low and per-feature isolated. Risks: (1) a new model may follow instructions differently (mitigated by per-feature verification — esp. chat quality, glossary JSON, contradiction-lint calibration); (2) forgetting to flip the *fallback* leaves an Anthropic escape path (explicit AC on every story); (3) OpenRouter-vs-direct routing affects the GDPR claim (Open Question). No data-format, no API-route, no shared-component changes.

### Breaking changes
None — all changes are config/model swaps behind the unchanged `ai.*` facade.

### Test plan
- [ ] TypeScript compiles: `pnpm --filter @trail/server typecheck`
- [ ] Unit/script: `verify-contradiction-lint-calibration.ts` passes 5/5 on the new model (F199.7)
- [ ] Unit/script: glossary returns clean JSON without lenient-parser rescue on the new model (F199.6)
- [ ] Integration: live `/chat` call returns a coherent grounded RAG answer on mistral (F199.1)
- [ ] Integration: vision describes a known figure on mistral-small-3.2 (F199.2)
- [ ] Integration: a real cloud-ingest compile succeeds on the gemini fallback (F199.9)
- [ ] Manual: grep the engine for `anthropic`/`claude-` in AI overrides+fallbacks → zero remain
- [ ] Regression: cost telemetry still lands in upmetrics (per-call costUsd) after the swap
- [ ] Regression: existing chat/ingest flows still return answers (no empty/500)

## Implementation Steps
1. **Resolve routing (blocking, Phase 1):** confirm with ai-sdk whether a direct-mistral adapter exists; decide Mistral-direct (EU) vs OpenRouter (US-transit). Provision `MISTRAL_API_KEY` if direct.
2. **F199.1 Chat:** flip primary+fallback in ai-sdk-backend.ts + DEFAULT_CHAT_MODEL; live RAG eval; deploy via Mac/CI; verify. (Christian tests this phase before continuing.)
3. **F199.4/.5/.8 (trivial):** flip to mistral-small-3.2/latest; deploy; smoke-verify.
4. **F199.2 Vision, F199.3 Translation, F199.6 Glossary:** flip; verify (figure / Danish / JSON); deploy.
5. **F199.7 Contradiction-lint:** flip; re-run calibration 5/5; deploy.
6. **F199.9 Ingest:** route to $0 local-ingest + gemini-2.5-flash unattended fallback; verify a real compile; deploy.
7. **Final sweep:** grep engine for any remaining `anthropic`/`claude-` in AI paths; confirm zero; close epic.

## Dependencies
- `@broberg/ai-sdk` ≥ 0.19.0 (pricing API + provider routing) — already bumped.
- ai-sdk confirmation on the mistral-direct adapter (Open Question 1).
- Deploy path via Mac/CI (edge sessions cannot run `pnpm ship:*`).

## Open Questions
1. **Mistral-direct adapter vs OpenRouter?** Direct = true EU residency but needs an ai-sdk mistral adapter + `MISTRAL_API_KEY`. OpenRouter = easy but US-transit (weaker GDPR). Resolve in Phase 1 with ai-sdk. **Blocking for the GDPR claim.**
2. Does `mistral-small-3.2` vision quality hold for figure/diagram description vs haiku-4.5? Validate in F199.2; fall back to `gemini-2.5-flash-lite` if it dips.
3. Is `mistral-small-latest` strong enough for the contradiction-lint reasoning, or is `gemini-2.5-flash` needed? Decided by F199.7 calibration.

## Related Features
- Depends on / extends **F190** (adopt @broberg/ai-sdk — the facade this rides on).
- Relates to **F191** (local-ingest $0 path — the primary for F199.9).
- Relates to **F018** (model-selection KB) and **F156** (credits metering — savings show here).

## Effort Estimate
**Medium** — ~2-4 days. Each phase is a small env/const change + verify + deploy; the cost is in the per-feature verification (esp. Chat quality, contradiction-lint calibration, vision) and the one-time routing/adapter decision in Phase 1.
