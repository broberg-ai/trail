---
title: Search + retrieve
slug: concepts-search
summary: How Trail finds knowledge — FTS5 over Neuron bodies + chunks, share-gated LIKE-scan of curator user-notes, audience filter, BM25 ranking. Two endpoints, two shapes.
order: 14
audience: both
category: Concepts
---

Trail has two distinct query paths, both backed by the same
SQLite-FTS5 index but shaped for different consumers:

- **`GET /search`** — keyword search, returns ranked hits with
  highlight. Consumer: humans browsing the admin, or external apps
  building their own UX.
- **`POST /retrieve`** — grounded retrieval, returns ranked chunks
  PLUS a pre-formatted `formattedContext` string. Consumer: LLM
  orchestrators (Pattern C, see
  [Site-LLM with Trail as a tool](/site-llm-with-trail-as-tool/)).

Both endpoints respect the same audience + share-gating model, so a
Neuron tagged `audience: curator` never leaks through a Bearer token.

## What gets indexed

FTS5 indices exist on three tables, kept in sync by triggers:

| Table | Indexed columns | Purpose |
|---|---|---|
| `documents_fts` | `title`, `content`, `header_breadcrumb` | Whole-Neuron matching, what `/search` consumes. |
| `chunks_fts` | `content`, `header_breadcrumb` | Sub-section matching, what `/retrieve` uses to find the most relevant ~500-character spans. |
| (`documents.user_note`) | LIKE-scanned at query time, not FTS-indexed | Curator's "Din tanke" reflections. Substring matching across shared notes only. |

Chunks are split on heading boundaries during ingest, with overlap
control for long sections. Each chunk knows its parent Neuron + its
header breadcrumb (`Wellness > Sleep > Reflexology`) so the retriever
can show the context-path of the match.

## How ranking works

FTS5's built-in **BM25** ranking is the default. BM25 weights:

- **Term frequency** in the matching row.
- **Inverse document frequency** — common words across the KB matter
  less.
- **Length normalization** — short Neurons aren't penalised for
  having a high term-density.

A higher rank score means a better match. `/search` and `/retrieve`
both return rank values in their responses; you can sort or filter
client-side if you want.

## The audience filter

Every Neuron carries an `audience` array in its frontmatter. Bearer
tokens carry an `authType` claim (`tool`, `public`, or `curator`).
The retrieve / search layer filters out Neurons whose `audience` list
does not include the caller's `authType`:

| Caller's authType | Sees Neurons tagged |
|---|---|
| `curator` | `curator`, `tool`, `public`, *everything* |
| `tool` | `tool`, `public` |
| `public` | `public` only |

This is enforced at the retrieve layer; the FTS index itself is not
audience-aware. The engine fetches `topK * 3` candidates from FTS,
then filters down to `topK` after applying audience + tag rules.

## User-note search

Curators can attach a personal "Din tanke" reflection to any Neuron.
By default these are **private** — they never appear in chat
contexts or search results.

A curator can opt-in per-Neuron to share their note. Once flagged
shared:

- The note is searched via a substring LIKE-scan over
  `documents.user_note`.
- Substring matching is intentional (no FTS tokeniser) — captures
  exact wording the curator wrote, including names, dashes, and
  punctuation the curator deliberately put in.
- Both `/search` and the chat-retrieve path consult shared notes.
- Private notes never leak — opt-in is per-Neuron, not per-KB.

The two-pass matching:

1. **Try the full query as a substring** — handles literal lookups
   like `"VIP customer"` or `"Obi-Wan Kenobi"`.
2. **Fall back to token OR** — split on whitespace only (preserves
   intra-token hyphens like `Obi-Wan`); each token of length ≥ 3 is
   tried as a substring. First match wins for highlight purposes.

Edge punctuation (`?`, `.`, `!` at the boundaries of tokens) is
stripped before matching — `"jedi?"` becomes `"jedi"`.

## What `/retrieve` returns

The shape that powers Pattern C orchestrators:

```json
{
  "hitCount": 5,
  "totalChars": 1873,
  "formattedContext": "## Neuron 1 — VIP escalation policy\n\nWhen a VIP...\n\n## Neuron 2 — On-call rotation\n\n...",
  "chunks": [
    { "documentId": "...", "seqId": "myprod_a1b2c3d4", "title": "VIP escalation policy", "neuronPath": "/wiki/...", "content": "When a VIP...", "headerBreadcrumb": "Policies > Escalation", "rank": 0.91 }
  ]
}
```

- `formattedContext` — markdown string, ready to feed straight to an
  LLM as additional context. No further chunk-rendering on the
  client side. Header-breadcrumb included so the LLM knows the
  section a chunk came from.
- `chunks` — the same data structured for clients that need to
  render their own citation UI (clickable seqIds, neuron links).

Token-budget guarantees:

- `maxChars` is a **hard** upper-bound on `sum(chunks.content)`.
- The engine pulls `topK * 3` chunks from FTS, applies audience
  filtering, then admits chunks by rank until either `topK` chunks
  are admitted or the `maxChars` budget is hit.
- Edge case: a single highest-rank chunk that alone exceeds
  `maxChars` is truncated to fit, with `…` ellipsis.

## What `/search` returns

```json
{
  "documents": [
    {
      "id": "...",
      "knowledgeBaseId": "...",
      "filename": "vip-escalation-policy.md",
      "title": "VIP customer escalation policy",
      "path": "/wiki/vip-customer-escalation-policy",
      "kind": "wiki",
      "seq": 37,
      "tags": "policy,escalation,on-call",
      "highlight": "When a <mark>VIP</mark> customer raises...",
      "rank": 0.91
    }
  ]
}
```

The `<mark>` wrapping in `highlight` matches the FTS5 highlight
function (`highlight(documents_fts, ...)`). Renderable directly in
HTML without further processing.

## Claim-anchor stripping

Neurons compile with `{#claim-XXXXXXXX}` markers for
cross-Neuron citation precision. These are **stripped before output**:

- `/retrieve`'s `formattedContext` — no markers (would confuse the
  LLM).
- `/search`'s `highlight` — no markers.
- `/chat`'s answer — no markers (stripped via `stripClaimAnchors`
  from `@trail/core`).

Markers live in the database, get rendered as superscript `#` icons
in the admin reader, and never leak to external surfaces.

## FTS5 query syntax

Both endpoints accept FTS5's query syntax — useful for power users:

| Query | Meaning |
|---|---|
| `vip escalation` | Both words anywhere (implicit AND). |
| `"vip escalation"` | Phrase match. |
| `vip OR escalation` | Either word. |
| `vip*` | Prefix match — `vip`, `vips`, `vip-tier`. |
| `vip NOT pager` | First but not second. |
| `vip AND (escalation OR priority)` | Boolean composition. |

The default `query` value Trail accepts is the raw user-typed
string; the retrieve layer normalises punctuation but otherwise
passes through to FTS5.

## When `/search` vs `/retrieve` — picking the right one

- **You are building your own UX** (a search bar, a results page) —
  use `/search`. Returns whole Neurons; you decide how to format.
- **You are building a chat or orchestrator that needs LLM-grounded
  context** — use `/retrieve`. The `formattedContext` is the
  pre-cooked input your LLM wants.
- **You want a turnkey grounded chat** — use `/chat` (Pattern A) and
  skip both. `/chat` calls `/retrieve` internally and feeds the LLM
  for you.

## Where to go next

- [Concepts: Neurons](/concepts-neurons/) — what these endpoints
  retrieve
- [Concepts: Queue](/concepts-queue/) — how Neurons land in the
  search index
- [Site-LLM with Trail as a tool](/site-llm-with-trail-as-tool/) —
  Pattern C consumer of `/retrieve`
- [API reference](/api-reference/) — endpoint shapes
