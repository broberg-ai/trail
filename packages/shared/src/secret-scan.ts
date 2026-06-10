/**
 * F197 — secret-scan detector. The implementation now lives in the shared fleet
 * package `@broberg/secret-scan` (owned + published by the `components` repo), so
 * every repo shares ONE canonical detector + pattern list. This file re-exports
 * it verbatim, so all `import { redactSecrets, hasSecret, SECRET_PATTERNS,
 * redactionMarker, … } from '@trail/shared'` call-sites keep working unchanged
 * (the ingest gate in packages/core/src/queue/candidates.ts + the egress scrubs
 * in apps/server chat/search).
 *
 * To add or curate patterns, do it in @broberg/secret-scan (components) — not
 * here. v0.1.0 also adds an opt-in `redactSecrets(text, { extraPatterns })`.
 */
export * from '@broberg/secret-scan';
