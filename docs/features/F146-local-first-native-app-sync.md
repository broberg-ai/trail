# F146 — Local-first native app + CRDT sync

> "Built on CRDTs. Your knowledge graph lives locally for zero-latency access, syncing securely to the cloud when connected."
>
> Trail as a native desktop app (Mac / Windows / Linux) that runs the full engine locally, syncs to the cloud via CRDT, and — crucially — owns its own compute so `claude -p` subprocess ingest stays legal and cost-controlled at scale. The cloud remains the source of truth for retrieval + chat + cross-device sync; the local app is the power-user tier that lets a curator drop 500 PDFs on a Saturday and wake Monday to a compiled KB without blowing through API quotas. Tier: Enterprise. Effort: 3-4 weeks.

## Why this matters

Two unrelated problems collapse into one solution.

**Problem 1 — the API ingest cost wall.** Post-cloud-launch, every ingest goes through the paid API path (no more `claude -p` subprocess since there's no user shell to spawn from). A 200-source batch at F137 chunked rates is ~$20-40 in API tokens, and the latency is always network-bound. For bulk initial imports (e.g. Sanne's 15-year case library, FysioDK's patient protocols), that's a business-model problem before it's an engineering problem.

**Problem 2 — the local-first UX gap.** Users who already use Obsidian / Logseq / Notion-offline expect instant reads, offline edits, and automatic merge. A pure SaaS with spinner on every query is a regression for that audience. F146 gives them a real local store without losing the "accessible from any device" value prop of the cloud product.

**The pattern**: run Trail's engine in a native shell on the user's machine. Ingest (compile) happens locally — user's `claude -p` licence, user's hardware, zero API tokens for the LLM step. Compiled Neurons + events stream to the cloud via CRDT sync. Retrieval and chat can hit either side (cloud for phone, local for desktop). The two stores converge via CRDT merge, no "which version wins" dialogs.

## Secondary Pain Points

- No offline access to KB content
- API rate limits block large batch imports
- No local compute for users with existing Anthropic subscriptions

## Solution / Scope

### In — Phase 3 (enterprise / power-user tier)

- **Native shell**: the existing `apps/server` engine packaged into a native binary. Electron is the safe default (broad platform coverage, we already ship TypeScript); Tauri is the lightweight alternative (smaller binary, Rust runtime) if Electron's footprint becomes a problem post-MVP.
- **Local LLM subprocess ingest**: the `claude -p` codepath that already works today (F06) stays intact on native. On cloud-only accounts, ingest routes via API. The split is a per-tenant flag + per-KB default — a tenant can have both a local app installed and cloud retrieval.
- **CRDT sync layer**: one CRDT document per KB, containing wiki_events + queue_candidates + documents rollups. F16 already writes an event log — CRDT on top is largely a re-encoding + merge helper, not a new model. Yjs is the default candidate (mature, streaming-capable, existing bindings for SQLite-style backends).
- **Cloud as source of truth for retrieval**: chat / search / embed widget hit the cloud engine, which holds a merged view of every device's contributions. The local app can also serve retrieval when offline, using its own merged view.
- **Plan tiers**: Hobby + Pro = cloud-only (API ingest). Business + Enterprise = local app available (subprocess ingest). Nudge the "you have a big import" flow to mention the native app when it would save them money.

### User-side prerequisite: Anthropic Pro or Max subscription

The native app's subprocess ingest depends on `claude -p` being installed
and logged in on the user's machine. `claude -p` authenticates against the
user's **Anthropic Pro or Max subscription** — it is NOT a standalone tool
we can bundle.

**Verified via Anthropic pricing (2026-04-22):** Claude Code is explicitly
included in Pro (~$20/mo) and Max (~$100+/mo). The CLI surface — `claude`
and `claude -p` — is part of the Claude Code offering across all surfaces
(Terminal, VS Code, JetBrains, Desktop, Web). Rumors that Claude Code is
Max-only or API-only are not current — Pro is sufficient.

Tier guidance for Trail native users:

| Anthropic tier | Fit for Trail native ingest |
|---|---|
| **Pro** (~$20/mo) | Works for typical curator flow — a few sources per day, occasional 10-20-source batch. Hits Pro's usage ceiling (~5h rolling window) on genuinely large imports. |
| **Max** (~$100-200/mo) | Recommended for bulk-import users (Sanne's 15y case archive, FysioDK's full protocol library). 5-20× Pro's ceiling, comfortable for 200+ sources in a single weekend. |

A Business / Enterprise Trail user on the native tier needs TWO
subscriptions running in parallel:

1. **Trail** (our business + enterprise plan) — covers retrieval, chat,
   cloud sync, multi-device.
2. **Anthropic Pro or Max** (user's own subscription, separate billing
   from Trail) — covers the LLM compute for local ingest runs.

Trail's onboarding + docs must surface this upfront. The economic point
holds: a 200-source import that costs $30-40 via our API path costs $0
marginal against an already-paid Anthropic sub — that's the entire reason
native exists.

The install flow on native must detect missing `claude -p` / unauthenticated
state and link out to Anthropic's subscription page with a clear "why you
need this" explainer — not fail silently.

### Out (future phases)

- Real-time collaborative editing (CRDT enables it architecturally, but the UX is not the v1 story — F76 covers that).
- Peer-to-peer sync without the cloud relay. Cloud stays in the middle for consistency of the retrieval view.
- iOS / Android native. Mobile stays as the existing web client against the cloud.
- Plugin API for third-party tools reading the local CRDT directly. Revisit after the native shell ships.

## Non-Goals

- **Replacing the cloud engine.** Cloud stays the default. Native is an add-on for tenants who want it.
- **"Download your KB" feature.** Users don't manually export/import — sync is continuous, automatic, conflict-free.
- **Full mobile app via React Native / Capacitor.** Mobile uses the existing web UI against the cloud. Local-first on mobile is a separate F-number if it ever happens.
- **Integrating Obsidian / Logseq.** F25 (image pipeline) + F26 (HTML clipper) cover import; the native app is a distinct product, not a plugin for existing apps.

## Technical Design

### Architecture sketch

The engine code is unchanged between native and cloud — same bun process, same tables, same HTTP routes. The differences are:

1. **How ingest runs**: native spawns `claude -p` (F06 codepath); cloud calls the Anthropic Messages API (F14 adapter already supports both).
2. **How state syncs**: a sync-worker co-hosted with the engine pushes local wiki_events + queue_candidates through a CRDT encoder and streams it to the cloud relay over WSS. The cloud relay writes the CRDT state back into its own per-tenant libSQL + signals other devices.
3. **How retrieval runs**: native retrieval hits local SQLite; cloud retrieval hits cloud libSQL. Both see the same merged state (CRDT guarantee).

### CRDT choice: Yjs

- **Why Yjs over Automerge**: Yjs streams deltas instead of shipping full document snapshots — critical when wiki_events tables grow to 100k+ rows. Automerge is ergonomic for dev but the full-history-in-memory default breaks at the scale Trail operates at.
- **Granularity**: one Yjs document per KB. KBs are the natural sync boundary (tenant isolation + cross-tenant knowledge stays separate).
- **What lives in the CRDT**: `wiki_events` (the append-only log), `queue_candidates` (pending work), and a projection of `documents` derived from events. The FTS index (`documents_fts`) is local-only — rebuilt from the CRDT state on sync, not synced itself.
- **What does NOT live in the CRDT**: access tokens, tenant config, storage-adapter state. Those are cloud-authoritative. The native app reads them on login, caches for offline, never writes them.

## Effort Estimate

**Large** — 3-4 weeks of focused work, distributed across months given dependencies.
- 2-3 days: spike (Electron vs Tauri packaging)
- 1 week: sync protocol proof (Yjs encoder + WSS relay)
- 1 week: ingest mode routing + CRDT-aware queue
- 1 week: install flow + plan-tier gating + testing
- 1 week: polish + enterprise ship