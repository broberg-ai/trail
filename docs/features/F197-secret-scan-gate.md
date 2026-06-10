# F197 — Secret-scan gate: redact leaked tokens before any Neuron is committed

**Status:** shipping (core gate + verify this turn; self-service UI = F197.2)
**Date:** 2026-06-10
**Area:** packages/shared (scanner) + packages/core/src/queue/candidates.ts (gate wiring) + verify script
**Seeded by:** inbox idea → Plan & Build (idea_id 019eac54-03b7-7702-93b6-a84fcd6aac22)

## Motivation

Trail is increasingly the **second brain for cc sessions** — every session dogfoods
its decisions into the KB (the F39 dogfooding rule). Those sessions handle real
secrets (Anthropic/OpenAI/Google keys, Fly/Cloudflare tokens, our own
`uk_`/`pa_`/`trail_` fleet keys). A session that pastes a key into a Neuron would
**commit a live secret into the wiki** — which then syncs/replicates and is
effectively leaked. Christian (verbatim): *"du skal lave en safeguard der
obfuskerer alle tokens og API nøgler … Anthropic, Open AI, Google, Gemini,
CloudFlare, Fly.io etc."* This must land **before** Trail is used more intensely
as a second brain. The pattern generalises to every cardmem second-brain.

## Behaviour (decided)

**Redact, don't reject.** A write that contains a secret is not blocked — the
secret substring is replaced with `[REDACTED:<label>]` and the (now-safe) content
is committed. This keeps the surrounding knowledge intact while neutralising the
credential. Redactions are **logged** (never silent).

## Scope (in)

1. **Single-source pattern library** `packages/shared/src/secret-scan.ts` —
   named, low-false-positive regexes for the providers Christian named + the
   common high-risk ones + our own fleet keys:
   - Anthropic `sk-ant-…`, OpenAI `sk-…`/`sk-proj-…`, Google/Gemini `AIza…`,
     Google OAuth `GOCSPX-…`, AWS `AKIA…`, GitHub `ghp_/gho_/ghs_/ghr_…`,
     GitLab `glpat-…`, Slack `xox[baprs]-…`, Stripe `sk_live_/rk_live_…`,
     Fly.io `FlyV1 fm2_…`/`fo1_…`, Cloudflare global key (37-hex),
     PEM private-key blocks, JWTs.
   - Fleet: upmetrics `uk_…`, cardmem `pa_/pi_/pk_…`, Trail `trail_…`.
2. **`redactSecrets(text) → { redacted, findings[] }`** — pure, deterministic,
   order-sensitive (specific patterns first). Reusable by the engine, the future
   admin preview UI, and any other repo.
3. **Gate wiring** in `candidates.ts` at **every persist boundary** so no secret
   enters a Neuron via any ingestion path (MCP, buddy, API, chat, ingest-compile,
   curator edit):
   - `enqueueCandidate` — the main candidate write (title + content).
   - `submitCuratorEdit` — curator-initiated edit.
   - approve→materialize `content` (catches approve-time `editedContent`).
   Each redaction is `console.warn`-logged with the labels + counts.
4. **Egress guardrail (defense in depth, Christian's addition).** If a secret
   ever slips into a Neuron anyway (a predating leak, a test, a pattern gap), it
   must not surface on the way OUT — *"den IKKE kommer med ud i en chat eller
   søgning."* Same `redactSecrets`, applied at the read boundaries:
   - **Chat context** (`build-prompt.ts`) — scrub retrieved Neuron content
     before it enters the prompt, so the model never sees (and can never echo /
     stream) the secret.
   - **Chat answer** (`postprocess.ts` `stripForAudience`) — scrub the final
     answer for EVERY audience (curator included) as a backstop.
   - **Search results** (`search.ts`) — scrub `title`/`highlight`/`userNote` +
     chunk `content` on every return path.
5. **Verify script** `apps/server/scripts/verify-f197-secret-gate.ts` — pushes
   real-shaped sample keys through `createCandidate` (real DB round-trip) and
   asserts the stored candidate is redacted; sweeps `redactSecrets` over all
   providers + benign text (no false positives); asserts `stripForAudience`
   scrubs the answer. **PASS 2026-06-10.**

## Scope (non-goals / follow-ups)

- **F197.2 — self-service "add a key type" UI.** Christian's *"find et nemt sted
  jeg kan indtaste en nøgle"* — a Settings surface where he pastes a sample key,
  we derive a safe detector, stored per-tenant (`settings_json`, the F195 map
  pattern). v1 ships the curated library; adding a provider is one entry (or one
  ask to me) until the UI lands.
- **F197.4 — retro-scan existing Neurons** (one-off backfill) + extend the
  egress guardrail to the Neuron reader (`documents.ts`) + `retrieve.ts`. v1 is a
  forward gate + chat/search egress; already-stored content + those two read
  surfaces are a follow-up.
- **No entropy/generic-高-randomness detection** — pattern-based only, to keep
  false positives near zero (a redacted real fact corrupts knowledge).
- **No block/reject** — obfuscate only.

## Architecture sketch

```
write (MCP | buddy | API | chat | ingest | curator)
        │
        ▼
 candidates.ts persist boundary ── redactSecrets(title)+redactSecrets(content)
        │                              │
        │                              ├─ matches → "[REDACTED:label]" + console.warn
        ▼                              ▼
 queueCandidates / documents      findings logged (F197.2 will surface in Queue UI)
   (always secret-free)
```

`redactSecrets` lives in `@trail/shared` (pure regex, no deps) → imported by
`@trail/core`'s `candidates.ts`. Single source of truth for patterns.

## Acceptance criteria

- Single-source pattern library covers the named providers + common + fleet keys.
- `redactSecrets` replaces every match with `[REDACTED:<label>]`, returns findings,
  leaves benign text byte-identical.
- Gate runs at all `candidates.ts` persist boundaries (enqueue, curator-edit,
  create- + update-materialize); redactions logged.
- Egress guardrail scrubs chat context + chat answer (all audiences) + search
  results, so a secret already in a Neuron never reaches a user.
- Verify script proves end-to-end: sample keys → stored candidate is redacted;
  benign content unchanged.
- Adding a provider = one entry in `secret-scan.ts` (UI = F197.2).

## Rollout

Pure additive code + a write-path interception that only ever *removes* secret
substrings — no schema change, no migration. Ships on the next `pnpm ship:engine`.
