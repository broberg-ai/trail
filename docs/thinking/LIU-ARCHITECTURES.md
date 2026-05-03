# Liu "RAG, LLM Wiki, or GBrain" — three-architectures cross-check

**Source:** Yanli Liu, *RAG, LLM Wiki, or GBrain? How Your Agent Remembers Changes Everything*, AI Advances on Medium, April 27, 2026 (15 min read, 903 claps, ~6 days old at read date).

**Read date:** 2026-05-03 by trail-research session.

## TL;DR

Liu's article is a **decision-framework piece**, not an implementation tutorial. She frames three architectures as solving different versions of the same problem ("how does an agent remember?"):

| Architecture | Verb | Scale | Setup | Compounds? | Acts? |
|---|---|---|---|---|---|
| RAG | Retrieve | 200K+ docs | weekend | No | No — waits |
| LLM Wiki (Karpathy) | Compile | ~1K sources | weeks | Yes — wiki refines | No — waits |
| Fat Skills (GBrain / Garry Tan) | Act | 17K+ pages | months | Partial — logs | **Yes — 21 cron jobs** |

Her closing thesis: production systems will converge — the three architectures are merging into "a single knowledge operating system that does all three." Karpathy's CLAUDE.md = mini-wiki, auto-memory = compounding, Claude Code skills = action.

For Trail's positioning, this is **the most useful article we've read so far**. Better than Wang/Dunham/Mark Chen because it doesn't just elaborate Karpathy's gist — it places the LLM Wiki pattern in a broader landscape with explicit trade-offs.

## What Trail already covers (no F-number needed)

The RAG/Wiki dichotomy is well-trodden ground for us. Liu's "three RAG failure modes" map directly to existing Trail design choices:

| Liu's RAG failure | Trail's answer |
|---|---|
| Chunking — fragments destroy relationships | Compile-time synthesis preserves whole-document understanding (F06 ingest pipeline) |
| Re-derivation — every query starts from scratch | F12/F89 chat reads from compiled wiki, not raw chunks |
| Passivity — won't flag contradictions | F32/F118/F158 contradiction-lint scheduler |

Her "LLM Wiki three-layer architecture" (raw / wiki / schema) is exactly Trail's existing model:
- Raw layer: F95 sources + connector attribution
- Wiki layer: F101-typed Neurons in `/neurons/...`
- Schema layer: F140 hierarchical `_schema.md` per-path

The "lint workflow" she mentions (orphan detection, stale claims, contradictions) maps to F113 fact-checker + F118 stale-detector + F32/F158 contradiction-lint. Already shipped.

The "every ingest touches 10-15 wiki pages" cross-reference compounding: that's exactly what F148 link-integrity + the ingest cross-reference prompts produce today.

## What is genuinely net-new — the Fat Skills / GBrain pattern

The one architectural dimension Trail has **no answer for** today is the **action layer** Liu describes:

- **User-defined fat skills** as markdown files with frontmatter declaring `triggers`, `tools`, `writes_to`, `mutating: bool`
- **Cron scheduler** firing skills on intervals (5-min staggered, quiet hours, idempotent)
- **Deterministic + latent split** — skill calls SQL/API for repeatable parts, LLM for synthesis parts
- **RESOLVER.md routing** — user intent matched to skill via skill descriptions (no explicit routing code)
- **Always-on layer** — skills that fire on every inbound message (signal-detector pattern)

**Existing Trail building blocks that are close but not the same:**

| Trail today | GBrain pattern | Gap |
|---|---|---|
| F32/F118/F158 lint-scheduler | Cron jobs | Ours is **system-defined** (lint only), not **user-defined** workflows |
| F143 ingest queue (priority + scheduledAt) | Cron-fired jobs | Ours is **reactive** (responds to candidates), not **proactive** (fires on schedule) |
| F79 scheduled re-compile (90d cadence) | Skills running themselves | Ours is **single-purpose** (re-compile), not **arbitrary user-defined work** |
| F176 per-KB lint schedule | Per-skill schedule | Same idea but lint-only, not extensible to other workflows |

**No F-number exists for "Trail Routines" / "user-defined scheduled KB workflows."** This is the genuine gap.

## What "Trail Routines" would look like (rough sketch — NOT a plan-doc)

Concrete user stories that would justify it:

- *Sanne*: "Hver mandag morgen, sammenfat alle nye Neurons jeg har tilføjet sidste uge til en `weekly-brief-{date}.md` Neuron tagged `#mondaybrief`."
- *Christian*: "Hver dag kl. 09:00, scan kontraktklausuler for nye 'force majeure' references og emit til reader-feedback-queue."
- *Journalist*: "Hver fredag, find Neurons tagged `#lead` der er ældre end 14 dage og endnu ikke citerer en peer-Neuron — surface som candidates for follow-up."

Architectural fit (without breaking the basic vision):

1. **Routines emit to F143 queue, never write directly to wiki.** Same ergonomics as ingest — F19 confidence-policy + F106 Solo Mode govern auto-approval. Curator stays in control.
2. **Routine-files live in `/routines/` per KB** as markdown with frontmatter (mirrors F140 `_schema.md` pattern). Editable via admin Routines tab.
3. **Deterministic + latent split** — routine declares an FTS5/SQL query (the "find" step) + an LLM prompt (the "synthesize" step). Reuses F89 chat-prompt scaffolding.
4. **Scheduler reuses F32/F118/F158/F79 infrastructure** — `routine-scheduler.ts` mirrors `lint-scheduler.ts`. Per-routine `lastRunAt` + `nextRunAt`. Quiet-hours support.
5. **Cost-controlled by F156 credits + F149 model-selector** — Hobby tier defaults to Flash + batch (cheap), Pro tier can opt into Sonnet for routines that need more synthesis quality.

**Estimated effort:** 5-10 days. Comparable to F138 Work Layer's 3-4 day estimate when it was deferred — Routines is bigger because it needs UI, scheduler, queue integration, AND user-facing skill-authoring affordances.

## Should we write F180 plan-doc now?

**My recommendation: no. Defer.**

Steel-man for shipping:
- Real gap, vision-compatible (compile-layer KB extended into action layer via queue-mediated writes)
- Differentiator vs raw RAG products (they can retrieve but never act on KB content)
- Sticky engagement — users come back weekly to read their digest Neurons

Steel-man for waiting:
- Sanne hasn't asked for it. She needs Eir-chat polish + ingest reliability + better source-management UI before she needs scheduled workflows.
- Trail's pitch is "compile your knowledge, query it forever cheap." Adding scheduled-action-layer changes the pitch from "knowledge base" to "knowledge automation platform" — different SaaS category, different go-to-market.
- The GBrain pattern is heavily tied to YC deal-flow workflows. Most Trail tenants don't have that level of recurring deterministic operations.
- Karpathy's original gist deliberately put the wiki layer as **passive**. The community is adding action-layers, but the core value-prop of compile-time knowledge doesn't require it.
- We just shipped F174-F179 plan-docs in one day. The plan-doc backlog is fine; it's the implementation backlog that's the bottleneck.

**Put F180 on the post-Sanne-launch roadmap.** Reserve the F-number now in a one-line ROADMAP.md "Idea" entry pointing here — but don't write the full plan-doc until the basic compile-and-query path is rock-solid for at least one paying tenant.

## Where this article DOES translate immediately

**Marketing landing post**, not feature.

The three-architectures framing (Retrieve / Compile / Act) is the cleanest positioning lens we've seen for Trail. A landing post titled e.g. *"Three architectures of agent memory — and why Trail picked Compile"* would:

1. Establish Trail's lane vs RAG (we're not retrieve, we're compile — and that's why your hundredth query is better than your first)
2. Acknowledge the action-layer honestly (we don't ship cron-routines today, but our F143 queue + MCP server make Trail a **first-class persistent-memory backend** for any agent platform that needs one — including a self-built GBrain-style harness)
3. Frame the convergence — Trail aims to be the compile layer in a converged knowledge OS, not to replace retrieval at scale or to ship the act-layer in v1

This is the third article in a natural marketing trilogy:
- Wang/Luhmann post (already shipped 2026-05-02): "Compounding knowledge, not searched knowledge" — Zettelkasten frame
- Dunham economics post (drafted, not shipped): "What it actually costs to compile your knowledge" — economics frame
- **Liu architectures post (proposed)**: "Three architectures of agent memory" — landscape positioning frame

## Quote-mining for the Liu architectures post

> *"Both agree on the diagnosis: RAG alone isn't enough. Your agent re-reads the same documents for every question, never learning, never compounding. It's a retriever, not a thinker."*

Open with this for the lede. Establish the shared diagnosis before introducing Trail's specific answer.

> *"The chunking problem... [Liu's specific framing]: Your 30-page technical spec gets split into 500-token fragments. The chunk that mentions a compliance requirement lands in one vector. The chunk that explains why that requirement exists lands in another. The retriever finds one and misses the other. Your agent gives a technically correct but dangerously incomplete answer."*

This is the cleanest articulation of why Trail's compile-time approach matters for high-stakes domains (clinical, regulatory, contractual). Steal it for the "why compile beats retrieve at depth" section.

> *"The wiki uses markdown files navigated by BM25 or grep. That works beautifully at 100 sources generating a few hundred wiki pages. At 10,000 sources, the navigation breaks down. At 100,000, it's unusable without adding a retrieval layer on top — which starts to look like RAG again."*

**Honest acknowledgment for our post:** Trail today targets <5K Neurons per KB. F10 FTS5 + future vector layer (still Idea-stage) closes this. Don't oversell scale; pitch the depth + compounding instead.

> *"Production systems won't stay in a single lane. The most capable architectures will combine all three: RAG for the retrieval layer (finding relevant content at scale), Wiki for the synthesis layer (compiling retrieved content into persistent knowledge), and skills for the action layer (operationalizing that knowledge into autonomous workflows)."*

The convergence thesis is gold for our positioning. Use it to frame Trail as **the compile layer of a converged knowledge OS** — not as a competitor to RAG or to skills-platforms, but as the persistent-memory tissue that connects them. Hooks into the Trail-as-MCP-backend narrative naturally.

## Other observations worth keeping

### The "thin harness, fat skills" dichotomy

Liu cites GBrain's "harness ~200 lines of code, all intelligence in skills." Compare to Trail today: our `apps/server` is the harness (~10K LOC?), our skills are scattered between hard-coded `lint-scheduler.ts` / `ingest.ts` / `chat/build-prompt.ts`. The GBrain pattern of **"keep the runtime small, push intelligence into editable markdown files"** is interesting for our F140 `_schema.md` story — and could inform F180 if we get there.

### Idempotency as a first-class concern

> *"Cron jobs respect quiet hours (11 PM–8 AM by default), and enforce idempotency — running the same job twice produces identical results with no duplicate outputs."*

F158 already implements this for contradiction-lint via content-signature skip. Pattern is reusable for any future scheduled-workflow system. Worth flagging in a future F180 plan-doc as the design pattern.

### "Skill descriptions function as the resolver"

> *"The skill descriptions themselves function as the resolver. The model reads the descriptions and matches intent automatically. No explicit routing code needed."*

This is interesting for F89 chat — currently we route everything through one prompt. If we ever ship "Trail Skills," matching intent to skill via skill-descriptions (not explicit code) is the cheap path. Bookmark for F180.

### Postgres + pgvector backing

GBrain backs onto Postgres + pgvector for the latent (embeddings) layer + SQL for deterministic data. Trail today is SQLite + FTS5. If F10 vector-layer ever ships, sqlite-vec or libsql-vector are the lighter analogs that fit our per-tenant-DB architecture.

## Verdict

**Skip F180 plan-doc — for now.** The action-layer is real but premature. Focus on Sanne shipping.

**Write the Liu architectures landing post.** This is the most positioning-relevant article we've read; the three-way framing is reusable; the convergence thesis hooks Trail into the broader 2026 narrative. ~9 min read, 2 SVGs, status: published. Same shape as Luhmann post.

If Christian disagrees and wants F180 written: the rough sketch in section "What 'Trail Routines' would look like" is the starting skeleton. Promote to interim plan-doc with `## Open questions` block at top.

---

_Note saved 2026-05-03 by trail-research session. Source PDF in [docs/research/](../research/) — same filename as the article title._
