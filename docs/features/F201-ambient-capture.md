# F201 — Trail Ambient Capture

> macOS background agent that passively observes work (app + audio + screen),
> runs the signal through an on-device gate, and POSTs **candidates** to Trail's
> curation queue. Trail compiles them into curated **Neurons**. Inspired by
> getsoda.app — but instead of building RAG + embeddings + entity-resolution
> ourselves, we reuse Trail's compile-at-ingest engine, which already solves
> exactly the problems Soda struggles with.
>
> Source spec: Christian's "Trail Ambient Capture — Implementeringsplan v2"
> (attached to the trail-F201 card). This plan-doc is that spec adapted into
> the house format, plus the auth requirement added on the card itself.

## Motivation

Soda is four stacked layers: passive capture → classification gate → entity
memory with "living profiles" → shared team knowledge layer. The decisive
insight (from the v2 spec): **layers 3+4 ARE Trail.** We don't build the memory
layer — we build the capture agent (layer 1) + a thin gate (layer 2a), then
POST candidates to Trail. De-dup, canonical seqIDs, provenance, supersession,
typed edges, team sharing, FTS5 search + chat — all already exist.

| Soda concept | Trail counterpart (existing) |
|---|---|
| Classification gate | On-device gate (ours) + Trail's curation queue |
| Living profiles, traceable | Neurons with provenance, `supersedes` edges, version history |
| Consistent answer across time | Canonical seqIDs + de-dup |
| Mid-call search | `GET /api/v1/search` (FTS5) + `POST /api/v1/chat` |
| Team knowledge layer | Trail KB per tenant, bearer-token scoped |

**Decisions locked in the spec (elicitation):**
- Capture breadth v1: **full** — app + audio + screen frames
- Extraction: **hybrid** — on-device gate + redaction; cloud compile happens in Trail
- Targets: **configurable** — route candidates to different Trail KBs
  (e.g. one KB for B2B deal-knowledge, one for personal knowledge)

**Hard requirement from the card (Christian, verbatim intent):** Ambient is
useless without a Trail account. Login MUST reuse the user's existing Trail
user via a simple OAuth-style flow — launching Trail Ambient sends you to
app.trailmem.com to obtain your token.

## Scope

**We build (new):**
1. `apps/ambient-capture/` — native Swift macOS agent (`LSUIElement` launch
   agent: no menubar, no dock) + a small SwiftUI HUD. AXUIElement focus
   capture, ScreenCaptureKit frames + Vision OCR, system-audio tap + on-device
   STT (WhisperKit first; Apple SpeechTranscriber later).
2. `packages/ambient-gate/` — TS package (Bun, ESM): gate heuristics,
   PII/secret redaction, KB routing, candidate-POST client. Runs as a tiny
   local relay (Hono) or as a library the Swift agent calls.
3. **Device-auth flow** on the engine + admin (see Technical Design) so the
   agent authenticates as an existing Trail user.
4. Connector id `trail-ambient-capture` in `packages/shared/src/connectors.ts`.

**Trail engine (existing — NOT built here):** curation queue →
(auto-policy/curator) → compile-at-ingest → Neurons → FTS5/chat. The agent is
a pure API client of `/api/v1/queue/candidates`, `/search`, `/chat`.

## Non-Goals

- NO embeddings, NO vector store, NO entity-resolution in the agent — that was
  the v1 mistake the v2 spec explicitly reverts. Trail's compile-at-ingest is
  the memory layer.
- NOT a new repo — lives in the existing `broberg-ai/trail` monorepo.
- NOT Windows/Linux/iOS; macOS (Apple Silicon) only in v1.
- NOT Soda-style invisibility: transparency is the feature (visible recording
  indicator, pause hotkey, per-app deny-list — never 1Password/bank/private
  messages).
- NOT replacing F146 (local-first native Trail app + CRDT sync). F146 packages
  the Trail *engine* natively; F201 is a capture *client* of the cloud engine.
  No shared code beyond the REST contract.

## Technical Design

### Architecture (from the v2 spec)

Raw signal (focus events, OCR'd frames, transcribed audio) is debounced and
windowed on-device, then passes the gate: cheap heuristics (later optionally a
small local MLX model) scoring "does this chunk contain a commitment /
decision / name / customer fact?", a redaction pass, and KB routing. Only
gated, redacted **text** ever leaves the machine, as:

```
POST /api/v1/queue/candidates
{ kb, kind: 'external-feed', title, content,
  metadata: { connector: 'trail-ambient-capture', sourceUrl, capturedAt } }
```

Corrections to existing knowledge use `kind: 'user-correction'` +
`metadata.targetNeuron` (Trail's supersede mechanism). Raw frames/audio NEVER
leave the machine.

### Auth — device-authorization flow (RFC 8628-lite)

"Simpelt oauth flow" per the card, without a full OAuth server:

1. Agent generates a random `device_code`, opens the browser at
   `https://app.trailmem.com/ambient/connect?code=<device_code>&name=<mac-name>`.
2. The logged-in Trail user sees an approve page: which device, pick tenant +
   allowed KBs. Approve → admin mints a **scoped** `trail_` token (existing
   API-key infrastructure; scope: candidates-write + search/chat read on the
   chosen KBs) bound to the device_code.
3. Agent polls `POST /api/v1/ambient/token {device_code}` until the token is
   released (single-use exchange, short TTL), stores it in the macOS Keychain.

No token pasting, no localhost callback server, works with any browser. An
unapproved/expired code exchanges to 404/410 — never a silent fallback.

### Redaction — reuse, don't re-roll

The gate's secret-redaction MUST reuse **@broberg/secret-scan** (F197,
components-owned; Trail already re-exports via `@trail/shared`). New ambient-
specific patterns (credit cards, CPR) go INTO the shared package via
components, never as a local pattern list.

### Candidate volume (top risk)

Ambient capture can produce MANY candidates. The gate must be strict, and the
gate batches per session — e.g. ONE candidate per call/meeting, not one per
sentence. Per-KB auto-approval confidence policy: high-confidence captures
become Neurons unattended; low-confidence waits in the queue UI. F200's per-KB
lint toggle precedent applies: high-volume ambient KBs may also want
contradiction-lint OFF.

### Monorepo placement

```
apps/ambient-capture/    # Swift macOS agent (Xcode/SPM; turbo wraps xcodebuild)
packages/ambient-gate/   # TS gate + candidate-relay (Bun, ESM)
```

Connector registered in `packages/shared/src/connectors.ts` (status flips
roadmap→live when F201.4 lands end-to-end).

## Privacy / GDPR

Transparency as the differentiator (vs Soda's deliberate invisibility):
on-device raw capture only; visible recording indicator; pause hotkey; per-app
deny-list; "what does Trail know about me" = search your own personal KB;
Neuron-level right-to-delete; explicit consent for capturing other parties'
audio (legal requirement for calls — clarify EU rules before F201.6 ships).
Any cloud compile of ambient data follows the F199 directive: Mistral EU only.

## Stories

| # | Story | Phase in spec |
|---|---|---|
| F201.1 | Scaffold: `packages/ambient-gate` + connector registration + turbo wiring | §9 / step 2-3 |
| F201.2 | Device-auth flow (engine endpoints + admin approve page + scoped token) | card requirement |
| F201.3 | Swift skeleton: LSUIElement app, TCC perms, AXUIElement focus capture | F1 |
| F201.4 | Gate→Trail end-to-end: gate + redaction → candidate in a test KB | F2 |
| F201.5 | Screen frames + Vision OCR (on-device) → gate | F3 |
| F201.6 | Audio tap + mic + WhisperKit STT (on-device, VAD) → gate | F4 |
| F201.7 | KB routing: deal vs personal → correct kb slug | F5 |
| F201.8 | Per-KB auto-approval confidence policy + queue review flow | F6 |
| F201.9 | HUD: menubar-less SwiftUI panel → /search + /chat | F7 |
| F201.10 | Team: second user, shared KB, shared Neurons | F8 |

## Dependencies

- Trail REST surface: `/api/v1/queue/candidates`, `/search`, `/chat`,
  API-key mint (all live).
- `@broberg/secret-scan` (F197) for redaction.
- WhisperKit (CoreML) for STT; ScreenCaptureKit + Vision (OS frameworks).
- Xcode on the build Mac for `apps/ambient-capture`.

## Open Questions / Risks (from the spec)

- STT: WhisperKit (mature) vs Apple SpeechTranscriber (macOS 26+) — start WhisperKit.
- Gate model: pure heuristics v1; small MLX model later.
- ScreenCaptureKit CPU/battery: low fps + delta trigger; measure early.
- Audio-consent law (EU) before F201.6.
- Auto-approval threshold: too low → noisy Trail; too high → everything manual.

## Verification

Each story carries its own testable AC on the board. Epic-level: a real
work-session on the Mac produces gated, redacted candidates in the correct KB
with connector `trail-ambient-capture`, approved ones compile to Neurons, and
the HUD answers a mid-call query in <2 clicks — with zero raw frames/audio
leaving the machine (verified by egress inspection of the agent's traffic).
