# LLM Wiki v2 (Rohit Ganapathy) — cross-check vs Trail's existing F-numbers

**Source:** Rohit Ganapathy (rohitg00), *LLM Wiki v2 — extending Karpathy's LLM Wiki pattern with lessons from building agentmemory*, GitHub gist forked from karpathy/llm-wiki.md, ~3 weeks old at read date. 1,096 stars, 157 forks, 29 comments.

**Read date:** 2026-05-05 by trail-research session.

**Companion read:** *Why every enterprise needs an AI knowledge layer* (Sudhir Hasbe, Neo4j blog, April 2026) — vendor pitch but useful market-validation: Gartner names knowledge graphs as pillar #1 for deriving AI value, Cornell paper shows 3x accuracy improvement on Q&A grounded in KG vs SQL alone.

## TL;DR

Rohit's v2 doc is the **most actionable research input we've read so far**. Where Wang/Liu/Mark Chen elaborated Karpathy's gist, Rohit lists nine concrete extensions that he learned running the pattern in production via [agentmemory](https://github.com/rohitg00/agentmemory). Some are already in Trail. Several are genuine net-new architectural gaps.

Important reality check: the **gnusupport critique in comments** is correct that the v2 doc is "great direction, terrible blueprint" — many specific implementation details ARE missing (confidence formula, fusion strategy, latency targets, etc). When we draft Trail's version of these features, we have to do the engineering Rohit didn't. That's reflected in the plan-docs as explicit open-questions blocks.

## The nine v2 themes mapped to Trail

| # | v2 theme | Trail status | F-number(s) | Verdict |
|---|---|---|---|---|
| 1 | Memory lifecycle (confidence, supersession, forgetting) | Partial | F19, F139, F158 | **Net-new: F182** |
| 2 | Consolidation tiers (working/episodic/semantic/procedural) | Not present | — | **Net-new: F183** |
| 3 | Knowledge graph (entity extraction + typed relationships) | Edges only | F137 | **Net-new: F184** |
| 4 | Graph traversal queries | Render-only | F99 | **Folded into F184** |
| 5 | Hybrid search (BM25 + vector + graph + RRF) | FTS5 only | F10 | **Net-new: F185** (deferred) |
| 6 | Event-driven automation hooks | Mostly covered | F143, F32/F118/F158, F181 | **Existing** (mostly) |
| 7 | Quality scoring + self-healing + auto-resolution | Detect-only | F19, F32/F118/F158, F113, F148 | **Extension to F113** |
| 8 | Multi-agent collaboration (mesh sync, scoping) | Multi-tenant only | F33, F40.x | Deferred — out of scope today |
| 9 | Privacy filter on ingest (PII, secrets) | Not present | — | **Net-new: F187** |
| 10 | Crystallization (auto-distill threads → digest) | Partial | F39, F105, F112 | **Folded into F181 Routines** |
| 11 | Output formats beyond markdown | Not present | — | Out of scope — most users want markdown |
| 12 | Schema as the real product | Done | F140 | **Existing** |
| 13 | Audit trail | Done | F97 | **Existing** |
| 14 | Work coordination | Done | F138 | **Existing** |

## What we already cover (don't re-feature)

- **Schema-driven knowledge work** — F140 hierarchical `_schema.md` per-path. Rohit's "the schema is the most important file" claim already lives at the architecture level.
- **Audit trail** — F97 `activity_log` table + admin timeline panel.
- **Work coordination** — F138 Work Layer (Tasks/Bugs/Milestones/Decisions Kanban).
- **Event-driven hooks (most of them)** — F143 ingest queue, F32/F118/F158 lint scheduler, F181 Trail Routines (just filed today). Specifically:
  - "On new source": F143 + F06 ingest pipeline ✓
  - "On memory write" (contradiction trigger): F32/F118/F158 ✓
  - "On schedule" (lint, consolidation, retention): F32/F118 + F176 + F181 ✓
  - "On query" (file back): F105 chat-save ✓
  - "On session end" (compress to observations): F39 partial — could be F183 promotion mechanism
  - "On session start" (load relevant context): not really — but Trail isn't an agent runtime, this is the agent's job
- **Typed edges** — F137 `wiki_backlinks.edge_type` with 7 types (`cites, is-a, part-of, contradicts, supersedes, example-of, caused-by`).
- **Heuristic decay** — F139 implements Ebbinghaus-style decay (1.0→0.1 over 365d) for `/neurons/heuristics/` Neurons specifically.
- **Confidence on candidates** — F19 auto-approval policy.
- **Reader-side notes** — F112 User Notes / Your Take.

## What is genuinely net-new — three plan-docs

After cross-check, three high-leverage features from v2 are not adequately covered today and warrant their own F-numbers.

### F182 — Memory Lifecycle: confidence scoring + supersession + retention decay

**Gap:** Trail today treats all wiki content as equally valid forever. F19 has confidence on candidates (write-time gate); F139 has decay on `/neurons/heuristics/` only; F158 has contradiction detection but doesn't auto-resolve. There's no per-fact confidence on EVERY claim, no auto-supersession when contradictions are resolved, no retention curve on regular Neurons.

**Net-new:** Per-claim confidence (source-count + recency + contradiction-count), explicit supersession with version preservation, Ebbinghaus retention extended from heuristics to all Neurons (different decay rates per type per F101).

**Why this is the most important** of the three: every other v2 feature assumes lifecycle exists. Without it, Trail KBs eventually rot — which is exactly what Rohit warned about and exactly what the Wang/Luhmann landing post promised we'd avoid.

### F183 — Consolidation Tiers: working / episodic / semantic / procedural

**Gap:** Rohit's four-tier memory model maps cleanly onto Trail's existing path-conventions but isn't formalized. F39 captures session-end Neurons (~episodic), F101 has `synthesis` type (~semantic), F139 has heuristics path (~procedural). There's no "working memory" path for raw observations awaiting promotion, and no auto-promotion mechanism between tiers.

**Net-new:** New `/neurons/working/` path, promotion mechanism that runs scheduled (or on-event) and moves observations up the tiers as evidence accumulates. Working → episodic on session-end. Episodic → semantic when N similar observations cluster. Semantic → procedural when a pattern repeats.

**Why this matters:** Without consolidation tiers, all observations live forever as flat Neurons and the KB's signal-to-noise ratio degrades over time. The four-tier model is exactly the cognitive-science-grounded solution that human memory uses.

### F184 — Entity Layer + Knowledge Graph Queries

**Gap:** Trail today has typed edges (F137) between Neurons but no first-class entity layer. "React" exists only as a wikilink target with possibly several Neurons mentioning it. There's no canonical "React-the-library" entity with attributes (latest-version, owner, depends-on-list) and no way to query "what depends on React?" via graph traversal.

**Net-new:** New `entities` table (id, type, canonical_name, attributes JSON, primary_neuron_id), entity-extraction step in F06 ingest pipeline, entity-aware F89 chat tools that traverse the graph rather than just reading Neurons, and bidirectional entity-Neuron references.

**Why this matters:** This is the Neo4j knowledge-graph-pillar play in miniature. The Cornell paper says 3x accuracy on Q&A from KG-grounded queries vs raw text. For Trail to genuinely be "compile-time intelligence," entities are the unit that lets us answer relationship-questions ("what's the impact of upgrading X?") instead of just "show me everything mentioning X."

## Other v2 features — deferred or out-of-scope

### F185 — Hybrid Search with RRF (deferred)

Vector layer + RRF fusion (BM25 + vector + graph) is the right answer for scaling past ~5K Neurons per KB. But Trail's current sweet-spot is 100-2000 Neurons. F10 FTS5 covers that comfortably. **Reserved as F185 in roadmap, plan-doc deferred until tenant scale demands it.**

### F186 — Crystallization (folded into F181)

Auto-distillation of completed work-threads into digest Neurons is exactly the kind of thing F181 Trail Routines is designed to express. A user-authored Routine can declare: "every Friday, find Neurons tagged `#research-thread` with status:closed, synthesise into a `weekly-digest-{date}` Neuron." No new F-number; ships as a Routine template once F181 lands.

### F187 — Pre-ingest PII Filter (small, reserved)

Strip API keys / credentials / PII before content hits a Neuron. Important for clinical-grade tenants (Sanne's HIPAA-equivalent) and enterprise deals. Smallish (1-2 days). **Reserved as F187, plan-doc to write when first actually-blocked tenant requires it.**

### F188 — Output formats beyond markdown (rejected)

Comparison tables, timelines, slide decks. Most Trail users want markdown. The Reader (F31) renders structured pages well already. Add this when a tenant explicitly asks for it — until then YAGNI.

### F189 — Self-healing lint extensions (folded into F113/F148)

F113 fact-checker proposes fixes; F148 link-integrity auto-fixes on bilingual-fold matches. Extend existing F-numbers rather than create a new one. The auto-resolve-on-contradiction part folds into F182's supersession logic.

### Multi-agent mesh sync — out of scope today

Trail is multi-tenant (each tenant gets its own DB) but not multi-agent within a tenant. The use-case Rohit names ("multiple coding sessions writing to same wiki") doesn't apply to Trail today — Sanne is a solo user, and even Business+ tenants run with ~1 curator + N readers. Revisit when a real customer needs simultaneous-writer support.

## Honest assessment of the Rohit v2 critique (gnusupport's comment)

The skeptical comment in the gist is worth quoting in full as a reality-check on what we'd actually build:

> "Confidence scoring" is never defined — float? enum? who computes it? how does it update?
> "Auto-crystallize sessions into knowledge" is pure magic — no extraction algorithm, no dedup, no trigger condition
> 582 nodes is tiny — that's not a knowledge graph, that's a Tuesday afternoon
> Hybrid search has no fusion strategy — BM25 + vectors + graph just means three slow things bolted together
> No latency targets — 100ms? 10 seconds? who knows?
> No accuracy metrics — NDCG? MRR? nothing
> ...
> No backup or recovery strategy — corruption = game over
> No evaluation framework — how do you know if it worked?
> LLMs are treated as reliable — they'll silently corrupt the graph and you'll never know
> ...
> Great direction, terrible blueprint. Don't build from this. Steal the ideas, not the plan.

This is exactly right. Trail's plan-docs need explicit answers for: confidence formula (we'll propose source-count × recency-decay × (1 - contradiction-counter), normalized), fusion strategy for hybrid search (RRF with k=60), latency budget (per-operation), accuracy evaluation (held-out test queries with NDCG@10 + MRR), and LLM-failure handling (queue-mediated writes per F17 + F19 + F106 — already in place).

The v2 doc is "stealing ideas" gold. The implementation is on us.

## Marketing-relevant observations

Rohit's closing line — "**The Memex is finally buildable. Not because we have better documents or better search, but because we have librarians that actually do the work.**" — is the cleanest one-line distillation of Trail's value prop we've seen yet. Worth quoting in the next landing post (or reusing in trailmem.com homepage copy if Christian wants a refresh).

The four-tier memory model (working/episodic/semantic/procedural) is also borrowed from cognitive science (Tulving, Squire, Anderson). If F183 lands, it'd be the first time a hosted SaaS productizes the cognitive-memory-model. That's a marketing angle for a future landing post: *"Why Trail's memory looks like your brain's"*.

## Verdict

Three plan-docs to write this turn:

1. **F182 — Memory Lifecycle** (confidence + supersession + retention)
2. **F183 — Consolidation Tiers** (working / episodic / semantic / procedural)
3. **F184 — Entity Layer + Knowledge Graph Queries**

Three more F-numbers reserved as roadmap-stubs (no plan-doc — flag explicitly, write later when prioritized):

- F185 — Hybrid Search with RRF (deferred until 5K-Neuron scale)
- F187 — Pre-ingest PII Filter (deferred until enterprise tenant needs it)
- (F188/F189 explicitly rejected as separate F-numbers — fold into existing or skip)

Rohit's v2 is the strongest research input we've cross-checked since starting this audit. Three of his nine themes are gaps we should close. The other six are either covered, folded, or deferred.

---

_Note saved 2026-05-05 by trail-research session. Source PDF in [docs/research/v2/](../research/v2/) — primary content is the `llm-wiki.md` raw file in v2/llm-wiki-v2/, the PDF is a screenshot of the gist with comments._
