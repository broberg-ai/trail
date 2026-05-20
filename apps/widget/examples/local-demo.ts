#!/usr/bin/env bun
/**
 * Local widget demo — serves an HTML page that embeds <trail-chat>
 * + acts as the chat-proxy the widget needs.
 *
 * Two modes, decided by TRAIL_API_KEY env:
 *
 *   - **Real mode**: TRAIL_API_KEY set → /api/chat-proxy/chat
 *     forwards to engine.trailmem.com with that bearer key.
 *     Type a question, get a real grounded answer.
 *
 *   - **Stub mode**: TRAIL_API_KEY missing → /api/chat-proxy/chat
 *     returns a canned response so you can see the widget's UI
 *     (input, bubbles, citations, feedback-buttons) without any
 *     secrets. Useful for "show me what it looks like".
 *
 * Run:
 *   cd apps/widget && npm run build                     # build the bundle
 *   bun run apps/widget/examples/local-demo.ts          # stub mode
 *   TRAIL_API_KEY=trail_live_… TRAIL_KB=sanne-andersen \
 *     bun run apps/widget/examples/local-demo.ts        # real mode
 *
 * Then open http://127.0.0.1:3055/
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3055);
const TRAIL_BASE = process.env.TRAIL_API_BASE ?? 'https://engine.trailmem.com';
const TRAIL_KEY = process.env.TRAIL_API_KEY ?? '';
const TRAIL_KB = process.env.TRAIL_KB ?? 'sanne-andersen';
const REAL_MODE = TRAIL_KEY.length > 0;

const BUNDLE_PATH = join(__dirname, '..', 'dist', 'trail-chat.js');
const HTML_PATH = join(__dirname, 'demo.html');

if (!existsSync(BUNDLE_PATH)) {
  console.error(`Widget bundle missing at ${BUNDLE_PATH}`);
  console.error(`Run: cd ${join(__dirname, '..')} && npm run build`);
  process.exit(2);
}

const html = readFileSync(HTML_PATH, 'utf-8');
const bundle = readFileSync(BUNDLE_PATH);

console.log(`[demo] ${REAL_MODE ? '✓ REAL mode' : '⚠ STUB mode'} (TRAIL_API_KEY ${REAL_MODE ? 'set' : 'missing — answers will be canned'})`);
if (REAL_MODE) {
  console.log(`[demo] engine=${TRAIL_BASE} kb=${TRAIL_KB}`);
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve the demo HTML.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    }

    // Serve the widget bundle locally so the demo works offline.
    if (url.pathname === '/widget.js') {
      return new Response(bundle, {
        headers: { 'Content-Type': 'application/javascript' },
      });
    }

    // Proxy: chat
    if (url.pathname === '/api/chat-proxy/chat' && req.method === 'POST') {
      const body = await req.json() as { message: string; sessionId?: string };

      if (!REAL_MODE) {
        // Stub mode — canned answer demonstrating markdown rendering +
        // citations + feedback buttons.
        return Response.json({
          answer:
            `**Stub answer** for "${body.message}".\n\n` +
            `This is a canned response so you can see the widget's UI ` +
            `without configuring a bearer key. To see real grounded ` +
            `answers, run with \`TRAIL_API_KEY=...\` set.\n\n` +
            `- Bullet points render\n` +
            `- \`inline code\` renders\n` +
            `- [Links](#) render\n\n` +
            `Citations appear below as chips. Try the 👍/👎/🚩 buttons.`,
          citations: [
            { documentId: 'stub-1', path: '/wiki/example-neuron', filename: 'example-neuron.md' },
            { documentId: 'stub-2', path: '/wiki/another-neuron', filename: 'another-neuron.md' },
          ],
          sessionId: body.sessionId ?? `stub-session-${Date.now()}`,
        });
      }

      // Real mode — forward to engine. Strip null/undefined keys
      // because ChatRequestSchema uses .optional() (not .nullable()),
      // so a literal `null` on sessionId crashes Zod with a 500.
      const forwardBody: Record<string, unknown> = {
        knowledgeBaseId: TRAIL_KB,
        message: body.message,
        audience: 'public',
      };
      if (body.sessionId) forwardBody.sessionId = body.sessionId;

      const res = await fetch(`${TRAIL_BASE}/api/v1/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TRAIL_KEY}`,
        },
        body: JSON.stringify(forwardBody),
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Proxy: feedback
    if (url.pathname === '/api/chat-proxy/feedback' && req.method === 'POST') {
      const body = await req.json() as {
        vote: 'up' | 'down' | 'flag';
        turnId?: string;
        answer: string;
        reason?: string;
        citations?: Array<{ documentId: string; path: string; filename: string }>;
      };

      if (!REAL_MODE) {
        console.log(`[demo] STUB feedback: ${body.vote}${body.reason ? ` — "${body.reason}"` : ''}`);
        return Response.json({
          candidateId: `stub-${Date.now()}`,
          status: 'pending',
          queueUrl: '/stub-queue',
        }, { status: 201 });
      }

      // Real mode — forward to engine reader-feedback endpoint.
      // Widget sends abbreviated body; we need to add the question
      // separately. For demo, we send turn-id-only feedback (the engine
      // accepts question/answer/citations; widget doesn't send the
      // original question because feedback fires after answer renders).
      const res = await fetch(
        `${TRAIL_BASE}/api/v1/knowledge-bases/${TRAIL_KB}/reader-feedback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${TRAIL_KEY}`,
          },
          body: JSON.stringify({
            vote: body.vote,
            question: '(widget feedback — original question not echoed)',
            answer: body.answer,
            citations: body.citations,
            reason: body.reason,
            turnId: body.turnId,
            pageUrl: 'http://127.0.0.1:3055/',
          }),
        },
      );
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404 });
  },
});

console.log(`[demo] listening at http://127.0.0.1:${PORT}/`);
