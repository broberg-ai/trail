---
title: The <trail-chat> widget
slug: widget
summary: Drop-in HTML embed for Trail-grounded chat. One script tag + one custom element + a tiny proxy on your server, and you have Pattern A chat on any page.
order: 32
audience: both
category: Patterns
---

The `<trail-chat>` widget is Trail's turnkey Pattern A surface — a
self-contained ESM bundle hosted at
`https://widget.trailmem.com/v1/trail-chat.js` that any HTML page
can embed in two lines. No framework required, no build step,
no CSS conflicts (the widget renders in shadow DOM).

If you want grounded chat over a Trail KB and you don't need the
multi-tool composition of [Pattern C](/site-llm-with-trail-as-tool/),
this is the path.

## The embed

```html
<script type="module"
  src="https://widget.trailmem.com/v1/trail-chat.js"></script>

<trail-chat
  api="/api/chat-proxy"
  theme="auto"
  height="600px"></trail-chat>
```

That's it. The widget renders an input + answer-log panel inside
the `<trail-chat>` element. Citations show under each answer.
👍/👎/🚩 feedback buttons close the loop into Trail's curator queue.

## Why a proxy?

The `api` attribute points at **your server**, not at
`engine.trailmem.com`. The widget POSTs to `${api}/chat` and
`${api}/feedback`; your server forwards to Trail with the bearer
token attached server-side.

**Why not let the widget speak to Trail directly?** Three reasons:

1. **Token safety**: a Trail bearer key in a browser-visible
   attribute leaks across page-source, browser-extensions, server
   logs, and screen-shares. Server-side proxy keeps the token where
   only your infra sees it.
2. **Rate-limiting + abuse control**: your proxy is where you
   throttle aggressive callers, deny known abusers, and add IP-level
   guards. Trail's engine has its own rate limits but they apply
   per-token, not per-end-user.
3. **Logging + analytics**: chats your end-users have are your
   data; the proxy is where you record + analyse, not Trail.

Building the proxy is a 20-line Next.js route. Example below.

## Next.js proxy example

Three files for a complete Pattern A setup on a Next.js site:

### 1. Environment

```bash
# .env.local
TRAIL_API_BASE=https://engine.trailmem.com
TRAIL_API_KEY=trail_live_…    # from app.trailmem.com/settings → API Keys
TRAIL_KB=your-kb-slug
```

### 2. Chat proxy

```typescript
// app/api/chat-proxy/chat/route.ts

import { NextRequest } from 'next/server';

const TRAIL_BASE = process.env.TRAIL_API_BASE!;
const TRAIL_KEY = process.env.TRAIL_API_KEY!;
const TRAIL_KB = process.env.TRAIL_KB!;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message: string = body.message;
  const sessionId: string | undefined = body.sessionId;

  if (!message?.trim()) {
    return Response.json({ error: 'message required' }, { status: 400 });
  }

  const res = await fetch(`${TRAIL_BASE}/api/v1/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TRAIL_KEY}`,
    },
    body: JSON.stringify({
      knowledgeBaseId: TRAIL_KB,
      message,
      sessionId,
      audience: 'public',  // tone-tuned for end-user chat
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return Response.json(
      { error: 'trail_upstream', detail: text.slice(0, 200) },
      { status: 502 },
    );
  }

  return Response.json(await res.json());
}
```

### 3. Feedback proxy

```typescript
// app/api/chat-proxy/feedback/route.ts

import { NextRequest } from 'next/server';

const TRAIL_BASE = process.env.TRAIL_API_BASE!;
const TRAIL_KEY = process.env.TRAIL_API_KEY!;
const TRAIL_KB = process.env.TRAIL_KB!;

export async function POST(req: NextRequest) {
  const body = await req.json();
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
      { error: 'trail_upstream', detail: text.slice(0, 200) },
      { status: 502 },
    );
  }

  return Response.json(await res.json());
}
```

Then embed with `api="/api/chat-proxy"` and you're done.

## Attributes

| Attribute | Default | Purpose |
|---|---|---|
| `api` | _(required)_ | Base URL of your chat-proxy. Widget POSTs to `${api}/chat` and `${api}/feedback`. |
| `theme` | `auto` | `light`, `dark`, or `auto` (follows `prefers-color-scheme`). |
| `height` | `600px` | CSS height of the widget panel. |
| `placeholder` | `Ask anything…` | Input placeholder text. |
| `cite-format` | `inline` | `inline` (citations under each answer), `footnote` (numbered + bibliography at end), or `off` (no citations rendered). |

## Custom events

The widget dispatches three bubble + composed events your page can
listen for:

| Event | Detail |
|---|---|
| `trail-chat:ready` | Widget rendered + connected. Listen on `window` or any ancestor. |
| `trail-chat:answer` | `{ question, answer, citations }` — full answer received. |
| `trail-chat:error` | `{ message }` — fetch failed; user sees inline error in widget. |

Example:

```javascript
document.querySelector('trail-chat').addEventListener('trail-chat:answer', (e) => {
  // Track answers in your analytics:
  analytics.track('trail_chat_answer', {
    question: e.detail.question.slice(0, 80),
    citationCount: e.detail.citations?.length ?? 0,
  });
});
```

## Versions

| URL | Status |
|---|---|
| `widget.trailmem.com/v1/trail-chat.js` | Current stable. ~26 kB gzipped. |

Versioned URLs mean breaking changes ship at `/v2/` without breaking
embedded sites — your `<script>` tag keeps pointing at `/v1/`
until you choose to migrate.

## What the widget is NOT

- **Not a proxy-replacement.** The widget speaks ONLY to your proxy.
  It will not work with `api="https://engine.trailmem.com/api/v1"` —
  bearer tokens belong server-side.
- **Not a CMS.** It doesn't manage Sources, edit Neurons, or expose
  the curator queue. Those live in the admin at `app.trailmem.com`.
- **Not chat history persistence.** The widget keeps the current
  session in memory; reload = empty. If you want persistent history
  per end-user, pass `sessionId` from your proxy (Trail's chat API
  honours it).
- **Not custom theming beyond light/dark.** Rich theming is a Phase 2
  feature; for now the widget matches `prefers-color-scheme` and
  uses Trail's accent colour. Override by wrapping in your own CSS
  custom-property scope: `--tc-accent`, `--tc-bg`, `--tc-fg`, etc.

## Where to go next

- [Reader feedback](/reader-feedback/) — what the 👍/👎/🚩 buttons do
  and how the curator sees results in their queue.
- [A site-LLM with Trail as a tool](/site-llm-with-trail-as-tool/) —
  Pattern C, the more powerful alternative when you need multi-tool
  composition (booking, calendar, catalog) alongside chat.
- [Quick start](/quick-start/) — five-step integration including
  the bearer-token setup the proxy uses.
