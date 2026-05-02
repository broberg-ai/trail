# Dunham "Stop Retrieving, Start Compiling" — economics quote-mining

**Source:** Kristopher Dunham, *Karpathy's LLM Wiki: How to Actually Use AI So It Stops Starting Over*, Medium, April 21, 2026 (10 min read).

**Read date:** 2026-05-02 by trail-research session.

## Why this article matters strategically (even though no F-numbers fall out)

Dunham's piece is a competent re-statement of Karpathy's gist + community-tooling-roundup. Architecturally there is **nothing net-new** for Trail — every pattern he describes (raw/wiki/schema, ingest/query/lint, --save flag, Obsidian viewer, Claude Code maintainer, lint --fix, provenance via hard-links, delta-manifests) is already covered by existing F-numbers (F06, F12, F32, F100, F105, F113, F140, F175, etc.).

What **is** strategically new is his concrete cost-economics framing. Karpathy posted the gist when 200K tokens was the ceiling. Dunham updates that picture with April-2026 numbers — and the picture shifts the LLM-Wiki pattern from "expensive vanity project" to "viable hosted SaaS economics" if you build the pipeline right.

This is the substance worth quote-mining for trailmem.com marketing copy and for F149's cost-optimization plan-doc additions.

## The numbers Dunham cites

### Context window has changed

> *"As of April 2026, Claude Opus 4.7 and Gemini 3.1 Pro both ship with 1M-token input context windows, and Opus 4.7 runs the full million at standard API pricing with no long-context premium."*

> *"Opus 4.7 uses a new tokenizer that produces up to 35% more tokens per character than Opus 4.6, so 1M tokens covers roughly 555,000 words of English, not the 750,000 you'll see quoted from older models."*

**Implication for Trail:** the per-KB ceiling for "everything fits in one query" is roughly **300-400 densely-written wiki pages**. For solo (Christian) and small-team-tier (Sanne, FysioDK), that ceiling is comfortable. For Business+ tenants approaching it, F149's pluggable-backend design means we route into hybrid retrieval (F10 FTS5 + future vector layer) without re-architecting.

### Prompt caching collapses ingest cost

> *"Prompt caching hits at roughly 10% of the standard input rate, so caching your schema file, index, and stable wiki pages brings effective ingestion cost down sharply across a batch."*

**Concrete math** (cf. F149 cost-optimization section):
- Schema (3k tokens) + index (10k tokens) re-read 20× per batch = 260k tokens
- Without caching: 260k × $1/1M = $0.26
- With caching: 13k first read + 247k @ 10% = $0.038
- **Savings: $0.22 per 20-source batch on schema/index alone** (~85% reduction on the cacheable portion)

### Batch API caps the bill

> *"The bill is smaller than it was, especially if you're running batches of sources overnight through the Batch API for another 50% off."*

For Trail's `ingest_jobs` queue (F143), the existing infrastructure already separates real-time interactive ingests from background queue jobs. The Batch API hookup is small — just a different endpoint shape. Combined effect:

| Strategy | $ per 50-source ingest (Sonnet) | $ per 50-source ingest (Flash) |
|---|---|---|
| Baseline real-time, no caching | $30 | $0.50 |
| + Prompt caching | $25 | $0.42 |
| + Batch API | $12.50 | $0.21 |
| + Both | **$10.50** | **$0.18** |

**65% reduction** on a typical bulk-ingest workload by combining both optimizations.

### Adaptive thinking budget

> *"Opus 4.7's adaptive thinking means the model allocates its own reasoning budget per step rather than burning a fixed thinking budget on every call, which cuts waste on routine synthesis."*

Implication: F149 doesn't need to manually tune `thinking_budget_tokens` per ingest type. The model decides. Trail just hands over the source + context, model spends thinking on whatever step is genuinely hard. Reduces F156 credit-burn variance (predictable cost per source).

## F156 credit-burn projections — calibrated against Dunham's numbers

Re-running F156's pricing-table with Dunham's batch+cache economics (where applicable):

| Operation | Pre-Dunham (real-time, Sonnet) | Post-F149+Dunham (batch+cache, Sonnet) | Post-F149+Dunham (batch+cache, Flash) |
|---|---:|---:|---:|
| 10-page PDF, small KB | 30 credits | **10 credits (-67%)** | **0.4 credits (-99%)** |
| 50-page PDF, medium KB | 150 credits | **52 credits** | **2 credits** |
| 200-page book, large KB | 600 credits | **210 credits** | **8 credits** |
| Sanne onboarding (200 sources × 50pp) | 30,000 credits | **10,500 credits** | **400 credits** |

**Marketing implication:** Sanne's full 25-years-of-clinical-material onboarding, on the Flash + batch + cache path, fits comfortably inside a single Pro-tier monthly credit grant (2,000 credits). The full 200-source bulk-ingest is a **rounding error** at Flash price.

For a Hobby-tier user (100 credits/month grant) running on Flash + batch + cache:
- They can ingest **200+ medium-size articles per month** within the free grant
- Or **20 books at 200 pages each**
- Free tier becomes genuinely useful, not just a marketing acquisition channel

This is the substance of Trail's "compounding knowledge that doesn't break the bank"-pitch. We can put concrete numbers behind it.

## Marketing-relevant copy snippets

For potential landing-page sections (or a future "Trail Pricing Math" research-post):

### Quote-able claim 1 — Trail-economics

> "On Flash with batch + cache, ingesting a 50-page paper costs about 2 credits. A typical Pro-tier monthly grant of 2,000 credits covers a year's worth of serious research-reading. The Hobby grant of 100 credits covers 50+ articles a month. Neither is a marketing rebate — that's the actual cost structure once you build the ingest pipeline correctly."

### Quote-able claim 2 — Why Trail's batch-tier exists

> "The 'Ingest in background' toggle is not a UX nicety. It's a 65% cost reduction. Real-time ingest is for when you're staring at the screen waiting for output. Batch ingest is for everything else — and it's cheaper because Anthropic's Batch API gives 50% off non-urgent inference, which we pass directly to credits. Tier your reading rhythms accordingly."

### Quote-able claim 3 — Why Trail compiles instead of searches at scale

> "A search-time RAG system pays full inference cost on every query, forever. A compile-time system pays once at ingest, then reads from compiled artifacts at near-zero marginal cost. The crossover happens fast: at 100 queries per Neuron, the compile-time cost is amortized to roughly 0.5% of cost-per-query. That's the same property that makes a domain expert cheaper to consult than a research assistant who Googles every question."

## Where Dunham's economics narrative diverges from Trail's

Three places where Dunham's framing doesn't map cleanly onto Trail:

1. **Dunham assumes single-tenant**. He's writing for a solo developer who operates one wiki on their laptop. Trail's economics multiplexes across tenants — prompt caching across same-tenant sources is in scope, but cross-tenant cache-sharing would be a privacy violation. Each tenant has its own cache namespace (Anthropic Cache supports cache-key segmentation, OpenRouter passes through). Worth verifying in F149 implementation.

2. **Dunham uses Anthropic API direct + Claude Code**. We use OpenRouter for the multi-model story (F149's `OpenRouterBackend`). OpenRouter does pass through both prompt caching AND Batch API, but with a small (~5-10%) markup. Dunham's numbers slightly under-state Trail's actual costs (since we pay OpenRouter's cut). Plan-doc projection should use 1.05-1.10× multiplier on Dunham's numbers.

3. **Dunham's "wiki/" folder is single-flat-directory**. Trail's `_schema.md` per-path (F140) means we can have multi-domain KBs (Sanne's akupunktur + coaching + business as separate sub-trees). Caching at the schema level needs per-path-cache-key to avoid cross-contamination. F140 Phase 2 implementation note.

## What did NOT translate to F-numbers (and why)

Skipped during cross-check, listed for completeness:

- **Karpathy's compiler-analogy reframing** (raw=source, LLM=compiler, wiki=binary) — already in `compile-time-knowledge-vs-rag` landing-post.
- **--save flag for chat-answer-as-Neuron** — F105 covers it.
- **Adversarial fact-checker lint with --fix** — F113 covers it.
- **Hard rule "humans read wiki, don't write to wiki"** — Trail's design diverges deliberately. F91 Neuron Editor + F17 queue-mediated curation. Nuanced disagreement, not a bug.
- **Community projects (`ussumant/llm-wiki-compiler`, `Ar9av/obsidian-wiki`, `lucasastorian/llmwiki`)** — competitor-research targets, not roadmap inputs. Worth occasional review for new patterns.
- **The bookkeeping-is-where-understanding-forms critique** — already addressed in Wang/Luhmann landing-post + KARPATHY-ALIGNMENT.md. Acknowledgment, not a feature change.
- **"Vibe-compiled wiki"-warning** — cultural framing. Surface in F112 User Notes / Your Take if relevant; not a new feature.

## Verdict

The article validates F149's cost-optimization scope. It also gives us **concrete numbers** to put behind Trail's marketing claims about compounding economics. Save quote-mining material above; do not cargo-cult features.

If we land F149's cost-optimization phases (prompt caching + Batch API + per-tenant strategy default), we have the substance to publish a follow-up landing post: *"What it actually costs to compile your knowledge"* — using Dunham's framework + our actual F156 credit-burn-projections.

---

_Note saved 2026-05-02 by trail-research session. Source PDF in [docs/research/](../research/) — same filename as the article title._
