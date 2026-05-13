---
title: Reader feedback
slug: reader-feedback
summary: How 👍/👎/🚩 buttons on a chat answer become curator queue candidates. The closed loop that lets external sites and embeds teach the KB what's wrong without anyone manually copying chat-logs.
order: 31
audience: both
category: Concepts
---

When a reader interacts with a chat answer — internal curator using
the admin chat, or an end-user clicking a 👍/👎/🚩 button on a chat
widget embedded in a customer-facing site — that reaction needs to
land somewhere actionable. Without it, the chat is a one-way
broadcast: the AI answers, the user moves on, and the practitioner
never learns which answers were wrong.

Reader feedback is the closed loop. One endpoint, three vote shapes,
and every submission becomes a `reader-feedback` candidate in the
curator's queue with the original question + answer + citations
bundled in. The curator sees the feedback in context, decides
whether to update a Neuron, add a new one, or dismiss as
already-handled.

## The endpoint

```http
POST /api/v1/knowledge-bases/{kbId}/reader-feedback
Authorization: Bearer {TRAIL_API_KEY}
Content-Type: application/json

{
  "vote": "down",
  "question": "What treatments work for chronic headaches?",
  "answer": "Reflexology may help with some types of headaches.",
  "reason": "The answer is too vague — doesn't cite which types.",
  "category": "missing-info",
  "pageUrl": "https://example.com/treatments",
  "citations": [
    { "documentId": "doc_...", "path": "/wiki/...", "filename": "....md" }
  ]
}
```

Response (HTTP 201):

```json
{
  "candidateId": "cand_...",
  "status": "pending",
  "queueUrl": "/kb/my-kb/queue#cand_..."
}
```

See the [interactive API reference](/api-reference/) for the full
spec including the OpenAPI 3.1 schema.

## Vote semantics

Three vote types, three different curator workflows:

| Vote | Reason required | What happens |
|---|---|---|
| `up` (👍) | No | Positive signal — recorded as a low-priority candidate the curator can use as evidence that an answer was good. Confidence stays at default. |
| `down` (👎) | **Yes** | Negative signal — the AI got it wrong, was vague, or didn't help. Candidate gets implicit confidence `0.3` (below typical auto-approval thresholds) so it always reaches a human. |
| `flag` (🚩) | **Yes** | Escalation — the answer crossed a boundary (out-of-scope claim, potentially harmful, ethical concern). Same confidence as `down` but the 🚩 emoji in the candidate title surfaces it visually. |

Without a `reason` on `down` or `flag`, the server returns HTTP 400
with `error: "reason_required_for_negative_vote"`. The reasoning:
the curator's queue is precious attention; a thumbs-down with no
context isn't actionable.

## What the curator sees

A `reader-feedback` candidate renders in the queue with:

- **Title**: `👍 Positive feedback: <question>` / `👎 Negative feedback: <question>` / `🚩 Flagged feedback: <question>` — the emoji makes the type scannable.
- **Body**: a markdown rendering of `## Reader question` / `## AI answer` / `## Citations` / `## Reader's feedback`, plus category and pageUrl as inline metadata. The curator sees the full context without re-loading the original session.
- **Metadata**: connector=`reader-feedback`, vote, category, pageUrl, sessionId, turnId, citationCount.

The curator can:

1. **Approve as user-correction** — rewrite the Neuron the bad answer
   came from, save, the next time the same question is asked the new
   Neuron grounds the answer.
2. **Approve as new Neuron** — if the feedback exposes a gap in the
   KB, draft a Neuron from the feedback's content and ship it.
3. **Dismiss** — already-handled, irrelevant, or out-of-scope. The
   candidate row stays for audit but disappears from the queue.

## Integration patterns

### Pattern A: admin chat (curator-facing)

Trail's own admin chat at `/kb/:kbId/chat` ships with the feedback
buttons built in. Curators see them under every assistant message
and use them to flag answers they themselves got wrong while
exploring their own KB. This is the canonical reference
implementation.

### Pattern B: embedded chat widget (end-user-facing)

A widget on an external customer site (Pattern A from
[A site-LLM with Trail as a tool](/site-llm-with-trail-as-tool/))
adds the same 👍/👎/🚩 buttons under each answer. End-users click,
get a quick reason form for negative votes, and the candidate lands
in the same curator queue as admin chat — with `pageUrl` capturing
where the feedback originated.

### Pattern C: site-LLM orchestrator

A Pattern C site-LLM that calls `/retrieve` and renders its own
chat UI adds the buttons in its own chat component. The reasoning
is identical to Pattern B — same endpoint, same shape — just the
client that submits the vote is the site-LLM rather than Trail's
hosted widget.

## Designing your feedback UX

A few rules-of-thumb from Trail's own admin implementation:

- **`up` is one click, fire-and-forget.** No modal, no reason form,
  just a quick API call + a "thanks" state.
- **`down` and `flag` open an inline reason form** with a `textarea`
  + a small category chip-bar (wrong-info, missing-info,
  irrelevant, tone, other). Both fields are optional from the UX
  side but the server enforces a non-empty `reason`.
- **Show success.** A small "Thanks — sent to curator queue" state
  is the difference between "did I just shout into the void?" and
  "the practitioner is going to see this".
- **Show the original answer remains visible.** The reader should
  not feel that submitting feedback hides what they were reading.
- **Bearer token, not user session.** End-users on an external site
  don't have a curator's admin session — the widget proxies through
  the site's own server-side using a KB-scoped bearer token.

## Where to go next

- [API reference](/api-reference/) — full OpenAPI schema for the
  `/reader-feedback` endpoint.
- [A site-LLM with Trail as a tool](/site-llm-with-trail-as-tool/)
  — the Pattern C orchestrator that pairs naturally with reader
  feedback.
- [Concepts: Queue](/concepts-queue/) — where reader-feedback
  candidates land + the curator's review flow.
