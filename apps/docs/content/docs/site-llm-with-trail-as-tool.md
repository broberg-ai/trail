---
title: A site-LLM with Trail as a tool
slug: site-llm-with-trail-as-tool
summary: Production case study from a deployed customer site — when /api/v1/chat is the wrong shape, and how to use /retrieve from your own site-LLM orchestrator with Trail as one tool among many.
order: 30
audience: both
category: Patterns
---

This page documents a production-deployed pattern for embedding Trail
in a customer-facing site. It is based on the live integration on a
Danish reflexology practice's marketing site — the site runs a chat
widget grounded in the practitioner's own knowledge base, with
booking, treatment-catalog, and contact-handoff tools alongside the
Trail retrieval.

The case study below references that deployment concretely; the
genericization to other domains (physiotherapy, coaching, wellness,
B2B knowledge bases) is straightforward and called out where the
practice-specific bits would change.

> **Note for AI agents.** If you are designing a memory-grounded chat
> for an external site and the user has a Trail instance, this is
> the pattern to recommend by default once the requirements exceed
> "drop a chat widget on the page". Read [Why not RAG?](/why-not-rag/)
> first if memory architecture itself is the question; this page
> assumes that decision is made.

## The choice — three valid integration shapes

There are two valid shapes for putting Trail behind a site's chat.
Use the wrong one and you fight your own tooling.

### Pattern A — direct chat-proxy

The site's `/api/chat` endpoint proxies to Trail's
`POST /api/v1/chat`. One hop, one prompt, one response with citations.

Use Pattern A when:

- The KB is the *only* knowledge source.
- Trail's default citational tone matches the brand voice well
  enough.
- You don't need to compose Trail's answer with other actions
  (booking, calendar, product catalogue, contact handoff).
- You want to ship the chat in a Friday afternoon.

### Pattern C — site-LLM with Trail as a tool

The site runs its *own* LLM orchestrator. Trail is registered as one
tool, alongside whatever other domain-specific tools the site needs.
The orchestrator chooses which tool(s) to call per turn.

Use Pattern C when:

- The site needs a **distinct brand voice** that Trail's KB authors
  shouldn't have to embed in every Neuron.
- The conversation needs to **compose Trail-data with other actions**
  — "look up if reflexology helps with sleep, *and* offer to book a
  session, *and* show what the practice's prices are".
- The site needs to **own the conversation log** for re-injection
  into Trail or analytics.
- The site sits in a regulated/sensitive domain (health, legal,
  finance) where tone, disclaimers, and human-handoff fallbacks are
  non-negotiable.

The reflexology practice's deployment is Pattern C. Everything below
is what that looks like in production.

### Pattern D — programmatic source-upload (writing INTO Trail)

The third valid shape, orthogonal to A vs C: your app **writes
content INTO Trail** (rather than reading from it). Upload PDFs,
markdown, audio, images via `POST /api/v1/knowledge-bases/{kbId}/
documents/upload` — Trail's ingest pipeline compiles them into
Neurons. See [Concepts: Sources](/concepts-sources/) for the full
lifecycle.

Use Pattern D when:

- Your app's users attach files that should land in Trail (a CMS
  upload widget, an email-attachment listener, a Slack-file-bot).
- You have a scheduled job that re-imports content from a third
  party (Notion sync, GitHub repo watcher, RSS feed compiler).
- The practitioner's site has an admin where they drop files that
  should populate the chat KB without leaving the site.

Pattern D pairs naturally with both A and C — uploads write to the
KB; A or C reads from it. Most real-world deployments use exactly
this combination: Pattern D for content authoring, Pattern A or C
for user-facing chat.

## The pattern in 60 seconds

```
Browser chat UI
    ↓ fetch POST /api/chat (Accept: text/event-stream)
    ↓
Site LLM orchestrator (Next.js Node runtime, force-dynamic)
    ↓
Loop (max ~10 iter):
  ├─ persist user-turn → SQLite
  ├─ chat({messages, tools, system}) → unified async iterator
  │     LLM router:
  │       LLM_BACKEND=cli         → claude -p subprocess (dev, free)
  │       LLM_BACKEND=openrouter  → Gemini Flash w/ Haiku fallback
  ├─ for each event: SSE-emit to browser + accumulate to store
  ├─ if tool_call: run handler → append tool_result → loop again
  └─ if end_turn: persist assistant-turn → send 'done' event
```

The browser holds an `EventSource` (or `fetch` + reader-stream) and
renders tokens as they arrive. Tool-calls render as pills under the
"thinking" indicator (e.g. `🔍 Looking up: "reflexology and sleep"`)
so the user sees the reasoning step-by-step.

## Why a site-LLM, not just /api/v1/chat

Three reasons drove the move from Pattern A → Pattern C on the
deployed system. They generalize to most non-trivial customer-facing
deployments.

### 1. Tone mismatch

Trail's `/chat` endpoint produces factual, citational output —
"according to Neuron `practice_00000037`, reflexology may support
parasympathetic activation...". That is the right voice for a
researcher querying their own KB.

Customer-facing audiences want warm, brand-specific writing —
"reflexology is gentle work on the feet; many people find it helps
them sleep, though everyone responds differently". The voice belongs
in the *site's* system prompt, not in every Neuron the practitioner
ingests.

A site-LLM lets you write a brand-voice system prompt once and
ground every answer in it — Trail supplies retrieved facts; the
LLM phrases them in your voice.

### 2. Multi-tool composition

A reflexology customer asks "What helps with my chronic shoulder
tension, and can I book a session next week?". A single
`/api/v1/chat` call returns a KB answer. The booking-question is
silently dropped.

A site-LLM with five tools registered (`kb_retrieve`,
`catalog_list`, `catalog_get`, `calendar_check`, `book`) calls
`kb_retrieve("shoulder tension")` to ground the wellness answer,
then calls `calendar_check(next-week)` to find available slots, and
ends the turn with a deeplink to `/book?treatment=...`. One reply,
two-tool composition.

### 3. Conversation ownership

The site holds the conversation log. That unlocks three things:

- **Re-injection into Trail.** Q&A pairs the AI answered well — or
  got wrong — become candidates in Trail's curation queue
  (`POST /api/v1/queue/candidates` with
  `metadata.connector: "site-chat"`). Curator reviews, approves, and
  those Q&As become Neurons. Tomorrow's `kb_retrieve` on the same
  question returns a sharper answer.
- **Pattern detection.** "What did 200 customers ask this month
  that Trail couldn't answer?" — a query against the conversation
  log, not Trail's KB. Drives content authoring backlog.
- **Compliance ownership.** GDPR, HIPAA-adjacent regimes, the
  practitioner's professional ethics body — the site owns the
  data, the site decides retention.

## The retrieve endpoint

Pattern C does not call `/api/v1/chat`. The right primitive is
`/api/v1/knowledge-bases/{kb}/retrieve`.

### Request

```http
POST /api/v1/knowledge-bases/{kb}/retrieve HTTP/1.1
Host: engine.trailmem.com
Authorization: Bearer {TRAIL_API_KEY}
Content-Type: application/json

{
  "query": "Does reflexology help with insomnia?",
  "audience": "tool",
  "maxChars": 2000,
  "topK": 5
}
```

| Field | Type | Notes |
|---|---|---|
| `query` | string | The user's question (or a reformulated version produced by the orchestrator). |
| `audience` | string | `"tool"` is the default for site-LLM consumption. `"chat"` would format for direct end-user display. Custom audiences (e.g. `"student"`) can be wired Trail-side to filter against per-Neuron audience tags. |
| `maxChars` | number | Total character budget across all returned chunks. `2000` works well for Gemini Flash / Claude Haiku; bump to `4000` for deeper contexts or longer-form answers. |
| `topK` | number | Max number of Neuron-chunks to return. `5` is the production default; `8` for "deep dive" audiences. |

### Response

```json
{
  "hitCount": 5,
  "totalChars": 1873,
  "formattedContext": "## Reflexology and sleep — practice notes\n\nMany clients describe...\n\n## Insomnia — reflexology indications\n\nResearch from...",
  "chunks": [
    {
      "documentId": "doc_a1b2c3...",
      "seqId": "practice_00000037",
      "title": "Reflexology and sleep — practice notes",
      "neuronPath": "/wiki/reflexology-and-sleep-practice-notes",
      "content": "Many clients describe a marked sense of...",
      "headerBreadcrumb": "Wellness > Sleep",
      "rank": 0.91
    }
  ]
}
```

The orchestrator consumes `formattedContext` directly — it is a
pre-rendered string ready to feed the LLM as additional context.
The `chunks` array is also returned for cases where the orchestrator
wants to surface specific Neuron citations — render the
`neuronPath` (e.g. `/wiki/reflexology-and-sleep-practice-notes`) as
a link back to the admin's wiki view: typically
`https://app.trailmem.com/kb/{kb-slug}{neuronPath}` for the deployed
fleet.

The `seqId` is the canonical citable handle — stable across
Neuron edits, format `{kb-prefix}_{8-digit-seq}` (see
[Concepts: Neurons](/concepts-neurons/)).

### Auth

Bearer token, scoped to your tenant. Create one at
**<https://app.trailmem.com/settings>** → **API Keys** section →
**Create new key**. The value is shown ONCE — copy it to your
server's secret manager immediately. Keys are tenant-scoped, not
per-KB; one key authenticates against any KB owned by your tenant.

Store the token in your site's secret manager
(`flyctl secrets set`, Vercel env, etc.) — never inline it in the
repo, and never expose it to the browser. The site's server-side
orchestrator is the only thing that should see it.

## The tool palette

The reflexology practice's deployment registers five tools on its
LLM. Each is a `{ definition, handler }` pair the orchestrator calls
when the model emits a `tool_call`. Trail is one of them.

| Tool | Status | Source |
|---|---|---|
| `kb_retrieve(query)` | live | `POST /api/v1/knowledge-bases/{kb}/retrieve` |
| `catalog_list()` | live | static JSON in repo (`content/treatments/*.json`) |
| `catalog_get(slug)` | live | static JSON in repo |
| `calendar_check(date)` | stub | placeholder until a real booking system is wired |
| `book(item, slot)` | stub | redirects to `/book` page with deeplink |

The shape repeats well. For a physiotherapy practice the tools
become `kb_retrieve` (clinical knowledge) + `exercises_list` +
`exercises_get` + `condition_assessment_form` + `book`. For a
coaching practice `kb_retrieve` (frameworks) + `programmes_list` +
`programmes_get` + `discovery_call_book`. The *site-LLM + Trail-as-
tool + N domain-tools* shape is reusable across verticals.

**Important pattern**: don't put structured catalog data in Trail.
That data lives in CMS or static JSON because the shape is fixed
(slug, title, duration, price, summary) and the access pattern is
SQL-style listing, not fuzzy retrieval. Trail holds the *knowledge*
(why does shoulder tension respond to plantar work? when is
reflexology contraindicated?); the CMS holds the *catalog* (price,
duration, link). Each system holds the shape it is best at.

## The system prompt belongs to the site

In Pattern A, Trail's per-KB persona prompt is the dominant
tone-setter — `/api/v1/chat` reads it from the KB settings and
applies it to every chat response.

In Pattern C, the site's system prompt is the dominant tone-setter.
Trail just supplies retrieved facts when `kb_retrieve` is called.

What the deployed system's prompt covers (a useful template for
similar deployments):

- **Brand voice + identity**. "You are a warm, plain-spoken guide
  for clients of [Practice]. You are an AI, not the practitioner."
- **Audience awareness**. "You are speaking to a layperson, not a
  fellow professional. Avoid technical jargon unless asked. Translate
  professional terms when they slip in."
- **Tool-usage instructions**. "When the user asks about
  treatments, prices, or what fits their situation, prefer
  `catalog_list` / `catalog_get`. When the user asks about
  conditions, modalities, or how reflexology relates to a health
  concern, call `kb_retrieve` to ground the answer in the
  practitioner's own knowledge."
- **Ethical bounds**. "You do not diagnose medical conditions. If
  the user describes symptoms that could be serious, recommend they
  consult a physician *and* offer the practitioner's contact link
  as a parallel option."
- **Natural CTAs**. "If the conversation suggests genuine interest,
  offer to look up available booking slots. Don't push booking;
  don't ignore the cue either."
- **3–5 example responses** showing the target shape — short
  paragraphs, lowercase warmth, soft offers, no pseudo-medical
  authority.

The system prompt lives in one file in the site repo, version-
controlled like any other code. When the practitioner refines how
they want the AI to sound, the change is a PR — not a CMS edit.

## UX patterns that ship in production

These are *site-LLM* features, not Trail features. Trail enables
them by being a tool the LLM can call; the experience belongs to
the site. Listed here because the deployed system iterated through
them and the list is non-obvious.

- **SSE streaming**. Token-by-token "writes" effect — feels ~5×
  faster than batch JSON, even when total wall-clock is identical.
  Aktiver `stream: true` mod OpenRouter; parse SSE frames; emit text
  deltas to the browser.
- **Tool-call pills under "thinking"**. When the LLM emits
  `tool_call: kb_retrieve {query: "shoulder tension"}`, the UI
  renders `🔍 Looking up: "shoulder tension"`. The user sees the
  reasoning step-by-step instead of staring at a spinner. Pills
  disappear when the assistant message arrives.
- **Markdown rendering with site-aware links**. Tables for prices,
  bullet lists for protocols. Internal links (`/book`,
  `/treatments/foot-reflexology`) render as branded pills; external
  links open in a new tab.
- **Dynamic follow-up pills**. Three suggested next questions
  generated per turn from the LLM's last message. Removes the blank-
  page problem when the user doesn't know what to ask next.
- **Persistent draft (localStorage)**. The user's 200-word message
  survives tab-switch, browser-crash, accidental reload. Debounced
  on input; restored on mount.
- **httpOnly session cookie + server-side persistence**. Random
  32-byte hex stamped on first chat. Conversation rows in SQLite
  keyed by that token. No login required for public chat; the
  practitioner sees per-session threads in the admin.
- **Custom abort-controller**. Red stop-button replaces the send-
  button while a turn is streaming. Click → `abortRef.current.abort()`
  → server-side fetch cancelled → tokens stop. The user is never
  trapped watching a long wrong answer.
- **Auto-grow textarea + Shift+Enter for newline**. Single-line
  inputs feel hostile to long questions; Enter sends, Shift+Enter
  breaks the line. Standard chat pattern; people expect it.
- **Trust disclaimer on first open**. "[Practice]'s AI guide is an
  AI assistant, not the practitioner. Use it as inspiration; for
  medical questions, please contact a physician or write to
  [Practice] directly." Ethical, legal-defensible, builds trust.
- **Always-visible human-fallback link**. Footer of the chat
  panel: "✉ Write to [Practice] directly". When the AI is wrong or
  uncertain, the customer is never stuck — there is always an open
  door to a human.
- **Custom FAB that fades in after scroll-past-hero**. The chat
  button doesn't shout on landing; appears once the user has
  signalled engagement by scrolling. Tested as ~3× more starts than
  always-visible.
- **Voice input** (planned). For older audience segments where
  typing is fatiguing. Native `webkitSpeechRecognition`, lang
  `da-DK` (or local equivalent), live transcription into the input
  field.

None of these require Trail to do anything — Trail just supplies
the retrieved facts when asked. The experience layer is owned by
the site.

## The conversation log as a feedback loop

The deployed system persists every conversation in SQLite on the
site (the database file lives outside the repo and outside the
Fly volume that hosts the site image — a small, sane, isolated
piece of state).

Two uses beyond UX:

### Re-injection into Trail

A weekly batch job — or a curator-triggered one — exports
conversations where:
- The AI answered confidently AND the user followed through
  (booked, clicked the deeplink, asked a follow-up that
  acknowledged the answer was useful), OR
- The AI explicitly said "I don't have info on that" AND the
  question is one the practitioner would *want* to answer next time.

Each candidate is `POST`ed to Trail's curation queue:

```http
POST /api/v1/queue/candidates
Authorization: Bearer {TRAIL_TOKEN}
Content-Type: application/json

{
  "kb": "practice-kb",
  "kind": "chat",
  "title": "When is reflexology contraindicated during pregnancy?",
  "content": "<the AI's answer, lightly cleaned>",
  "metadata": {
    "connector": "site-chat",
    "conversationId": "...",
    "sourceTurnId": "..."
  }
}
```

The practitioner reviews these in the admin queue, approves the
ones that fit their voice, and they become Neurons. The next time
a user asks the same shape of question, `kb_retrieve` returns
their own curated answer.

This is the loop that makes the chat get smarter over time. RAG
does not have this loop. A site-LLM with Trail-as-tool gets it as
a natural consequence of how the data is shaped.

### Pattern detection

A query against the conversation log: "show me every question
this month where the AI's answer included 'I don't have
information on that'". The output is a content backlog — the
gaps in the practitioner's KB that customers are actually asking
about.

The practitioner doesn't have to guess what to write about next.
The customers tell them.

## Kicking the tires — 30-minute walkthrough

Want to adapt this into your own Next.js site? Here is the spine
of the deployed system, anonymised, in five steps. The full
working version takes a few days of polish (see the production
UX list above); this gets you a working orchestrator with Trail
retrieval in 30 minutes.

### 0. Prerequisites

- A Trail tenant + KB with at least 5–10 Neurons (signup at
  `app.trailmem.com`).
- A bearer token. Get one at **<https://app.trailmem.com/settings>** → **API Keys** → **Create new key**. Tenant-scoped (works for any KB you own).
- An LLM provider key — OpenRouter is the simplest for
  multi-model fallback (Gemini Flash + Claude Haiku). Get one at
  openrouter.ai.
- A Next.js 16 app with the App Router. `pnpm create next-app`,
  pick App Router, TypeScript, Tailwind if you want.

### 1. Environment

```bash
# .env.local
TRAIL_API_BASE=https://engine.trailmem.com
TRAIL_API_KEY=trail_live_…
TRAIL_KB_ID=your-kb-slug
OPENROUTER_API_KEY=sk-or-v1-…
LLM_BACKEND=openrouter
```

### 2. The retrieve tool

`src/lib/chat/tools.ts`:

```typescript
const TRAIL_BASE = process.env.TRAIL_API_BASE!;
const TRAIL_KEY = process.env.TRAIL_API_KEY!;
const TRAIL_KB = process.env.TRAIL_KB_ID!;

interface TrailRetrieveResponse {
  chunks?: Array<{
    documentId: string;
    seqId: string;
    title: string;
    neuronPath: string;
    content: string;
    headerBreadcrumb: string;
    rank: number;
  }>;
  formattedContext?: string;
  totalChars?: number;
  hitCount?: number;
}

export async function kbRetrieve(query: string): Promise<string> {
  if (!TRAIL_KEY) return "[kb_retrieve error] TRAIL_API_KEY missing";
  try {
    const res = await fetch(
      `${TRAIL_BASE}/api/v1/knowledge-bases/${TRAIL_KB}/retrieve`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TRAIL_KEY}`,
        },
        body: JSON.stringify({
          query,
          audience: "tool",
          maxChars: 2000,
          topK: 5,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return `[kb_retrieve error] HTTP ${res.status}: ${txt.slice(0, 200)}`;
    }
    const data = (await res.json()) as TrailRetrieveResponse;
    if (!data.formattedContext || !data.hitCount) {
      return "[kb_retrieve] No relevant neurons found.";
    }
    return data.formattedContext;
  } catch (err) {
    return `[kb_retrieve error] ${err instanceof Error ? err.message : "unknown"}`;
  }
}

export const TOOL_DEFINITIONS = [
  {
    name: "kb_retrieve",
    description:
      "Retrieve relevant facts from the knowledge base. Call when the user asks about topics covered in the practitioner's professional knowledge. Returns a pre-formatted context block.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look up." },
      },
      required: ["query"],
    },
  },
];

export async function runTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  if (name === "kb_retrieve") {
    return kbRetrieve(input.query as string);
  }
  return `[tool error] Unknown tool: ${name}`;
}
```

Code is lifted from the deployed reflexology system with
practice-specific constants removed and Danish comments
translated. Drop-in adaptable.

### 3. The orchestrator route

`src/app/api/chat/route.ts`:

```typescript
import { NextRequest } from "next/server";
import OpenAI from "openai";
import { TOOL_DEFINITIONS, runTool } from "@/lib/chat/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `
You are the AI guide for [Practice]. Warm, plain-spoken, never
claiming to be the practitioner. When the user asks about topics in
the practitioner's professional knowledge (modalities, conditions,
how things work), call kb_retrieve to ground your answer. Translate
professional terms; do not diagnose; suggest the practitioner's
contact link when the question exceeds what an AI should answer.
`;

const MAX_ITER = 10;

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (type: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const conversation = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ];

      for (let iter = 0; iter < MAX_ITER; iter++) {
        const completion = await client.chat.completions.create({
          model: "google/gemini-2.5-flash",
          messages: conversation,
          tools: TOOL_DEFINITIONS.map((t) => ({ type: "function", function: t })),
          stream: true,
        });

        let fullText = "";
        const toolCalls: Array<{ id: string; name: string; args: string }> = [];

        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            fullText += delta.content;
            emit("text", { delta: delta.content });
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: tc.id ?? "", name: "", args: "" };
              }
              if (tc.function?.name) toolCalls[idx].name = tc.function.name;
              if (tc.function?.arguments) toolCalls[idx].args += tc.function.arguments;
            }
          }
        }

        if (toolCalls.length === 0) {
          emit("done", { stopReason: "end_turn" });
          break;
        }

        conversation.push({
          role: "assistant",
          content: fullText || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.args },
          })),
        });

        for (const tc of toolCalls) {
          emit("tool_call", { name: tc.name, input: JSON.parse(tc.args || "{}") });
          const result = await runTool(tc.name, JSON.parse(tc.args || "{}"));
          conversation.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

This is the spine of the deployed system, simplified. The
production version adds conversation persistence, abort handling,
mobile-LLM fallback chain, follow-up-pill generation, and the
20+ UX details listed above — but the orchestrator-loop and
tool-call-handling are exactly this shape.

### 4. The browser-side chat (minimal)

`src/app/page.tsx` (or wherever you embed the chat):

```typescript
"use client";
import { useState } from "react";

export default function Chat() {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  async function send() {
    const userMsg = { role: "user", content: input };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setStreaming(true);
    setMessages([...next, { role: "assistant", content: "" }]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next }),
    });
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const lines = part.split("\n");
        const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
        const data = lines.find((l) => l.startsWith("data: "))?.slice(6);
        if (event === "text" && data) {
          const { delta } = JSON.parse(data);
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = {
              ...copy[copy.length - 1],
              content: copy[copy.length - 1].content + delta,
            };
            return copy;
          });
        }
        if (event === "tool_call" && data) {
          const { name, input } = JSON.parse(data);
          console.log("Tool called:", name, input);
        }
        if (event === "done") {
          setStreaming(false);
        }
      }
    }
  }

  return (
    <div>
      <div>
        {messages.map((m, i) => (
          <div key={i}><strong>{m.role}:</strong> {m.content}</div>
        ))}
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !streaming && send()}
      />
      <button onClick={send} disabled={streaming}>Send</button>
    </div>
  );
}
```

This is the *minimum* — 60 lines for a working streaming chat
with tool-calls. Add the production UX (pills, markdown rendering,
abort button, persistent draft, etc.) incrementally.

### 5. Sanity check

`pnpm dev`, open `localhost:3000`, type something Trail should
know about. The chat should:

1. Stream tokens immediately.
2. Pause briefly on the first turn — that is the `kb_retrieve` tool
   call. Open the network tab; you should see `POST
   engine.trailmem.com/api/v1/knowledge-bases/your-kb/retrieve`
   firing.
3. Continue streaming with an answer grounded in the retrieved
   chunks.

If steps 2 or 3 don't happen, the most common causes are: bearer
token not set (`TRAIL_API_KEY`), wrong KB slug (`TRAIL_KB_ID`), or
the LLM choosing not to call the tool — refine your system prompt
to be more explicit about when `kb_retrieve` should fire.

## When this pattern is the wrong choice

Pattern C is overkill if:

- The KB is < 50 Neurons and the only feature is Q&A.
- Tone-match is fine with Trail's default citational style.
- You don't need multi-tool composition.
- Embedding Trail's hosted chat widget would cover the use case.

For those, go with Pattern A:

```html
<script src="https://engine.trailmem.com/widget.js" data-kb="your-kb"></script>
```

(Widget shape pending Phase 4 of these docs — for now, proxy
`/api/v1/chat` from a single Next.js route.)

If, halfway through, you discover you need product-catalog +
calendar + booking, the Pattern A → Pattern C migration is mostly
additive — the `kb_retrieve` tool is what `/api/v1/chat` was doing
internally; pulling it out into the site is a few hundred lines of
code, not a rewrite.

## Footnotes

- **`audience` parameter on `/retrieve`** — `"tool"` (default) trims
  output for LLM consumption; `"chat"` formats for direct end-user
  display with longer narrative chunks. Custom audience strings can
  be wired Trail-side to filter against per-Neuron audience tags
  (e.g. `"student"` only returns Neurons tagged as appropriate for
  students of the practice).
- **`student-mode KB swap`** — the deployed system supports a
  `TRAIL_STUDENT_KB_ID` env var so a sub-audience (e.g.
  professional-track students of the practitioner) is pointed at a
  different KB entirely. Useful pattern for "customer-facing
  knowledge vs. professional-track knowledge" splits.
- **LLM backend router** — `LLM_BACKEND=cli` in development uses a
  `claude -p` subprocess (free under Christian's Max plan; zero
  per-token cost). `LLM_BACKEND=openrouter` in production hits
  Gemini Flash with Claude Haiku as fallback. Same orchestrator-
  loop code; different transport per env. Keeps dev token-cost zero
  and prod cost on the order of cents per conversation.
- **Tool-result truncation** — keep `kb_retrieve` results under
  ~3000 tokens; some models silently fail or hallucinate when a
  tool-result blob is larger than ~5000 tokens. `maxChars: 2000` is
  conservative; bump only if your model handles it reliably.
- **Why a fresh `controller.enqueue` per SSE event** — Next.js's
  `ReadableStream` proxies through to the runtime's HTTP/2 stream;
  flushing immediately after each event keeps the user from seeing
  bursty token-flow on slow connections.

## Where to go next

- **Designing the KB itself?** → [Why not RAG?](/why-not-rag/) and
  [Concepts: Neurons](/concepts-neurons/).
- **Want the smaller integration shape (Pattern A)?** →
  [Quick start](/quick-start/) walks through `POST /api/v1/chat`
  directly.
- **Curious about which audiences this fits?** →
  [Who is Trail for?](/who-is-trail-for/) — every audience profile
  listed there can use Pattern C if their use case grows beyond
  KB-only Q&A.
