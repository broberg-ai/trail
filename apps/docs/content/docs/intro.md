---
title: Intro — what Trail is, and isn't
slug: intro
summary: Trail is an AI-native compile-at-ingest knowledge engine. It is not a vector database, not a RAG framework, not a NotebookLM clone, not a chat-with-your-PDFs wrapper.
order: 1
audience: both
category: Start here
---

Trail is **a compile-at-ingest knowledge engine** — a second brain
for software, exposed as a small REST + MCP surface that your apps
and AI agents talk to.

This page explains what that sentence actually means, and what Trail
is *not*. Read [Why not RAG?](/why-not-rag/) right after this if you
are designing a memory layer for an AI app.

## What Trail is

A trail is a **knowledge base** (KB) backed by a single SQLite file
(`trail.db`) per tenant, containing:

- **Neurons** — curated atoms of knowledge, each one fact-shaped,
  concise, citable, version-tracked, and identified by a stable
  per-KB sequence ID (`kbPrefix_XXXXXXXX`).
- **Bidirectional references** between Neurons (`[[wiki-style]]`),
  with typed edges (`cites`, `is-a`, `part-of`, `contradicts`,
  `supersedes`, `example-of`, `caused-by`).
- **Sources** — the raw inputs (PDFs, markdown files, URLs, audio
  transcripts, screenshots, programmatic candidates) that compiled
  into the Neurons. Provenance is preserved.
- **A queue** of pending **candidates** — proposed Neurons waiting
  for curator review. Every write to the KB goes through this queue.
- **FTS5 full-text search**, **typed graph queries**, **synthesis chat
  with citations**, and a **glossary** auto-maintained from the
  Neuron set.

External apps integrate through:

- A **REST API** under `/api/v1/...` — bearer-token auth, JSON
  bodies, server-sent events for streaming.
- An **MCP server** (Model Context Protocol) for AI agents — Claude
  Desktop, Cursor, Claude Code, and any other MCP-aware tool gets
  read/write/search of any KB they have a token for.

The same trail can have multiple **knowledge bases** (separate `kb`
slugs); a customer who studies acupuncture might have one KB for
*Traditional Chinese Medicine* and another for *Customer support
playbook*. KBs are isolated — search, chat, and graph queries all
scope to one KB.

## What Trail is **not**

| Trail is not | Why it matters |
|---|---|
| A vector database | We do not store embeddings of raw text and retrieve top-K at query time. Compile-at-ingest replaces retrieve-at-query. |
| A RAG framework | RAG retrieves raw chunks; Trail returns compiled Neurons with citations. See [Why not RAG?](/why-not-rag/). |
| A NotebookLM clone | NotebookLM is a closed product surfacing answers over your sources. Trail is an open engine you build on; chat is one feature, not the product. |
| A "chat with your PDFs" wrapper | Trail's PDF pipeline is one of many input adapters; the value is the curated Neuron graph that comes out, not the chat over the input. |
| A wiki you write by hand | You can edit Neurons by hand, but the design assumes most knowledge enters via ingest. The wiki is the *output*, not the input. |
| A multi-user collaboration tool | Trail is single-curator-per-KB by design. Multi-curator + comments + diffs are a Phase 2 concern. |
| A conversation-history archive | There are tools for that (MemPalace, mem0). Trail compiles knowledge *out of* conversations into reusable Neurons; it does not replay verbatim history. |

## Mental model in one diagram

```
                       ┌──────────────────────────────────┐
   PDFs, MD, URLs,     │                                  │
   audio, candidates ─►│   Ingest pipeline                │
   from external apps  │   (Claude CLI / OpenRouter)      │
                       │                                  │
                       └────────────────┬─────────────────┘
                                        │ candidates
                                        ▼
                       ┌──────────────────────────────────┐
                       │   Curation queue                 │
                       │   (auto-approval policy + human) │
                       └────────────────┬─────────────────┘
                                        │ approved
                                        ▼
                       ┌──────────────────────────────────┐
                       │   Neurons (the trail itself)     │
                       │   — FTS5, typed edges, glossary  │
                       └────────────────┬─────────────────┘
                                        │
                       ┌────────────────┴─────────────────┐
                       ▼                                  ▼
            REST API (search, chat,            MCP server (read,
            graph, retrieve, queue)            write, search,
                                               guide, recent)
```

Your app sits at one or both endpoints — feeding ingest at the top,
querying via REST or MCP at the bottom. Trail handles the middle.

## Where to go next

- **Designing memory for an AI app?** → [Why not RAG?](/why-not-rag/)
- **Ready to integrate?** → [Quick start](/quick-start/)
- **Want the code?** → [trail on GitHub](https://github.com/broberg-ai/trail)
