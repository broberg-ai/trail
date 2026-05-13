---
title: Connectors
slug: concepts-connectors
summary: Every candidate carries a metadata.connector id identifying its ingestion pathway. Drives queue UI filtering, Neuron attribution, and orphan-lint awareness. Centrally registered, easy to extend.
order: 13
audience: both
category: Concepts
---

A **connector** is the named ingestion pathway that produced a
candidate. The connector id rides on `metadata.connector` for every
candidate; the system surfaces it in the queue UI (chip filter), in
the Neuron reader (`Created via …` badge), and in lint detectors
(orphan-detection skips Neurons from external connectors per F98).

Knowing the connector model is the difference between a clean KB
where every Neuron's origin is traceable and a soup of mystery rows.

## The registry

The canonical list lives in
[`packages/shared/src/connectors.ts`](https://github.com/broberg-ai/trail/blob/main/packages/shared/src/connectors.ts).
Adding a new connector = one entry in this file plus a setter at the
write site. No schema migration, no DB change.

### Live connectors (in production)

| id | Set by |
|---|---|
| `upload` | The file-upload ingest pipeline (PDFs, markdown, etc.). |
| `mcp:claude-code` | An MCP write from a Claude Code cc session. The session's `.mcp.json` sets `TRAIL_CONNECTOR=mcp:claude-code`. |
| `mcp:cursor` | Same shape from a Cursor session. |
| `mcp` | Generic MCP — when the specific client identity is unknown. |
| `buddy` | A `buddy.trail_save(...)` call routed via the external-feed transport. |
| `chat` | The admin chat panel's "save this answer as a Neuron" flow. |
| `lint` | The orphan / contradiction / stale detector emits a finding. |
| `curator` | Direct edit via the Neuron editor (F91). |
| `api` | A generic external app calling the REST API. |

### Roadmap connectors

| id | Status |
|---|---|
| `slack` | Stubbed — flips to `'live'` when the Slack ingest ships. |
| `discord` | Stubbed. |
| `notion` | Stubbed. |
| `github` | Stubbed. |
| `linear` | Stubbed. |

These are listed in the registry as `status: 'roadmap'` so the
landing page can promise them honestly; they become operative when
the implementation lands and the registry entry flips to
`status: 'live'`.

## Why connectors matter

### 1. Queue UI filtering

The admin's queue panel renders a connector-chip filter row at the
top: each connector that has produced at least one candidate this
week shows up as a chip. Curator clicks `mcp:claude-code` → sees only
candidates from cc sessions. Clicks `chat` → sees only candidates
from the admin chat-save flow.

### 2. Neuron-level attribution

The Neuron reader shows a "Skabt via *connector*"-badge with a small
icon. Curators can answer "where did this come from?" without
spelunking the wiki_events log.

### 3. Orphan-lint awareness (F98)

The orphan-Neuron detector — "this Neuron has no inbound `[[links]]`
and no `document_references` rows" — skips Neurons whose originating
candidate came from an external connector (`buddy`, `mcp`,
`mcp:claude-code`, `mcp:cursor`, `chat`, `api`, `share-extension`).

Why: their "source" lives outside Trail's KB. A buddy-saved ADR is
documented in git, not in a Trail Neuron. An MCP write from a cc
session has a session-id in the metadata but no Trail Neuron called
"the source". Flagging these as orphans would burn curator attention
on candidates that are correctly source-less.

External-flagged connectors live in `EXTERNAL_CONNECTORS` in
`connectors.ts`.

### 4. Future: ZeroState onboarding

When a new tenant signs up and their queue is empty, the admin
greets them with "your KB has 0 Neurons — connect a source to get
started" and shows the available connectors. The registry's
`status: 'live'` entries are the menu.

## How candidates pick up the connector id

Four paths, ranked by precedence:

1. **Explicit `metadata.connector` in the candidate body** — wins
   over everything. External apps calling the REST API should always
   set this.
2. **MCP subprocess `TRAIL_CONNECTOR` env** — the MCP server stamps
   this on the candidate it emits. Claude Code's `.mcp.json` sets
   `mcp:claude-code`; Cursor's MCP config sets `mcp:cursor`. Without
   the env, it falls through to `mcp`.
3. **`metadata.source` legacy field** — older candidates that
   predate F95 have a `source` field that `stampConnector()` in
   `packages/core/src/queue/candidates.ts` infers a connector id
   from.
4. **`kind` heuristic** — when nothing else is set,
   `kind=chat-answer` defaults to `chat`, `kind=ingest-summary`
   defaults to `upload`, etc.

In your own integration, **always set `metadata.connector`
explicitly**. The heuristics exist for legacy / accidental writes;
explicit attribution is the right shape.

## Adding a new connector

```typescript
// packages/shared/src/connectors.ts
export const CONNECTORS = [
  // ... existing entries
  {
    id: 'mycompany-zendesk-bridge',
    label: 'Zendesk Bridge',
    icon: '🎫',
    status: 'live',
    external: true,  // skip orphan-lint
  },
];
```

Then at your write site:

```typescript
await fetch(`${API}/api/v1/queue/candidates`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({
    knowledgeBaseId: KB,
    kind: 'external-feed',
    title: ...,
    content: ...,
    metadata: JSON.stringify({
      connector: 'mycompany-zendesk-bridge',
      sourceUrl: ticket.url,
      ticketId: ticket.id,
    }),
  }),
});
```

That's the whole onboarding. Queue UI picks it up on next build of
the admin (it reads the registry). Filter chip + Neuron badge work
automatically.

## Where to go next

- [Concepts: Queue](/concepts-queue/) — how candidates flow through review
- [Concepts: Neurons](/concepts-neurons/) — what candidates become
- [Quick start](/quick-start/) — POST your first candidate with a connector tag
