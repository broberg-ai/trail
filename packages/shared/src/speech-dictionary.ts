/**
 * F201.14 — speech-dictionary seam. The canonical STT correction list + term
 * biasing lives in the shared fleet package `@broberg/speech-dictionary` (owned +
 * published by the `components` repo), so every repo — and the Swift ambient app,
 * which reads the SAME `data/*.json` — shares ONE dictionary. This file re-exports
 * it verbatim, so `import { applyCorrections, terms, toInitialPrompt } from
 * '@trail/shared'` call-sites resolve to the shared source.
 *
 * `applyCorrections(text)` restores dev/domain terms Apple's STT misheard
 * ("kartmem" → "cardmem", "kommit" → "commit") — deterministic, no LLM. The app
 * (Swift) applies it live on each dictation partial; the engine keeps it available
 * for the ambient-speech source path (F201.13). Exact-pinned to 0.1.1.
 *
 * To add or curate corrections/terms, do it in @broberg/speech-dictionary
 * (components) — never here — then bump the pin. The Swift port regenerates its
 * data from the same package via scripts/gen-dictionary.sh.
 */
export * from '@broberg/speech-dictionary';
