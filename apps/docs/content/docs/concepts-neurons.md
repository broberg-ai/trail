---
title: Neurons
slug: concepts-neurons
summary: The atomic unit of knowledge in Trail. Compiled at ingest, stable seqIDs, bidirectional typed references, versioned, audience-tagged. The thing you actually retrieve when you query a KB.
order: 10
audience: both
category: Concepts
---

A **Neuron** is the atomic unit of curated knowledge inside a Trail
knowledge base. Every retrieval, every chat citation, every wiki-link
resolves to one Neuron. If RAG returns raw chunks, Trail returns
Neurons — fact-shaped, citable, deduplicated, cross-linked.

## What a Neuron is

A markdown document with structure:

```yaml
---
title: VIP customer escalation policy
seqId: myprod_a1b2c3d4
version: 3
tags: [policy, escalation, on-call]
audience: [public]
sources:
  - sourceId: src_5f7e9a1c
    page: 12
---

# VIP customer escalation policy

When a VIP customer raises a ticket, page the on-call lead via
PagerDuty within 5 minutes. Escalation overrides queue priority.

## Why

[[On-call rotation]] is sized for normal volume; VIP escalations
contradict the [[ticket-prioritisation policy]] (which sorts by SLA).
The 5-minute window matches the [[contractual SLA tier]] for VIP.
```

Five things live in every Neuron:

1. **Frontmatter** — `seqId`, `title`, `version`, `tags`, `audience`,
   `sources`. The bookkeeping that lets the system track provenance,
   evolution, and access.
2. **Markdown body** — the actual knowledge. Headings, prose, lists,
   tables, code blocks.
3. **Wiki-links** — `[[Other Neuron]]` references that resolve via
   bidirectional backlinks. Typed edges are supported via
   `[[cites:Other]]`, `[[contradicts:Other]]`, etc. (F137).
4. **Claim anchors** — `{#claim-XXXXXXXX}` markers injected
   post-compile that give each named claim a stable identifier
   surviving edits + recompiles (F22). Used for cross-Neuron citation
   precision.
5. **User notes** — optional curator reflections per Neuron, stored
   separately. Private by default; opt-in shareable into chat + search
   (F112).

## The seqId — canonical handle

Each Neuron has a stable per-KB sequence identifier:

```
{kbPrefix}_{8-digit-seq}
```

Examples:

```
myprod_00000037
practice_00000142
buddy_00000049
trail_00000163
```

- `kbPrefix` — first slugified word of the KB name, lowercase.
- `8-digit-seq` — monotonic per KB, starts at 1, zero-padded.

`seqId` survives edits (the Neuron's content can change; the seqId
stays). It survives ingest re-runs (Trail does not re-allocate seqIds
on recompile). It is the **canonical handle** when an external system
needs to cite a Neuron back into Trail — newer than the internal
`documentId` UUID, more stable than wiki-link slugs, more readable
than hashes.

See F145 in the [trail repository](https://github.com/broberg-ai/trail)
for the implementation.

## Versions + supersession

Every edit to a Neuron bumps its `version`. The full history is
preserved in `wiki_events` — an append-only event log of all KB
changes since the KB was created.

Two-way edits that warrant explicit superseding:

- **Curator update via the editor** — bumps version, writes a new
  `version_X` row in history.
- **Auto-supersession from a contradiction-lint finding** — when the
  contradiction detector concludes that a newer Neuron supersedes an
  older one, a `supersedes` edge is added (F137 typed edges) and the
  older Neuron is dimmed in the reader graph (F139 confidence decay).

Time-travel queries against any past `version` are a Phase 3
roadmap-item (F74 in this repo's roadmap); the event log already
contains the data.

## Bidirectional, typed references

Wiki-links are first-class:

```markdown
The [[escalation policy]] applies to all VIP tickets,
overriding the [[ticket-prioritisation policy]].
```

When the Neuron compiles, the link-resolver finds the target Neurons
(F148 link-checker — three layers of fuzzy + slug-normalised matching
so DA/EN drift like `og`↔`and` doesn't break links).

Both directions are stored:

- `document_references` — outbound (from this Neuron to others).
- `wiki_backlinks` — inbound (which Neurons cite this one).

Edge types (F137):

| Type | Meaning |
|---|---|
| `cites` | This Neuron references that one as a source. |
| `is-a` | Subtype / instance relationship. |
| `part-of` | Composition / containment. |
| `contradicts` | These two disagree (used by contradiction-lint). |
| `supersedes` | This Neuron replaces an older one. |
| `example-of` | This Neuron is a concrete example of an abstract concept. |
| `caused-by` | Causation, typically used in incident/post-mortem KBs. |

Syntax: `[[cites:Other Neuron]]`, default-type is implicit `cites`
when you write `[[Other Neuron]]` without a prefix.

The graph that emerges renders in the admin's
[F99 Neuron Graph](https://github.com/broberg-ai/trail/blob/main/docs/features/F99-neuron-graph.md)
— Sigma + ForceAtlas2 layout with edge-type colors + legend.

## Audience tags

Each Neuron can carry an `audience` array in frontmatter — `public`,
`tool`, `curator`, or custom strings the deployer defines. Used by
`/api/v1/knowledge-bases/{kbId}/retrieve` (F160) to filter the
retrieve pool:

- `audience: tool` (default for Bearer auth) — sees `tool` + `public`
  Neurons.
- `audience: public` — sees only `public`-tagged Neurons.
- `audience: curator` — sees everything (admin UI).

Custom audiences (e.g. `student`) can be wired Trail-side for any
sub-audience filtering you need.

## Confidence + decay

Every Neuron has an implicit confidence in [0, 1] that decays over
time (F139, generalised to all Neuron-types in the upcoming F182):

- Pin a Neuron explicitly → confidence held at 1.0.
- Don't touch a Neuron for 365 days → confidence drifts toward 0.1.
- Edit / cite / chat-reference → confidence reinforced.

Low-confidence Neurons:

- Dim in the reader graph.
- Drop out of `kb_retrieve` results when topK is small.
- Surface in the heuristic-decay lint pass for curator review.

The pattern keeps an old KB from being slowly poisoned by stale
truths.

## What lives in a Neuron — and what doesn't

| Lives in a Neuron | Lives elsewhere |
|---|---|
| Concept definitions, facts, rules, protocols | Structured catalog data (prices, durations, slugs) — use a JSON file or CMS |
| Connections between concepts (typed edges) | User session history — that is the chat-session table |
| Provenance (which source produced this Neuron) | Source files themselves — sources are stored separately and referenced by `sourceId` |
| Audience-controlled disclosure | Auth / access-control — that is the bearer-token layer |
| Multilingual content (per-KB language setting) | Multilingual *site* content — that's the CMS that drives the site |

## Where to go next

- [Concepts: Queue](/concepts-queue/) — how Neurons enter the KB
- [Concepts: Knowledge bases](/concepts-kb/) — what wraps Neurons
- [Concepts: Search](/concepts-search/) — how to find Neurons
- [API reference](/api-reference/) — the endpoints that read + write Neurons
