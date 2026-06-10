# F197 → @broberg/secret-scan — handoff brief for components

**For:** the `components` session, extracting Trail's secret-scan into the shared
npm `@broberg/secret-scan`.
**Canonical source:** `broberg-ai/trail` `main` (public) — local checkout
`/Users/cb/Apps/broberg/trail` is the same, current as of commit `b3f07e8`
(2026-06-10). Lift directly from there; nothing newer is unpushed.
**End-state (Christian):** when v1 publishes, the npm comes home — `@trail/shared`
re-exports it and Trail consumes it. I (trail) own the trail-side migration.

---

## 1. WHAT — the problem + what it does + why

**Problem.** Trail is the shared second-brain for every cc session (the F39
dogfooding rule: sessions write their decisions into the KB). Those sessions
handle real credentials. A session that pastes a key into a Neuron **commits a
live secret into the wiki**, which then syncs/replicates → effectively leaked.
This is not hypothetical: the retro-scan (below) found **9 real leaked keys**
already sitting in the `buddy-sessions` KB (6 upmetrics `uk_`, 3 cardmem Bearer).

**What it does, end-to-end** — two layers, defense in depth:
- **Ingest gate:** every candidate-write boundary runs `redactSecrets` on
  title + content → secrets never enter a Neuron.
- **Egress guardrail:** chat retrieved-context (model never sees the secret),
  chat answer (all audiences), and search results are scrubbed → a secret that
  *predates* the gate (or slips a pattern) can't reach a user.
- **Retro-scan:** a tool sweeps an existing KB + (with `--apply`) redacts leaks
  at rest via the curator-edit endpoint.

**Design decisions (the why):**
- **Pure / dependency-free / deterministic.** `secret-scan.ts` is regex+string
  only, no deps, no I/O. So the engine gate, a future admin preview UI, and any
  other repo all share the *exact same* detection, and it's trivially testable.
- **Redact, don't reject.** Replace the secret substring with `[REDACTED:label]`
  and keep the surrounding knowledge. Blocking the write would lose the note.
- **Pattern-based, NOT entropy.** A redacted *real* fact corrupts knowledge, so
  we accept missing an exotic token over false-positiving. We never add a bare
  high-entropy/hex pattern.
- **Order-sensitive (load-bearing).** Specific patterns run before generic ones:
  `sk-ant-` before OpenAI `sk-`; `sk-or-v1-` (OpenRouter) before `sk-`. Each
  match is consumed before the next pattern runs, so order = attribution.
- **`labeled-hex-secret` context trick.** The prefix-less service secrets
  (CMS_JWT_SECRET, revalidateSecret, `openssl rand -hex 32` fleet keys) can't be
  a bare `[0-9a-f]{64}` pattern (would hit git shas / hashes). So we only fire
  when a 40+ hex value is assigned to a field whose *name* contains
  secret/token/password/api-key → near-zero FP.
- **Validated:** verify suite passes (every provider sample + benign-text FP
  guards); a dry-scan of **651 real Neurons = 0 leaks, 0 false positives** with
  the full pattern set (incl. the broad Discord pattern).

## 2. WHERE — file inventory + integration call-sites

| File | Role |
|---|---|
| `packages/shared/src/secret-scan.ts` | **The detector.** `SECRET_PATTERNS`, `redactSecrets`, `hasSecret`, `redactionMarker` + types. THE thing to lift. |
| `packages/shared/src/index.ts` | re-exports it (`export * from './secret-scan.js'`). |
| `packages/core/src/queue/candidates.ts` | **Ingest gate.** Local `scrubForLeaks()` helper applied at 4 persist boundaries: `enqueueCandidate` (createCandidate), `submitCuratorEdit`, `approveCreate` materialize, `approveUpdate` materialize. |
| `apps/server/src/services/chat/build-prompt.ts` | **Egress:** scrub retrieved context before the prompt. |
| `apps/server/src/services/chat/postprocess.ts` | **Egress:** `stripForAudience` scrubs the answer (all audiences). |
| `apps/server/src/routes/search.ts` | **Egress:** scrub `title`/`highlight`/`userNote` + chunk `content` on every return. |
| `apps/server/scripts/scan-kb-secrets.ts` | **Retro-scan** tool (dry-run + `--apply` redaction via PUT /documents/:id/content). |
| `apps/server/scripts/verify-f197-secret-gate.ts` | **Test/fixture** — the 0-FP suite (provider samples + benign guards + DB round-trip + egress). Port this as the regression fixture. |
| `docs/features/F197-secret-scan-gate.md` | plan-doc. |

## 3. HOW — public API contract

```ts
interface SecretPattern { label: string; description: string; regex: RegExp; } // global regex
interface RedactionFinding { label: string; count: number; }
interface RedactionResult { redacted: string; findings: RedactionFinding[]; }

const SECRET_PATTERNS: SecretPattern[];          // ordered most-specific → least
function redactSecrets(text: string): RedactionResult;  // pure; clean input → byte-identical, findings:[]
function hasSecret(text: string): boolean;
function redactionMarker(label: string): string;       // `[REDACTED:${label}]`
```

- `redactSecrets` replaces every match with `[REDACTED:<label>]` and returns
  per-pattern counts. Implemented as a `for (pattern) text = text.replace(re, …)`
  loop — `String.replace` with a global regex is lastIndex-safe (don't port a
  `.test()`/`.exec()` loop without resetting `lastIndex`).
- **No ReDoS:** no nested quantifiers over overlapping classes. One fixed-length
  negative lookbehind (Discord pattern) — JSC/Bun-safe.

## 4. CONSOLIDATED fleet pattern list (broadcast replies)

Already in `SECRET_PATTERNS` (v1 canonical set):
- **LLM:** Anthropic `sk-ant-(api03-|oat01-)…` (OAuth oat01 variant confirmed),
  OpenAI `sk-`/`sk-proj-`, OpenRouter `sk-or-v1-`+64hex, ElevenLabs `sk_`+48hex,
  fal `uuid:hex32`, Google `AIza…`, Google-OAuth `GOCSPX-`.
- **Cloud/infra:** AWS `AKIA…`, GitHub `gh[pousr]_…`, GitLab `glpat-`,
  Slack `xox[baprs]-`, Stripe `[rs]k_live_`, Resend `re_…`, Fly `FlyV1 fm2_`/`fo1_`,
  Cloudflare global key (37-hex), Supabase `sbp_`+40hex & `sb_secret_…`
  (service_role = JWT), npm `npm_`+36.
- **Fleet:** upmetrics `uk_`+48hex, cms `wh_`+64hex, cardmem `pa_/pi_/pk_`+64hex
  & `piw_`(inbox-webhook)+64hex, trail `trail_`.
- **Generic:** JWT `eyJ…eyJ…` (also covers **Turso** DB/platform auth tokens +
  Supabase anon/service_role), PEM private-key blocks, `labeled-hex-secret`
  (40+ hex on a secret/token/password/api-key-named field).

**Deferred (need exact format or are context-only — fold in when confirmed):**
- Cloudflare **Turnstile** (sanne): prod secret `0x4AAAAAA…` base64url, ~33-35;
  site key (public) ~23-25; test keys `1x/2x/3x…` (whitelist). sanne has the
  exact regex.
- **Turso platform API token** (buddy): long opaque, format uncertain (DB auth
  token is a JWT → already covered; the *platform* token may differ).
- **Prefix-less hex secrets** (buddy/components/fds/cardmem): BUDDY_SERVER_TOKEN,
  RESEARCH_CAPTURE_KEY, CARDMEM_DAEMON_KEY, Code-Launcher bearer, Pitch-Vault key
  — bare hex32/hex64, only safely caught via the `labeled-hex-secret`
  name-context approach (no clean per-type regex).
- **Mistral** (fds/ai-sdk): ~32 alnum, no prefix → context-only until Mistral adds a prefix.
- **Vimeo / Calendarific** (sanne): niche, confirm format first.

## 5. MIGRATION — how Trail consumes the npm

Keep the API names identical so Trail's call-sites don't change. After v1 publishes:
- `@trail/shared` adds `@broberg/secret-scan` as a dep and `packages/shared/src/secret-scan.ts`
  becomes `export * from '@broberg/secret-scan';` (re-export). Every existing
  `import { redactSecrets } from '@trail/shared'` (candidates.ts + chat + search)
  keeps working unchanged.
- So the npm's `exports` MUST surface: `redactSecrets`, `hasSecret`,
  `SECRET_PATTERNS`, `redactionMarker`, and the types `SecretPattern`,
  `RedactionResult`, `RedactionFinding`.
- I (trail) own that migration PR when you ping me that v1 is on npm.

## 6. Lessons / sharp edges (if building shared from day 1)

- **Custom-patterns API.** Design `redactSecrets(text, opts?: { extraPatterns?: SecretPattern[] })`
  so a repo can add its own patterns on top of the canonical set. This is also
  the backend for Christian's F197.3 "paste a key → detector" self-service UI
  (per-tenant patterns stored in settings).
- **Order is API.** The specific-before-generic ordering is load-bearing
  (attribution + correct consumption). Ship a test that asserts it.
- **Never bare-hex.** The single biggest FP trap. The labeled-context pattern is
  the answer; document it loudly.
- **Two recommended integration shapes** to document for consumers: (a) write
  boundary (redact before persist), (b) egress (scrub before the value leaves
  to a user/LLM). The egress-on-chat-context one is the highest-value guard.
- **Port the verify suite as the package's regression fixture** — it's the proof
  of both coverage and 0-FP.
- **Keep it dep-free + `lib: ES2022`** (no DOM/node needed — it's pure). Don't
  let fetch/process creep in (the retro-scan tool, which DOES do I/O, should be a
  separate entrypoint/bin, not the core module).
