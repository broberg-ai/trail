---
title: Quick start
slug: quick-start
summary: Five-step external-app integration. Get a token, POST a candidate, see it land in the queue, approve it, query the resulting Neuron via search and chat.
order: 3
audience: both
category: Start here
---

This page walks an external app through the smallest end-to-end
integration with a Trail engine: produce a candidate from your
application, see it become a Neuron, query it back via REST.

> **API surface stability.** REST endpoints under `/api/v1/...` are
> the contract; everything under `/api/internal/...` is private and
> may change without notice. The hand-written OpenAPI 3.1 spec at
> `/api-reference` (Phase 3) is the source of truth.

## Prerequisites

You need:

1. A Trail engine you can reach over HTTPS. For Christian's
   production fleet that is `engine.trailmem.com`. For local
   development, an engine running on `127.0.0.1:58021`.
2. A **bearer token** scoped to your tenant. Get one at
   **<https://app.trailmem.com/settings>** → scroll to the
   **API Keys** section → click **Create new key** → copy the value
   (shown ONCE — the admin won't show it again, so save it now in
   your secret manager).

   Keys are **tenant-scoped, not per-KB** — one key authenticates
   against any KB owned by your tenant. If you operate multiple KBs
   under one tenant (e.g. `my-product-docs` and `internal-playbook`),
   the same key works for both.

3. The KB's slug (e.g. `my-product-docs`) — visible in the admin's KB
   URL: `https://app.trailmem.com/kb/{slug}/...`.

The examples below use shell variables you set once:

```bash
export TRAIL_API_BASE="https://engine.trailmem.com"
export TRAIL_TOKEN="trail_live_…"   # from app.trailmem.com/settings → API Keys
export TRAIL_KB="my-product-docs"
```

## 1. POST a candidate

A **candidate** is a proposed Neuron. It enters the curation queue
and is reviewed (by a curator or by the auto-approval policy) before
becoming part of the trail.

```bash
curl -sS -X POST "${TRAIL_API_BASE}/api/v1/queue/candidates" \
  -H "Authorization: Bearer ${TRAIL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "kb": "'"${TRAIL_KB}"'",
    "kind": "external-feed",
    "title": "VIP customer escalation policy",
    "content": "When a VIP customer raises a ticket, page the on-call lead via PagerDuty within 5 minutes. Escalation overrides queue priority.",
    "metadata": {
      "connector": "api",
      "sourceUrl": "https://internal.example.com/policies/vip-escalation"
    }
  }'
```

Response (HTTP 201):

```json
{
  "candidateId": "cand_…",
  "status": "pending",
  "queueUrl": "https://app.trailmem.com/kb/my-product-docs/queue#cand_…"
}
```

The candidate is now visible in the admin queue UI for review.

### Candidate kinds

The `kind` field tells Trail what shape of candidate you are
producing. Common values:

| `kind` | When to use |
|---|---|
| `external-feed` | Programmatic content from your app (webhooks, integrations) |
| `chat` | A user question + curated answer pair |
| `user-correction` | A diff against an existing Neuron (provide its seqID in `metadata.targetNeuron`) |
| `lint-finding` | An automated finding from a lint detector you ran |

If your candidate doesn't fit one of these, use `external-feed` —
it's the catch-all for "this came from outside Trail".

### `metadata.connector` is important

Every candidate should carry `metadata.connector` so the queue UI
can filter by source and the Neuron page can show "Created via
\<connector>". Use:

- `api` — a generic external app calling the REST API
- `mcp:claude-code` / `mcp:cursor` — set automatically when an AI agent writes via MCP
- `slack`, `discord`, `notion`, `github`, `linear` — when you build a connector for that system
- A custom string for your app, e.g. `mycompany-zendesk-bridge`

See the [connector registry](https://github.com/broberg-ai/trail/blob/main/packages/shared/src/connectors.ts) for the canonical list.

## 2. Approve the candidate

You can either:

- **Open the queue URL** from the response and click **Approve** in
  the admin UI, or
- **Set the KB's auto-approval policy** so candidates with
  sufficient confidence are approved without human review.

Once approved, the candidate becomes a Neuron with a stable seqID
like `myprod_a1b2c3d4`.

```bash
curl -sS -X POST "${TRAIL_API_BASE}/api/v1/queue/candidates/${CANDIDATE_ID}/approve" \
  -H "Authorization: Bearer ${TRAIL_TOKEN}"
```

(In Phase 1 of these docs the approval REST is part of the internal
admin surface; programmatic approval from external apps lands in
Phase 3 of the docs roll-out.)

## 3. Search for the new Neuron

```bash
curl -sS "${TRAIL_API_BASE}/api/v1/search?kb=${TRAIL_KB}&q=VIP%20escalation" \
  -H "Authorization: Bearer ${TRAIL_TOKEN}"
```

Response:

```json
{
  "hits": [
    {
      "id": "neuron_…",
      "seqId": "myprod_a1b2c3d4",
      "title": "VIP customer escalation policy",
      "highlight": "When a <mark>VIP</mark> customer raises a ticket, page the on-call lead via PagerDuty within 5 minutes…",
      "rank": 0.91,
      "kind": "wiki",
      "path": "/wiki/vip-customer-escalation-policy.md"
    }
  ],
  "total": 1
}
```

Search uses **FTS5** for full-text matching, plus a substring scan
of opt-in user-notes (the curator's "your take" reflections that
extend the Neuron's compiled content).

## 4. Ask a question via chat

For natural-language synthesis with citations:

```bash
curl -sS -X POST "${TRAIL_API_BASE}/api/v1/chat" \
  -H "Authorization: Bearer ${TRAIL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "kb": "'"${TRAIL_KB}"'",
    "messages": [
      { "role": "user", "content": "How fast must a VIP escalation be paged?" }
    ]
  }'
```

Response (streaming SSE; the final event holds the full answer):

```json
{
  "answer": "VIP escalations must be paged to the on-call lead within 5 minutes via PagerDuty. This overrides normal queue priority.",
  "citations": [
    {
      "seqId": "myprod_a1b2c3d4",
      "title": "VIP customer escalation policy",
      "url": "https://app.trailmem.com/kb/my-product-docs/wiki/myprod_a1b2c3d4"
    }
  ]
}
```

The chat endpoint:

- Retrieves relevant Neurons via FTS5 + share-gated user-note search
- Builds a system prompt with the KB's persona + retrieved context
- Calls the configured chat model (default `claude-sonnet-4-6`)
- Returns synthesised answer + an array of citations resolving to
  Neuron URLs in the admin

## 5. Upload a Source file (PDF, markdown, audio, image, ...)

For programmatic Source-upload — e.g. your app's "attach file" flow
or a scheduled importer — POST multipart-form:

```bash
curl -X POST "${TRAIL_API_BASE}/api/v1/knowledge-bases/${TRAIL_KB}/documents/upload" \
  -H "Authorization: Bearer ${TRAIL_TOKEN}" \
  -F "file=@./protocol.pdf" \
  -F 'path=/protocols' \
  -F 'metadata={"connector":"myapp","sourceUrl":"https://internal.example.com/12","tags":["protocol"]}'
```

Response (HTTP 201):

```json
{
  "id": "doc_...",
  "kind": "source",
  "filename": "protocol.pdf",
  "fileType": "pdf",
  "status": "pending",
  "seq": 47,
  "contentHash": "9f8e7d6c..."
}
```

For text formats (md, txt, csv, html), the ingest pipeline triggers
automatically and the Source compiles into Neurons within seconds.
For binary formats (PDF, audio, images), upload returns immediately
and the extractor + compile run async — poll `document.status` to
track `pending → ready → processing → success`.

**Duplicate handling (F162)**: bytes-identical re-uploads return
HTTP 409 with `code: "duplicate_source"` + the existing document's
id. Append `?force=true` to upload anyway.

Full lifecycle + supported formats + resumable chunked-upload
protocol in [Concepts: Sources](/concepts-sources/).

## 6. Read a single Neuron

If you have a seqID and want the raw Neuron:

```bash
curl -sS "${TRAIL_API_BASE}/api/v1/neurons/${TRAIL_KB}/myprod_a1b2c3d4" \
  -H "Authorization: Bearer ${TRAIL_TOKEN}"
```

Response:

```json
{
  "seqId": "myprod_a1b2c3d4",
  "title": "VIP customer escalation policy",
  "content": "# VIP customer escalation policy\n\nWhen a VIP customer raises a ticket…",
  "version": 1,
  "createdAt": "2026-05-08T12:34:56Z",
  "updatedAt": "2026-05-08T12:34:56Z",
  "tags": ["policy", "escalation"],
  "links": [
    { "type": "cites", "target": "myprod_e5f6a7b8" }
  ]
}
```

## Putting it together

Here is the same flow in TypeScript, suitable for dropping into a
Slack listener, a webhook receiver, or any Node service:

```typescript
const API_BASE = process.env.TRAIL_API_BASE!;
const TOKEN = process.env.TRAIL_TOKEN!;
const KB = process.env.TRAIL_KB!;

async function captureKnowledge(args: {
  title: string;
  content: string;
  sourceUrl?: string;
}): Promise<{ candidateId: string }> {
  const res = await fetch(`${API_BASE}/api/v1/queue/candidates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kb: KB,
      kind: "external-feed",
      title: args.title,
      content: args.content,
      metadata: {
        connector: "api",
        sourceUrl: args.sourceUrl,
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Trail candidate POST failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function ask(question: string): Promise<{ answer: string; citations: unknown[] }> {
  const res = await fetch(`${API_BASE}/api/v1/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kb: KB,
      messages: [{ role: "user", content: question }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Trail chat failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
```

That is the entire integration surface for most apps. There is no
vector store to keep in sync, no chunker to tune, no embedding-model
upgrade to plan. Trail handles the compile-at-ingest middle.

## Where to go next

- **Want to see all endpoints?** → [API reference](/api-reference/) (Phase 3)
- **Building an MCP-based AI agent?** → Dedicated MCP integration guide coming soon
- **Designing a connector?** → [Concepts: connectors](/concepts-connectors/)
