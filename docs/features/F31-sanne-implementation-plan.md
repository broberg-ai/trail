# F31 — Sanne session implementation plan (Reader Feedback in Eir widget)

> Handoff document for the sanne-andersen cc session. F31 backend +
> Trail's own admin-chat UI shipped 2026-05-13. This doc describes
> how Sanne's Eir chat widget on `sanneandersen.dk` adds the same
> 👍/👎/🚩 feedback flow so we can verify the end-to-end loop with
> real-world traffic.

## What's already done (Trail side)

| Piece | Where | Status |
|---|---|---|
| Endpoint `POST /api/v1/knowledge-bases/{kbId}/reader-feedback` | `apps/server/src/routes/reader-feedback.ts` | ✅ live on `engine.trailmem.com` after next ship |
| Zod validation + vote semantics | same | ✅ |
| `reason` required for `down`/`flag` (400 `reason_required_for_negative_vote` otherwise) | same | ✅ |
| Candidate created with `kind='reader-feedback'`, full chat context bundled into content | `createCandidate` core helper | ✅ |
| Public API docs + Redoc | https://docs.trailmem.com/api-reference/ + /reader-feedback/ | ✅ |
| Admin chat reference UI | `apps/admin/src/panels/chat.tsx` `FeedbackBar` | ✅ |

## What sanne-andersen-cc needs to ship

Three small pieces in `sanneandersen/site/`:

### 1. Add feedback buttons to the Eir chat answer-card

Eir's chat panel renders assistant messages somewhere in
`site/src/components/eir-chat/` (or similar). Below each assistant
turn, add a three-button row matching Trail's admin pattern:

```tsx
// site/src/components/eir-chat/feedback-bar.tsx

import { useState } from 'preact/hooks';

type Vote = 'up' | 'down' | 'flag';
type Category = 'wrong-info' | 'missing-info' | 'irrelevant' | 'tone' | 'other';

interface Props {
  question: string;
  answer: string;
  turnId: string;
  citations?: Array<{ documentId: string; path: string; filename: string }>;
}

export function FeedbackBar({ question, answer, turnId, citations }: Props) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'composing'; vote: 'down' | 'flag'; reason: string; category: Category }
    | { kind: 'sending' }
    | { kind: 'sent' }
  >({ kind: 'idle' });

  async function send(vote: Vote, reason?: string, category?: Category) {
    setState({ kind: 'sending' });
    await fetch('/api/eir/feedback', {     // ← site's own proxy, NOT Trail directly
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vote, question, answer, turnId, citations, reason, category,
        pageUrl: window.location.href,
      }),
    });
    setState({ kind: 'sent' });
  }

  // ... render 👍/👎/🚩 buttons + reason form for down/flag
  // Pattern matches apps/admin/src/panels/chat.tsx FeedbackBar verbatim
}
```

### 2. Server-side proxy `POST /api/eir/feedback`

The widget MUST proxy through the site's server (not call Trail
directly from the browser) — bearer tokens never go to the
front-end. Add a Next.js route:

```ts
// site/src/app/api/eir/feedback/route.ts

import { NextRequest } from 'next/server';

const TRAIL_BASE = process.env.TRAIL_API_BASE!;
const TRAIL_KEY  = process.env.TRAIL_API_KEY!;
const TRAIL_KB   = process.env.TRAIL_KB_ID ?? 'sanne-andersen';

export async function POST(req: NextRequest) {
  const body = await req.json();
  // Light validation — server-side check before paying for the
  // outbound API call. Server-validates vote enum + reason
  // requirement separately, but failing locally saves a round-trip.
  if (!['up', 'down', 'flag'].includes(body.vote)) {
    return Response.json({ error: 'invalid_vote' }, { status: 400 });
  }
  if ((body.vote === 'down' || body.vote === 'flag') && !body.reason?.trim()) {
    return Response.json({ error: 'reason_required' }, { status: 400 });
  }

  const res = await fetch(
    `${TRAIL_BASE}/api/v1/knowledge-bases/${TRAIL_KB}/reader-feedback`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TRAIL_KEY}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return Response.json(
      { error: 'trail_proxy_failed', upstream: text.slice(0, 200) },
      { status: 502 },
    );
  }

  return Response.json(await res.json());
}
```

### 3. Verification — confirm feedback lands in Trail's queue

After deploy, do one of each vote-type on the live `sanneandersen.dk`
Eir chat:

1. **👍 a good answer.** Open admin queue at
   `app.trailmem.com/kb/sanne-andersen/queue`, filter by connector
   `reader-feedback`, verify one new "👍 Positive feedback:
   <question>" row.
2. **👎 with reason "too vague".** Verify "👎 Negative feedback:
   <question>" appears, click into it, verify the candidate body
   has the full Q+A+citations + the curator's reason.
3. **🚩 with reason "potentially harmful claim".** Verify "🚩
   Flagged feedback" appears.

If all three land in the queue with full context: the loop is
closed.

## Edge cases sanne-andersen-cc should handle

| Edge case | Handling |
|---|---|
| User submits 👍 then 👎 on the same turn | OK — both land as separate candidates. The curator sees both signals and can interpret. |
| User opens reason form, types, then navigates away | Lose the draft — these are short reasons, persistence isn't worth the cookie complexity. |
| Trail returns 401 (token revoked) | Show user-facing "Tak — vi har modtaget din feedback" anyway (don't leak infra failures); log the 401 server-side and page on-call. |
| Trail returns 5xx | Same — show success-state to user (degraded gracefully); the proxy logs the 5xx for Christian to triage. |
| Reason text > 2000 chars | Client-side limit at 2000 to match Trail's Zod limit. Either truncate with a tooltip or block-with-counter UI. |

## Bearer token + KB to use

`TRAIL_API_KEY` in sanneandersen's `.env.local` — already exists for
the existing `kb_retrieve` tool integration. Same key works for
reader-feedback (same auth middleware).

`TRAIL_KB_ID=sanne-andersen` — the canonical slug.

## Out-of-scope for this round

- Multi-language feedback UI (just DA for Sanne's audience for now).
- Anonymous-deduping (one widget user could spam 👎 — moderate later
  if it becomes an issue, not now).
- Per-Neuron feedback aggregation (curator manually correlates for
  now; Trail can add UI sugar later once we see how the curator
  actually uses the data).
- Real-time SSE notification to the curator when feedback arrives
  (next-turn enhancement, not blocking).

## Reference implementation

The Trail admin's `FeedbackBar` component in
`apps/admin/src/panels/chat.tsx` is the canonical reference. Lift
the JSX shape + state machine + send logic verbatim; just swap the
`submitReaderFeedback` API call for the site's local `/api/eir/feedback`
proxy.

When stuck: `mcp__buddy__ask_peer({ to: 'trail', message: '...' })`
or grep the admin source. The whole feature is < 200 lines of
TypeScript across the two files.
