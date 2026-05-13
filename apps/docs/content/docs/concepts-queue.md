---
title: The curation queue
slug: concepts-queue
summary: Every write to a Trail KB goes through the candidates queue. Candidates → curator review → Neurons. Auto-approval policy decides when curator review is bypassed.
order: 11
audience: both
category: Concepts
---

The **curation queue** is the single write path into a Trail KB.
Every Neuron that exists started life as a candidate in the queue:
from a Claude-Code session that wrote via MCP, from a webhook
forwarding Slack messages, from a PDF that the ingest pipeline
compiled, from a user-correction submitted through the reader.

Knowing the queue model is the difference between *reading docs* and
*operating Trail* — the queue is where curators spend most of their
time, and where the auto-approval policy decides how much of that
time is automated away.

## The flow

```
External app / pipeline / chat / MCP
        │
        ▼
POST /api/v1/queue/candidates  ──►  candidate (status=pending)
                                          │
                                          ├─► Curator reviews in admin UI
                                          │       │
                                          │       ├─► [Approve] → Neuron created/updated
                                          │       ├─► [Dismiss] → status=dismissed
                                          │       └─► [Reopen]  → back to pending
                                          │
                                          └─► Auto-approval policy
                                                  │
                                                  ├─► Confidence ≥ threshold + clean action zone
                                                  │     → auto-approve
                                                  └─► Otherwise → wait for curator
```

The candidate row stays in the database forever (audit trail). The
Neuron it produced — when approved — has a back-pointer
(`sourceCandidateId`) so you can trace any Neuron to the candidate
that birthed it, and beyond it to the connector that submitted that
candidate.

## Candidate kinds

The `kind` field discriminates what shape of candidate this is. The
ones external apps emit most often:

| `kind` | When to use |
|---|---|
| `chat-answer` | A Q&A pair produced by a user-facing chat. The user asked, the AI answered, the answer is good enough that you want it canonicalised into the KB. Most common kind for site-LLM Pattern C deployments. |
| `user-correction` | A diff against an existing Neuron. Supply the target seqId in `metadata.targetNeuron`. The curator sees a side-by-side diff. |
| `external-feed` | Generic "this came from outside Trail" — use when none of the more specific kinds fit. Slack listeners, webhook receivers, CI integrations. |
| `reader-feedback` | Flagged from the reader UI by the curator themselves. |
| `ingest-summary` | Internal — emitted by Trail's own ingest pipeline when it compiles a source. You don't usually emit these from external apps. |
| `gap-detection` | Internal — emitted by automated detectors that find topics the KB doesn't cover. |
| `contradiction-alert` | Internal — emitted by the contradiction lint pass. |
| `cross-ref-suggestion` | Internal — emitted by the orphan-link detector. |

The full enum lives in
[`packages/shared/src/schemas.ts:197`](https://github.com/broberg-ai/trail/blob/main/packages/shared/src/schemas.ts#L197).

## What goes in the metadata

The `metadata` field is a JSON-stringified blob. Trail's queue UI
reads several conventional keys:

```json
{
  "connector": "site-chat",
  "sourceUrl": "https://internal.example.com/policies/x",
  "targetNeuron": "myprod_a1b2c3d4",
  "conversationId": "chat_sess_...",
  "sourceTurnId": "..."
}
```

| Key | Used by |
|---|---|
| `connector` | The Queue UI's connector-chip filter + Neuron reader's "Created via" badge. See [Concepts: Connectors](/concepts-connectors/). |
| `sourceUrl` | Where this candidate came from — link rendered in the queue card. |
| `targetNeuron` | Required for `kind=user-correction` — the seqId being corrected. |
| `conversationId`, `sourceTurnId` | When the candidate came from a chat — lets curators jump back to the original conversation. |

Any other keys you set are preserved on the candidate. The Neuron
created on approval inherits the metadata (some of it surfaces in the
Neuron's frontmatter; some stays on the candidate-row only).

## Curator review

The admin's queue panel (`/kb/:kbId/queue`) shows pending candidates
as cards. For each:

- **Title** + **content preview** (markdown rendered).
- **Suggested action** — a small LLM-pass (Action Recommender)
  proposes whether this should be approved as a new Neuron, merged
  into an existing one, or dismissed. One-click accept.
- **Diff** — for `user-correction` kind, side-by-side before/after

- **Action menu** — Approve, Dismiss (with reason), Reopen.
- **Connector chip** — filter by source ingestion path.
- **Tag chips** — auto-suggested tags from the KB's vocabulary


Bulk operations are available: "Accept all recommended actions" runs
the recommender's choice across all pending candidates.

## Auto-approval policy

Most curators don't want to review *everything*. The auto-approval
policy gates which candidates skip curator review:

- **By confidence threshold** — if the candidate carries a
  `confidence` ≥ X (set per-KB), auto-approve.
- **By action zone (Phase 2)** — `green` zone candidates
  auto-approve, `yellow` requires curator review, `red` requires
  curator + a flagged warning.
- **By connector** — some connectors (e.g. `lint`) auto-approve
  because they're already running curated logic.
- **By Solo Mode** — single-curator KBs can enable a more
  permissive default.

A candidate that fails the policy stays `pending` until a curator
acts on it.

## Why everything routes through the queue

Three reasons the queue is non-negotiable, even for "trusted"
connectors:

1. **Audit trail.** Every write is a row with a timestamp + actor +
   source. "Who put this in the KB last March?" is one SQL query
   away.
2. **Reversibility.** Approval is a write. Reopen + dismiss is a
   write. The queue history captures intent; the Neuron's
   `wiki_events` log captures effect. Mistakes are recoverable.
3. **Composability.** New connectors (Slack ingest, Notion sync,
   GitHub PR-summaries) plug in by emitting candidates. They don't
   need to know about Neurons, FTS5, supersession, or backlinks —
   the queue + approval flow handles all of that.

## Where to go next

- [Concepts: Neurons](/concepts-neurons/) — what the queue produces
- [Concepts: Connectors](/concepts-connectors/) — attribution model
  for candidates
- [API reference](/api-reference/) — `POST /queue/candidates` shape
- [Quick start](/quick-start/) — submit your first candidate
