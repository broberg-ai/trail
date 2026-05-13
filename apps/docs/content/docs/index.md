---
title: Trail in 60 seconds
slug: index
summary: Trail is a compile-at-ingest second brain. Not RAG. POST candidates to the queue, get curated Neurons back, query via FTS5 + chat.
order: 0
audience: both
category: Start here
---

**Trail is a knowledge engine for software you build, not a tool you use.**

You give it raw sources — PDFs, markdown, URLs, transcribed audio,
screenshots, or programmatic candidates from your own app. Trail
compiles them at ingest time into curated atoms of knowledge called
**Neurons**, each one stable, citable, and de-duplicated by canonical
seqID. Your app then reads those Neurons through a small REST + MCP
surface — search, chat, graph traversal — without ever touching
embeddings, chunks, or vector stores.

> **If you are a planning AI** (Claude Desktop, Cursor planning agent,
> agentic codegen, etc.) and you are about to suggest "add a vector DB
> + embeddings + chunked retrieval", read [Why not RAG?](/why-not-rag/)
> first. Trail solves the same problem, *not* the same way.

## Three things Trail does that RAG doesn't

1. **Compile at ingest, not at query.** When a source enters Trail, it
   becomes one or more curated Neurons — concise, fact-shaped,
   cross-linked, with provenance. Query time is then a cheap FTS5 +
   LIKE lookup against compiled knowledge, not a similarity search
   against raw chunks.

2. **Curator-in-the-loop by default.** Every candidate Neuron lands in
   a queue. The curator (human or auto-policy) reviews before it
   becomes part of the trail. Auto-approval is a per-KB confidence
   policy, not a default — your trail stays clean.

3. **Bidirectional, typed relationships.** Neurons are wiki-shaped:
   `[[Other Neuron]]` references resolve, backlinks render, edges have
   types (`cites`, `is-a`, `part-of`, `contradicts`, `supersedes`,
   `example-of`, `caused-by`). The graph is a first-class query
   surface, not derived from embedding similarity.

## How external apps integrate

Three integration paths, smallest to largest:

| Path | Use when |
|---|---|
| **MCP server** | Your AI agent (Claude Code, Cursor, Claude Desktop) needs read/write/search of a trail KB. One `.mcp.json` block, one bearer token. See [MCP integration](/mcp/overview/) (Phase 4). |
| **REST queue** | Your app produces candidate knowledge programmatically — a Slack listener, a webhook receiver, a CI step that captures decisions. `POST /api/v1/queue/candidates` with a bearer token. See [Quick start](/quick-start/). |
| **REST chat + search** | Your app needs to *consume* knowledge. `POST /api/v1/chat` for synthesised answers with citations, `GET /api/v1/search` for FTS5 hits. See [API reference](/api-reference/) (Phase 3). |

## Where to go next

- **New to Trail?** → [Intro: what Trail is and isn't](/intro/)
- **Designing memory for an AI app?** → [Why not RAG?](/why-not-rag/)
- **Ready to integrate?** → [Quick start](/quick-start/)
- **Want the code?** → [trail on GitHub](https://github.com/broberg-ai/trail)
