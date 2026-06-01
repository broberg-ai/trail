# F182 — Memory Lifecycle: per-claim confidence + supersession + retention decay

> Trail today treats every wiki-claim as equally valid forever. Without a lifecycle, the KB rots: stale claims sit alongside fresh ones, contradictions accumulate without resolution, and the LLM's "I'm fairly sure about X but less sure about Y" judgment is unavailable. F182 closes this gap by attaching confidence + supersession + retention metadata to every claim that the LLM extracts at ingest, decaying over time, strengthening on reinforcement, and auto-resolving when new evidence contradicts old. Tier: all. Effort: Large — 7-10 days for Phase 1+2. Status: Planned.

## Open questions (interim plan-doc)

This is an **interim plan-doc** written 2026-05-05 from Rohit Ganapathy's *LLM Wiki v2* gist (see [LLM-WIKI-V2-CROSSCHECK](../thinking/LLM-WIKI-V2-CROSSCHECK.md)). The gnusupport critique in the gist comments — "confidence scoring is never defined" — is correct, and these are the implementation choices we have to make:

1. **Confidence formula.** Proposal: `confidence = recency_factor × source_strength × (1 - contradiction_factor)`, normalized to [0, 1]. Where:
   - `recency_factor = exp(-Δt/τ)` per F139 Ebbinghaus — τ is per-claim-type (architecture decisions: τ=2y, transient bugs: τ=30d, regulatory facts: τ=1y, defaults τ=180d)
   - `source_strength = log2(1 + n_sources) × authority_weight` — authority comes from F95 connector + source-type
   - `contradiction_factor = 0.3 × n_unresolved_contradictions` — capped at 0.9
   - This is a STARTING formula. Tuning will require ground-truth dataset (held-out queries).

2. **Granularity: per-claim or per-Neuron?** Per-claim is more accurate but expensive (LLM has to extract every assertion as a structured row). Per-Neuron is coarse but cheap. **Phase 1 ships per-Neuron** (single confidence on the whole document). **Phase 2 explores per-claim** if Phase 1 confidence numbers feel too noisy. The v2 spec implies per-claim but Rohit's `agentmemory` repo doesn't fully implement it either.

3. **Supersession trigger threshold.** When does new evidence auto-supersede old? Proposal: `auto_supersede` if `(new_confidence - old_confidence) > 0.25` AND `new_source_count >= old_source_count` AND `contradiction_lint` (F158) has flagged the pair. Otherwise: emit a `pending-supersession` candidate to F143 queue for curator review.

4. **Retention decay rate per Neuron type (F101).** Different types decay at different rates. Proposal:
   - `concept` Neurons: τ = 365d (slow decay)
   - `entity` Neurons: τ = 180d
   - `synthesis` / `query` Neurons: τ = 90d
   - `session` Neurons: τ = 30d (fast decay — episodic memory)
   - `glossary` / `comparison`: τ = 365d
   - Heuristics already covered by F139 (1.0→0.1 over 365d)

5. **What does "decayed" mean operationally?** Not deletion. Proposal: when `confidence < 0.3`, Neuron is hidden from default chat-context (F89), reader graph (F99) deemphasizes it visually, search (F10) deboosts it, and admin Settings tab shows a "needs-attention" panel. Curator can pin to override decay.

6. **Reinforcement signal sources.** What resets the decay curve? Proposal: (a) new ingest cites this Neuron → +0.1 confidence; (b) F141 access-telemetry shows N reads in a window → confirmation; (c) curator explicit "still relevant" action; (d) chat answer cites this Neuron → +0.05.

7. **UI surfacing of confidence.** Memory: per `project_confidence_ui.md` — when confidence becomes dynamic, show in Chat save-dialog AND any save-to-queue UI. F182 makes this concrete: confidence chip on Reader header, in queue candidate cards, in Neuron Editor save-confirm modal.

These open questions are blocking neither the plan-doc nor the F-number. Implementer should resolve before migration code lands.

## Motivation

Rohit Ganapathy's *LLM Wiki v2* gist (April 2026) names this as the missing layer in Karpathy's original:

> *"The original treats all wiki content as equally valid forever. In practice, knowledge has a lifecycle. A bug you discovered last week matters more than one from six months ago. A pattern you've seen twelve times is more reliable than one you've seen once. A claim from a newer source should weaken an older one automatically."*

Trail today implements pieces of this:
- **F19 auto-approval policy** — confidence on candidates at *write-time* (gates whether content lands), not on resident claims over time
- **F139 heuristic decay** — Ebbinghaus-style 1.0→0.1 over 365d, but only for `/neurons/heuristics/` Neurons
- **F158 idempotent contradiction-lint** — detects but doesn't auto-resolve
- **F141 access telemetry** — captures reads but doesn't feed back into confidence
- **F137 typed edges** — has `supersedes` edge type, but no auto-supersession mechanism

F182 unifies these into a coherent lifecycle: **every Neuron carries a confidence score, decays over time, strengthens on reinforcement, and is auto-superseded when new evidence outweighs old.** This is the architectural piece that turns a flat-collection-of-claims into a "living model where the LLM can say 'I'm fairly sure about X but less sure about Y'" (Rohit).

### Why now (vs deferred)

This is the most foundational of the v2 features. F183 (consolidation tiers) and F184 (entity layer) both assume lifecycle exists. Without it, every other improvement is a band-aid on a rotting KB. **Should ship before F184 entity-extraction adds 10× more rows that also need lifecycle metadata.**

Realistic priority: **post-Sanne-launch Phase 2.** Sanne benefits — her clinical KB needs "this protocol was current in 2024 but updated 2026" semantics — but the implementation is too big to land during her onboarding window.

## Scope

### In scope (Phase 1 + Phase 2)

- **Per-Neuron confidence column** on `documents` table (REAL [0, 1], default 0.7)
- **Confidence-formula service** (`apps/server/src/services/confidence.ts`) implementing the formula above + tunable τ per Neuron type
- **Reinforcement signal collection** — wire F141 access-telemetry, F143 ingest-cites-this, F89 chat-cites-this to call `recordReinforcement(neuronId, signalType, weight)`
- **Decay job** — runs nightly per F32-style scheduler, recomputes `confidence` for all Neurons based on age + reinforcement history
- **Supersession workflow** — when F158 detects a contradiction AND new-confidence > old-confidence by threshold, auto-emit a `supersede` candidate to F143 queue (governed by F19 auto-approval policy + F106 Solo Mode); on approval, write `supersedes`-edge per F137, mark old Neuron `superseded`, preserve old version (don't delete)
- **Decay-aware chat** — F89 chat-context-builder boosts high-confidence Neurons, deboosts low-confidence ones (default threshold: hide if < 0.3, deemphasize if < 0.5)
- **Decay-aware reader** — F99 graph dims low-confidence nodes; reader badge shows confidence chip
- **Admin "Memory Health" tab** — shows confidence distribution histogram per KB, lists low-confidence Neurons sorted by decay rate, lets curator pin Neurons to override decay
- **Per-tenant configurable decay rates** — tenant Settings exposes per-Neuron-type τ values

### Non-goals (Phase 1 + Phase 2)

- Per-claim confidence (every assertion in a Neuron has its own score) — Phase 3+
- Multi-source citation extraction (LLM extracts "this claim came from these N sources") — Phase 3+
- Cross-tenant confidence sharing
- Visual claim-level highlighting in reader (red text for low confidence)
- Auto-deletion of decayed Neurons — they're hidden, never deleted; deletion stays a curator action

## Architecture sketch

### Data model

Migration adds three columns to `documents` table:

```sql
ALTER TABLE documents ADD COLUMN confidence REAL NOT NULL DEFAULT 0.7;
ALTER TABLE documents ADD COLUMN confidence_last_recomputed_at INTEGER;
ALTER TABLE documents ADD COLUMN superseded_by_neuron_id INTEGER REFERENCES documents(id);
```

New `confidence_signals` table for reinforcement-event log:

```sql
CREATE TABLE confidence_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  neuron_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,  -- 'cite' | 'access' | 'curator-pin' | 'chat-cite' | 'contradiction'
  weight REAL NOT NULL,
  source_neuron_id INTEGER REFERENCES documents(id),
  recorded_at INTEGER NOT NULL,
  metadata TEXT  -- JSON, e.g. {"connector":"upload"} for cite-by-source
);
CREATE INDEX idx_confidence_signals_neuron ON confidence_signals(neuron_id, recorded_at DESC);
```

Per-tenant decay-rate config goes in `tenants.settings_json` (existing column), keyed by Neuron type.

### Confidence service

`apps/server/src/services/confidence.ts`:

```ts
export function computeConfidence(deps: {
  neuron: NeuronRow;
  signals: ConfidenceSignal[];
  contradictionCount: number;
  decayRates: Record<NeuronType, number>;
  now: number;
}): number {
  const ageDays = (deps.now - deps.neuron.created_at) / (24 * 3600 * 1000);
  const tau = deps.decayRates[deps.neuron.type] ?? 180;
  const recency = Math.exp(-ageDays / tau);

  const sourceCount = countDistinctSources(deps.signals);
  const sourceStrength = Math.log2(1 + sourceCount) / Math.log2(11); // normalized at n=10

  const contradictionFactor = Math.min(0.9, 0.3 * deps.contradictionCount);

  // Reinforcement boost from recent access/cite signals
  const reinforcementBoost = computeReinforcementBoost(deps.signals, deps.now);

  const raw = recency * sourceStrength * (1 - contradictionFactor) + reinforcementBoost;
  return Math.max(0, Math.min(1, raw));
}
```

### Decay job

Mirrors `lint-scheduler.ts` pattern. Runs nightly per-tenant. For each Neuron:
1. Load `confidence_signals` for last 90 days
2. Count active contradictions via F158 signature lookup
3. Recompute confidence via formula
4. Update `documents.confidence` + `confidence_last_recomputed_at`

Signature-skip per F158 pattern: if Neuron+signals haven't changed since last run, skip recompute.

### Supersession workflow

```
on contradiction-lint detection (F158):
  load both Neurons
  if abs(neuron_a.confidence - neuron_b.confidence) > 0.25
    AND newer.source_count >= older.source_count:
    emit candidate to F143 queue:
      kind: 'supersede'
      target_neuron_id: older.id
      replacement_neuron_id: newer.id
      confidence: newer.confidence (per F19 auto-approve gate)
  else:
    emit candidate as 'pending-supersession' (curator review required)

on candidate approval:
  insert wiki_backlinks edge with edge_type='supersedes'
  update older.superseded_by_neuron_id = newer.id
  emit activity_log row (kind: 'supersession', actor: curator | auto)
```

### Reader + chat integration

- **Reader (F99 graph)** — node opacity = `confidence`. Hover tooltip shows confidence + last-reinforcement-date.
- **Reader (page header)** — confidence chip with color: green ≥0.7, amber 0.4-0.7, red <0.4. Click → "Memory Health" tab filtered to this Neuron.
- **Chat (F89 prompt-builder)** — sort retrieved-context Neurons by confidence DESC. Hide if `< 0.3` unless explicitly cited by user query.
- **Chat (F12 answer-rendering)** — confidence-chip next to each cited source.
- **Queue UI** — confidence column + filter chip.

### Admin "Memory Health" tab (Phase 2)

New `/admin/kb/:id/memory-health` route:
- Confidence histogram (5 buckets: 0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0)
- "Decaying" tab: Neurons with `confidence < 0.5` AND no reinforcement in last 30d, sorted by τ-aware urgency
- "Superseded" tab: list of `superseded_by_neuron_id` chains, click to view diff
- Per-Neuron-type decay-rate sliders (writes to `tenants.settings_json`)

## Dependencies

- **F19** auto-approval policy — supersession candidates flow through this
- **F106** Solo Mode — bypasses curator approval for solo users who trust the auto-resolution
- **F32/F118/F158** lint scheduler + idempotent contradiction-lint — supersession trigger
- **F137** typed edges — `supersedes` edge already defined
- **F139** heuristic decay — F182 generalizes this pattern across all Neuron types
- **F141** access telemetry — feeds reinforcement signals
- **F143** ingest queue — supersession candidates flow here
- **F89** chat tools — decay-aware retrieval
- **F99** Obsidian graph — confidence-aware rendering
- **F143** + queue infra
- **F156** credits — decay job is cheap (no LLM calls in Phase 1) but contradiction-resolution-LLM-calls per F158 are metered

## Rollout phases

**Phase 1 — Foundation (4 days)**
- Migration: confidence column + confidence_signals table
- Confidence service with tunable formula
- Decay job (nightly per-tenant)
- Wire reinforcement signals from F141 + F143 ingest + F89 chat-cites
- Verification script `apps/server/scripts/verify-confidence.ts` end-to-end probe

**Phase 2 — Supersession + UI (3 days)**
- Supersession candidate emission on F158 contradiction
- Curator approval flow (extends existing F143 queue UI)
- Reader confidence chip + graph opacity
- Chat decay-aware retrieval
- Admin Memory Health tab

**Phase 3 — Per-claim confidence (deferred — open question 2)**
- LLM extracts claim-set from Neuron at ingest
- Per-claim confidence rows
- Inline reader highlighting
- Substantial scope — separate F-number when prioritized

## Verification

`apps/server/scripts/verify-memory-lifecycle.ts` proves end-to-end:

1. Create test KB with 3 Neurons (created 2y ago, 6mo ago, 1d ago)
2. Insert reinforcement signals: oldest gets 5 access events, newest gets 0
3. Run decay-job once
4. Assert: oldest confidence > newest (reinforcement compensates age)
5. Assert: all confidences in [0, 1]
6. Insert contradiction-pair via F158 fixture
7. Assert: supersession candidate appears in F143 queue with correct `target_neuron_id` + `replacement_neuron_id`
8. Approve via candidate-API
9. Assert: `wiki_backlinks` has new `supersedes` edge, `documents.superseded_by_neuron_id` populated, old version preserved (Neuron not deleted)
10. Assert: `activity_log` has `kind='supersession'` row

Per CLAUDE.md verification rule: this script is the F47-style runtime probe. Typecheck doesn't prove decay-job actually ran or contradiction-trigger actually fired.

## Effort estimate

Phase 1 + Phase 2 combined: **7-10 days** of focused engineering. Phase 1 (formula + decay job + signal wiring) is the bulk; Phase 2 (supersession + admin UI) is smaller but UI-heavy.

## Curator-pin as decay EXEMPTION (F182.8) — design refinement 2026-06-01

Open questions 5 and 6(c) mention "curator can pin to override decay" and the
F182.4 task reserved a `curator-pin` reinforcement weight (0.3). Implementation
review (2026-06-01, with Christian) found that modelling a pin as a *reinforcement
boost* is the wrong mechanism, and the canonical counter-example is **Isaac
Newton**:

> Newton's laws are ~340 years old. With τ=365d, `recency = exp(−124000/365) ≈ 0`.
> Even the full +0.3 boost lands confidence at ~0.3 — barely visible — for a fact
> that is *100% true*. A boost only floors the value; it does not make a timeless
> fact timeless. Some facts never get too old, and the decay model must be able to
> say so.

**Therefore curator-pin is a decay EXEMPTION, not a reinforcement signal.** When a
curator pins a Neuron they are asserting human judgment that overrides the
automatic formula entirely: *"I vouch for this, indefinitely."*

Design:

- New `documents.confidence_pinned` (boolean, default false) + `confidence_pinned_at`
  (epoch ms) + `confidence_pinned_by` (user id). A *state*, not a decaying event.
- The decay job short-circuits pinned Neurons: `if (pinned) confidence = 1.0` and
  skips the formula (still stamps `confidence_last_recomputed_at`). A pinned Neuron
  never decays, never drops below the chat/visibility thresholds, regardless of age.
- A pin/unpin endpoint (`PATCH …/neurons/:id/pin`) flips the flag and records a
  `curator-pin` row in `confidence_signals` as an **audit trail** (who/when) — the
  enum value stays, but it no longer drives the score.
- Unpinning returns the Neuron to the normal formula on the next decay pass.

Precedent: **F139** already takes `pinned` to override heuristic decay
(commit `e319d33`); F182.8 generalises that override to all Neuron types.

The pin/unpin *button* lives in the reader confidence-chip (F182.6) and the Memory
Health tab (F182.7); F182.8 ships the backend primitive (column + endpoint +
decay-job exemption + verify) those UIs call.

## Status

**Phase 1 shipped (F182.1–F182.4), Phase 2 in progress.** F-number reserved + interim plan-doc captured 2026-05-05 per CLAUDE.md hard rule. Implementation date: TBD by Christian.

The architectural shape is clear, but the formula tuning will require ground-truth queries against a real KB to validate. Sanne's KB once populated is the ideal first test bed.

---

_Plan-doc derived from [docs/thinking/LLM-WIKI-V2-CROSSCHECK.md](../thinking/LLM-WIKI-V2-CROSSCHECK.md) — 2026-05-05 trail-research session._