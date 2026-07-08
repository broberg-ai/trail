# F202 — Model-Lab v2: reusable ingest-model eval on the real Neuron-production pipeline

## Motivation

We keep needing to answer one question: **"which LLM produces the best Trail
Neurons for a given source, at what cost and latency?"** It came up for the
ingest cloud-fallback choice (F199.10: mistral-small vs mistral-large vs
deepseek-v4-pro) and again on 2026-07-08 (Christian: DeepSeek V4 Flash vs
Mistral Small on Sanne's Zoneterapibogen).

Today each such comparison is a **hand-written one-off** `verify-*.ts` script.
That is slow to author, easy to get subtly non-comparable, and the scripts rot.

We already have `apps/model-lab/` — but it tests the **wrong thing**:

- It drives a **simulated filesystem KB** (`tools.ts` `createSimulatedKB`,
  writing to `data/kbs/<run>/`), **not** the real Trail Candidate-Queue /
  Neuron-production pipeline. So its structure/frontmatter scores don't
  reflect what a real ingest would actually write.
- It uses its **own** compile prompt (`prompt.ts` `buildIngestPrompt`), not the
  production `buildCompilePrompt` (tag/entity/schema/language-aware).
- It calls a **hand-rolled OpenRouter `fetch` loop** (`openrouter.ts`) — so it
  can only test OpenRouter models, and it **bypasses `@broberg/ai-sdk`** (a
  house-rule violation: all LLM calls route through the SDK for cost-tracking +
  provider-swap).

Christian's directive: the reference frame must be **real Trail Neuron
production**, it must be **easy to re-run** on different sources with **all or
selected models**, and it **stays in this monorepo** (not a shared npm).

## Scope (in)

1. **Real-pipeline runner.** Drive the production ingest path per model:
   `buildCompilePrompt` + `createCandidateQueueAPI` against a throwaway
   `TrailDatabase` (temp libSQL, migrations + FTS), the exact 4-tool loop
   (`guide`/`search`/`read`/`write`) that `OpenRouterBackend`/`MistralBackend`
   drive. The Neurons produced are what production would produce.
2. **All model calls via `@broberg/ai-sdk`** — `ai.chat({override:{provider,
   model, transport:'http'}})`. Any provider works (Mistral EU, OpenRouter,
   Anthropic), cost comes from the SDK. Retires the hand-rolled `openrouter.ts`
   fetch (reuse-first + single chokepoint).
3. **Config-driven, turnkey re-run.** A CLI: `--source <file|source-id>`,
   `--models all|<comma-list>`, `--facts <ledger.json>` (optional),
   `--max-turns`. `all` enumerates a model registry.
4. **Model registry.** Reuse `packages/shared/src/ingest-models.ts`
   (`INGEST_MODELS`, already carries provider + GDPR tag) as the source of
   truth for `all`, plus a small lab-only set (e.g. `deepseek-v4-flash`,
   gemini variants) tagged comparison-only. Each result row keeps its
   **EU/non-EU tag** so a China-model win is never mistaken for a
   production-safe default.
5. **Fact-recall scorer.** The hard metric from F199.10: a per-source **fact
   ledger** (JSON list of needle strings) → grep-based recall count of source
   facts that survived into the compiled Neurons. Reported alongside
   neuron-count / cost / duration / turns.
6. **Persist + surface.** Write results to the existing `model-lab.db` and a
   comparison table/report; surface in the existing compare UI panel.
7. **Source library.** A small set of turnkey corpora under
   `apps/model-lab/data/test-sources/` (+ optional fact-ledgers) so a re-run is
   one command.

## Non-goals

- **Not** a shared `@broberg/*` npm — stays in-monorepo per Christian.
- **Not** changing production ingest routing/defaults — this is a lab; it never
  flips a default or routes real customer data.
- **Not** an LLM-judge subjective scorer in v1. v1 = hard metrics only (recall,
  cost, duration, neuron count, frontmatter/structure). LLM-judge is a later
  story if wanted.
- **Not** GDPR-gating the lab itself (it runs on test corpora) — but every
  result is tagged EU/non-EU so the curator reads the tradeoff.

## Architecture sketch

- `apps/model-lab/src/server/trail-runner.ts` — `runIngestComparison({source,
  models, facts, maxTurns})`; lifts the ad-hoc
  `verify-deepseek-flash-vs-mistral-small.ts` into a reusable function.
- `apps/model-lab/src/server/models.ts` — `resolveModels('all'|list)` →
  `{provider, model, gdpr}[]` from `INGEST_MODELS` + lab-only additions.
- `apps/model-lab/src/server/recall.ts` — fact-ledger grep scorer.
- CLI entry: `apps/model-lab/src/server/compare-cli.ts`.
- **Reuse** `db.ts` (persist) + the compare UI. **Retire** `openrouter.ts`,
  `tools.ts` (simulated KB), `prompt.ts` (old prompt) once the real-pipeline
  runner is default — replace, prove, then remove (no naked cutover).
- **Single-source note:** `buildCompilePrompt` currently lives in
  `apps/server/src/services/ingest.ts`. For model-lab to consume ONE copy
  (not a cross-app import), lift `buildCompilePrompt` (+ its helpers) into
  `@trail/core` so both `apps/server` and `apps/model-lab` import the same
  builder. This is the cleanest single-source move; if too invasive for the
  first slice, the runner may temporarily import from apps/server and the
  lift is tracked as its own task.

## Dependencies

- `@trail/db` (throwaway TrailDatabase), `@trail/core` (`createCandidateQueueAPI`,
  target home for `buildCompilePrompt`), `@broberg/ai-sdk` (all model calls),
  `packages/shared` `INGEST_MODELS`.

## Rollout (stories)

- **F202.1** — Real-pipeline comparison runner + CLI (`--source --models
  --facts`), via ai-sdk, persisting to `model-lab.db`. Proven by reproducing
  the DeepSeek-Flash-vs-Mistral-Small result THROUGH the generalized tool.
- **F202.2** — Fact-ledger + source library + compare-UI surfacing
  (recall/cost/duration columns; `all`-registry enumeration).
- **F202.3** — Retire the simulated-KB path (`openrouter.ts`/`tools.ts`/
  `prompt.ts`) once real-pipeline is default; RED test guards the runner
  (replace → prove → remove).

## Verification

The runner is proven when `compare-cli --source zoneterapibogen --models
mistral-small-latest,deepseek/deepseek-v4-flash --facts zoneterapi.json`
reproduces the same recall/cost/duration table the ad-hoc script produced —
i.e. the generalized tool == the one-off, so future comparisons need no new
script. A RED test seeds a tiny source + 2-needle ledger and asserts recall is
computed and persisted.
