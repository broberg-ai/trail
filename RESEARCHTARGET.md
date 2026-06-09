---
# Machine-readable header — the Research Adapter worker reads this to ROUTE + PRE-FILTER
# (same "YAML tokens + prose" spirit as the canonical buddy example). The prose below is
# what THIS repo's cc session reads when it receives a research task, so it can judge fit fast.
slug: trail
name: Trail — AI-native multi-tenant knowledge base (compile-at-ingest Neurons + grounded RAG chat)
stack: [bun, hono, libsql, bun-sqlite, drizzle, zod, vite, preact, tailwind-v4, mcp-sdk, broberg-ai-sdk, litestream, tigris, fly]
research_interests:
  - rag-retrieval-augmented-generation
  - knowledge-base-architecture
  - llm-memory-systems            # confidence, decay, supersession (F182/F195)
  - compile-at-ingest             # curated Neurons vs verbatim store
  - embeddings-semantic-search
  - ingestion-pipelines           # chunking, doc parsing, PDF/DOCX/vision
  - multi-tenant-saas-architecture
  - llm-cost-optimization         # cheaper providers, migrating off Anthropic in cloud
  - mcp-patterns
  - grounded-chat-citations       # answer-with-sources, hallucination control
not_interested:
  - frontend-marketing-design     # landing is content via webhouse.app CMS — not Trail's research
  - e-commerce-payments
  - iot-device-hardware
  - game-dev
landing_path: docs/research/
---

# Trail — Research Target

> You (Trail's cc session) just received a **research task**: an article aimed at Trail.
> Read this to orient WITHOUT spending startup tokens, then judge the article against Trail
> and land your research per "How to land your research" below.

## What I am
An **AI-native, multi-tenant knowledge base**. Dropped sources (docs, books, articles, images, chat) are **compiled at ingest into curated "Neurons"** (wiki-shaped knowledge) — not stored verbatim — a curator approves candidates from a queue, and an LLM chat answers **grounded in the Neurons with citations**. One tenant = one organisation; each tenant has its own `trail.db`.

## What I do
- **Compile-at-ingest**: turn a source into Neurons (dedup against existing, glossary, overview, source-inferer) rather than dumping raw text.
- **Grounded RAG chat** over the KB (per-tenant persona, e.g. "Eir") with citations.
- **Memory lifecycle**: per-Neuron confidence, supersession, optional per-Trail retention decay (F182/F195).
- **Multi-tenant fleet**: one admin (`app.trailmem.com`) + stateless engine fleet, per-tenant DB, membership-gated access.
- **Local Ingest Station** ($0 Max-plan compile via an interactive cc session) + connectors + a unified ingest queue.

## Stack
Bun · Hono · libSQL / `bun:sqlite` + Drizzle · Zod · Vite + Preact dashboard (Tailwind v4) · `@modelcontextprotocol/sdk` (Trail exposes an MCP) · `@broberg/ai-sdk` (discrete LLM layer) · Litestream → Tigris · Fly.io (region `arn`, org `broberg-ai`).

## Key concepts (where an idea would plug in)
- **Neuron / candidate queue** — compile → pending candidate → curator approve → Neuron.
- **Confidence + decay** — `recency × sourceStrength × (1−contradiction) + reinforcement`; per-Trail opt-in (F195). Staleness = **supersession, not age**.
- **Ingest pipeline** — chunking strategies, vision (image description), glossary backfill, contradiction-lint.
- **Connectors** (F95) — ingestion attribution (`mcp:claude-code`, `buddy`, `upload`, `chat`, …).
- **Topology** — engine / admin / `control.db` tenant routing; one `trail.db` per tenant.

## Research interests — judge the article against THESE
RAG · knowledge-base architecture · LLM memory (confidence / decay / supersession) · compile-at-ingest vs verbatim · embeddings & semantic search · ingestion + document parsing (incl. vision) · multi-tenant SaaS · LLM cost optimization & provider migration · MCP patterns · grounded chat with citations.
**NOT relevant:** marketing / frontend design, e-commerce, IoT / hardware, game-dev — route those elsewhere.

## Current focus (timely research lands best here)
- **Memory lifecycle** (F182 / F195) — supersession-driven staleness, per-Trail opt-in decay, reinforcement signals.
- **Cloud cost migration OFF Anthropic** — cheaper providers via `@broberg/ai-sdk`; cloud is **paid-API only** (post-15-June `claude -p` is dead in cloud).
- **Local Ingest Station** ($0 Max-plan compile) + connectors + unified ingest-queue panel (F191 / F192).
- **Deploy-observe self-report** (F196).

## Hard constraints (any adopted idea MUST respect these)
- **Cloud LLM goes through `@broberg/ai-sdk`** — never raw provider calls; cloud is **paid-API only**, never `claude -p`. The $0 path lives ONLY in the local Ingest Station.
- **Multi-tenant isolation is sacred** — per-tenant `trail.db`, membership-gated access; never a cross-tenant leak.
- No native dialogs / controls; no hardcoded values (one source, trickle down); every button gives feedback.
- Region `arn`, org `broberg-ai` — never elsewhere.
- **Staleness = supersession, not age** (F195) — don't adopt pure time-decay of knowledge.
- Dogfood: durable decisions land as Neurons under `/neurons/sessions/trail/`.

## How to land your research
Write `docs/research/<slug>.md` in THIS repo via the cardmem landing tool. The doc must answer:
1. **TL;DR** — the article in 2–3 lines.
2. **Relevance to Trail** — which concept/organ above it touches + fit strength (high / med / low) and why.
3. **Adaptation** — concretely how the idea could land in Trail's stack (real files/concepts), respecting the Hard constraints.
4. **Next step** — a suggested card / experiment (or "file-and-forget" if low fit). This is the SDLC hand-off into the board.
