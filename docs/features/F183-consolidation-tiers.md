# F183 — Consolidation Tiers: working / episodic / semantic / procedural

> Trail today stores all observations as flat Neurons in `/neurons/<type>/`. Rohit Ganapathy's *LLM Wiki v2* names a four-tier memory model borrowed from cognitive science (Tulving, Squire): working memory (raw), episodic (session-summarised), semantic (cross-session-consolidated), procedural (workflows extracted from repeated semantics). Each tier is more compressed, more confident, and longer-lived than the one below. F183 introduces path-conventions and an auto-promotion mechanism that moves observations up the tiers as evidence accumulates. Tier: all. Effort: Medium-Large — 5-7 days for Phase 1+2. Status: Planned.

## Open questions (interim plan-doc)

This is an **interim plan-doc** written 2026-05-05 from Rohit Ganapathy's *LLM Wiki v2* gist. The four-tier model is conceptually elegant but several implementation choices are open:

1. **Promotion triggers — how does the LLM decide?** Proposal:
   - Working → episodic: end-of-session per F39, or scheduled "compress observations older than 24h"
   - Episodic → semantic: when N≥3 episodic Neurons cluster (similarity > 0.8 via embeddings) OR a curator-approved synthesis Neuron references them
   - Semantic → procedural: when a pattern appears in M≥5 semantic Neurons over T≥30d window
   - These thresholds are GUESSES. Calibration requires running on Sanne's actual KB.

2. **Demotion / forgetting — bidirectional or one-way?** Proposal: one-way promotion. F182 retention decay handles "forgetting" — a Neuron at any tier can decay to invisible without being demoted. Demotion would require provenance preservation (where did this come from before?) which adds complexity. Phase 1: one-way only.

3. **Path conventions vs. tier metadata?** Two options:
   - (a) Path-based — Neurons live in `/neurons/working/`, `/neurons/episodic/`, etc. Promotion = file move + rename.
   - (b) Metadata-based — Neuron type + new `tier` field. Path is for content topic, tier is orthogonal.
   
   Proposal: **(b) metadata-based**. Path is for topic organization (`/neurons/concepts/`, `/neurons/entities/`), tier is a property. Easier to query, easier to promote without breaking wikilinks. F101 type frontmatter already supports this pattern.

4. **Working-memory storage location.** Working memory is high-volume / low-confidence — should it live in `documents` table (same as the rest) or a separate `observations` table that gets garbage-collected on session-end? Proposal: same `documents` table with `tier='working'`, but with auto-archive after 7 days if not promoted. Simpler than maintaining two tables.

5. **Procedural memory — overlap with F139 heuristics?** F139 already has `/neurons/heuristics/` with decay. Procedural memory in v2 = "workflows and patterns extracted from repeated semantics." That IS heuristics. **F183 unifies: `tier='procedural'` is the metadata equivalent of the existing `/neurons/heuristics/` path-convention.** F139 stays compatible.

6. **Multi-session boundary detection.** Episodic = "session summaries." How do we detect session boundaries on Trail? F39 already captures Claude Code session ingests as one session. For human curator activity, "session" is fuzzier. Proposal: a session = continuous activity with no >2h gap, terminated explicitly by curator clicking "End session" (new UI affordance) OR auto-terminated on 8h idle.

These open questions are blocking neither the plan-doc nor the F-number.

## Motivation

Rohit's v2 framing:

> *"Raw observations aren't the same as established facts. Build a pipeline:*
> - *Working memory: recent observations, not yet processed*
> - *Episodic memory: session summaries, compressed from raw observations*
> - *Semantic memory: cross-session facts, consolidated from episodes*
> - *Procedural memory: workflows and patterns, extracted from repeated semantics*
>
> *Each tier is more compressed, more confident, and longer-lived than the one below it. The LLM promotes information up the tiers as evidence accumulates. This is how you go from 'I saw this once' to 'this is how things work.'"*

Trail today partially implements this without naming it:
- **F39** Claude Code session → Trail ingest captures session-end summaries (~episodic memory) but not as a distinct tier
- **F101** type frontmatter has `synthesis` (~semantic) and `session` (~episodic) types
- **F139** heuristics path-convention is procedural memory
- **F140** schema files describe domain rules (procedural at the meta-level)

What's missing:
- **Working memory tier** — a place for raw observations that haven't been processed yet
- **Auto-promotion mechanism** — F39 doesn't auto-promote episodic to semantic; F139 heuristics are hand-curated
- **Lifecycle uniformity** — each "tier" today is a different existing pattern with its own conventions

F183 unifies these into a coherent four-tier model with explicit promotion rules.

### Why now (vs deferred)

Without consolidation tiers:
- Sanne ingests 200 sources → 200 flat Neurons → finding "things I've learned across multiple patient cases" requires rereading every Neuron individually
- Routine patterns never get extracted into reusable heuristics
- The KB grows linearly with input volume; the SIGNAL doesn't compound

With consolidation:
- 200 raw observations → 30 episodic summaries → 8 semantic cross-session facts → 2 procedural patterns
- Most queries target the upper tiers; raw observations remain available for citation but don't dominate retrieval
- Signal-to-noise improves with KB age instead of degrading

Realistic priority: **Phase 2 post-Sanne-launch**, AFTER F182 lifecycle infrastructure lands. Tiers without confidence/decay are still useful but not as much.

## Scope

### In scope (Phase 1 + Phase 2)

- **`tier` column** on `documents` table (TEXT NOT NULL DEFAULT 'semantic') — values: `working`, `episodic`, `semantic`, `procedural`
- **Working-memory archiving** — Neurons with `tier='working'` and age > 7 days without promotion get auto-archived (status flips, doesn't delete)
- **Episodic promotion job** — F32-style scheduled job: at session-end (per F39 trigger or 8h idle), summarise `tier='working'` Neurons from session into a single `tier='episodic'` Neuron
- **Semantic promotion job** — scheduled clustering: episodic Neurons that match a similarity threshold (embedding cosine > 0.8) get an LLM-generated semantic synthesis Neuron with `tier='semantic'`
- **Procedural promotion job** — F183-driven extension of F139 heuristic-extraction: when M≥5 semantic Neurons share a pattern (LLM judgment), extract a procedural-tier Neuron
- **Tier-aware chat** — F89 chat-context-builder default-prefers higher tiers (procedural > semantic > episodic > working)
- **Tier-aware reader** — F99 graph nodes have tier-specific badge color/shape
- **Admin "Consolidation" tab** — shows tier distribution, lets curator approve/reject pending promotions, manually trigger consolidation
- **End-Session affordance** — UI button + API to terminate current session and trigger working→episodic promotion

### Non-goals (Phase 1 + Phase 2)

- Demotion (one-way promotion only)
- Cross-tenant tier sharing
- Per-claim tiering (a Neuron is one tier; claim-level is F182 Phase 3+)
- Auto-deletion of working-memory after archiving (curator opt-in only)
- Multi-agent collaboration on tier promotion (out of scope per F182 multi-agent decision)

## Architecture sketch

### Data model

Migration adds tier column:

```sql
ALTER TABLE documents ADD COLUMN tier TEXT NOT NULL DEFAULT 'semantic'
  CHECK (tier IN ('working', 'episodic', 'semantic', 'procedural'));
ALTER TABLE documents ADD COLUMN promoted_from_neuron_ids TEXT;  -- JSON array
ALTER TABLE documents ADD COLUMN promoted_at INTEGER;
CREATE INDEX idx_documents_tier ON documents(tier);
CREATE INDEX idx_documents_tier_created ON documents(tier, created_at) WHERE tier = 'working';
```

`promoted_from_neuron_ids` provides provenance: a semantic Neuron records which episodic Neurons fed it. Used by reader "What this is built from" panel.

### Promotion services

`apps/server/src/services/consolidation/`:

- `working-archive.ts` — runs daily, archives `tier='working'` Neurons older than 7d that haven't been promoted
- `episodic-promote.ts` — runs at session-end (event-driven) OR on 8h-idle (schedule), summarizes session's working Neurons into one episodic Neuron via LLM call
- `semantic-promote.ts` — runs nightly, clusters episodic Neurons by embedding similarity, emits semantic synthesis candidates to F143 queue (curator-approve gate)
- `procedural-promote.ts` — runs weekly, looks for repeated patterns across semantic Neurons via LLM judgment, emits procedural candidates

All promotion jobs:
- Cost-controlled per F156 + F149 + F179 — default Flash + batch-API for non-urgent paths
- Idempotent via F158 signature pattern (skip if input set unchanged)
- Emit candidates to F143 queue, never write directly (consistent with Trail's queue-mediation invariant)

### Tier-aware retrieval (F89 chat)

```ts
function buildChatContext(query: string, kb: KB): NeuronContext[] {
  const candidates = retrieveByEmbedding(query, kb, limit=20);
  // Boost by tier: procedural=1.5×, semantic=1.0×, episodic=0.7×, working=0.3×
  // Combined with F182 confidence: final_score = base × tier_boost × confidence
  return candidates
    .map(c => ({ ...c, score: c.baseScore * tierBoost(c.tier) * c.confidence }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}
```

### Reader integration (F99 graph)

Tier-specific node shape + color:
- `working` — small dashed circle, light grey
- `episodic` — solid circle, blue
- `semantic` — square, green (Trail brand)
- `procedural` — diamond, amber `#e8a87c`

Reader page header includes tier badge with hover-explain.

### Admin "Consolidation" tab (Phase 2)

`/admin/kb/:id/consolidation` route:
- Tier distribution (bar chart)
- "Pending promotions" list (semantic + procedural candidates awaiting approval)
- Manual triggers: "Run episodic promote now", "Run semantic clustering"
- Per-tier age-distribution histogram (lets curator spot tiers with too much/little aging)

### End-Session affordance

Frontend: button in admin header `[End Session]`. Calls API endpoint that:
1. Marks current session-id as terminated
2. Triggers `episodic-promote.ts` for that session-id
3. Returns the new episodic Neuron id when complete

Auto-trigger: 8h of no candidate-emit-from-this-session activity → auto-end-session.

## Dependencies

- **F182 Memory Lifecycle** — confidence + decay are prerequisites for tier-aware retrieval boosting; semantic-promote uses confidence to decide which episodic Neurons promote
- **F39** session ingest — episodic promotion hook fires here
- **F101** type frontmatter — already supports `session` + `synthesis` types; F183 adds tier as orthogonal axis
- **F139** heuristic decay — folds into procedural tier; existing `/neurons/heuristics/` path is grandfathered as `tier='procedural'`
- **F143** queue — semantic + procedural promotions emit candidates here
- **F19** auto-approval — governs whether promotions auto-publish
- **F106** Solo Mode — auto-approves promotions for solo users
- **F89** chat tools — tier-aware retrieval
- **F99** graph render — tier-aware visualization
- **F140** schema files — per-KB schema can specify which Neuron types should/shouldn't tier-up
- **F149** + **F179** model selection — promotions default to cheap Flash via batch
- **F156** credits — promotion runs cost credits

## Rollout phases

**Phase 1 — Foundation (3 days)**
- Migration: tier column + promoted_from_neuron_ids
- Working-archive job
- Episodic-promote job (session-end + idle triggers)
- Backfill: assign tier='semantic' to all existing Neurons except `/neurons/heuristics/` → 'procedural', `/neurons/sessions/` → 'episodic'
- Tier-aware F89 chat retrieval (basic boost factors, hardcoded)
- Verification script

**Phase 2 — Promotions + UI (2-3 days)**
- Semantic-promote (clustering + candidate emission)
- Procedural-promote (pattern extraction)
- Reader graph tier-shape rendering
- Admin Consolidation tab
- End-Session button

**Phase 3 — Tuning (post-shipping, scoped to one tenant)**
- Run on Sanne's KB for 4 weeks, measure SNR (semantic queries answered well / total)
- Tune promotion thresholds, decay-rate-by-tier, retrieval boost factors
- Document calibrated values in `docs/CONSOLIDATION-TUNING.md`

## Verification

`apps/server/scripts/verify-consolidation.ts`:

1. Create KB with 8 working-tier Neurons (5 from session-A, 3 from session-B)
2. Trigger session-A end → assert one episodic Neuron emitted with `promoted_from_neuron_ids` containing all 5 session-A working IDs
3. Trigger session-B end → assert second episodic Neuron emitted
4. Insert 3 more synthetic episodic Neurons with high-similarity embeddings
5. Trigger semantic-promote → assert one semantic candidate emitted to F143 queue
6. Approve candidate
7. Assert: semantic Neuron lands with `tier='semantic'`, has `promoted_from_neuron_ids` covering the 3 episodic Neurons
8. Run F89 chat retrieval against test query → assert semantic Neuron ranked above raw working Neurons in result set

## Effort estimate

Phase 1 + Phase 2 combined: **5-7 days**. Phase 3 tuning is open-ended (real KB usage required).

## Status

**Planned, deferred to post-F182 (post-Sanne Phase 2).** F-number reserved + interim plan-doc captured 2026-05-05.

The four-tier model is cognitive-science-grounded and architecturally clean. Implementation requires F182 lifecycle to land first (confidence + decay are prerequisites for tier-aware boosting). Once both ship, Trail will be the first hosted SaaS productizing the cognitive-memory-model — that's a marketing angle for a future landing post: *"Why Trail's memory looks like your brain's"*.

---

_Plan-doc derived from [docs/thinking/LLM-WIKI-V2-CROSSCHECK.md](../thinking/LLM-WIKI-V2-CROSSCHECK.md) — 2026-05-05 trail-research session._