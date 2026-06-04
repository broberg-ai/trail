import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { captureException } from '@upmetrics/sdk';
import { requireAuth, getTenant } from '../middleware/auth.js';
import { broadcaster, type BroadcastEvent } from '../services/broadcast.js';

export const streamRoutes = new Hono();

streamRoutes.use('*', requireAuth);

/**
 * SSE connection guards (2026-06-04 saturation incident).
 *
 * Root cause: the admin proxy didn't abort the proxy→engine fetch when a
 * browser SSE disconnected, so engine-side stream handlers leaked — each held a
 * request slot against Fly's `hard_limit = 100`. Tabs + EventSource reconnects +
 * rolling deploys accumulated orphaned streams until the engine saturated and
 * Fly reported "no healthy instances" (total outage) on ~zero real traffic.
 *
 * The proxy now aborts on disconnect (the real fix). These guards make the
 * failure CLASS impossible to recur regardless of any future leak source:
 *   - MAX_STREAMS: hard cap well under Fly's hard_limit — excess connections are
 *     shed with a clean 503 instead of silently piling toward saturation.
 *   - MAX_LIFETIME: every stream self-closes; an orphaned one frees its slot
 *     within the window (EventSource just reconnects → fresh slot).
 *   - WARN watermark → upmetrics: we SEE accumulation early, not 7 min after
 *     death via the external uptime probe.
 */
const MAX_STREAMS = 60; // Fly hard_limit is 100; keep ≥40 slots for normal API.
const WARN_STREAMS = 35;
const MAX_LIFETIME_MS = 30 * 60_000; // 30 min; client auto-reconnects.

let activeStreams = 0;

streamRoutes.get('/stream', (c) => {
  const tenant = getTenant(c);

  // Load-shed BEFORE opening another long-lived connection. A clean 503 keeps
  // the engine responsive; EventSource retries shortly. Never accumulate toward
  // the Fly hard_limit.
  if (activeStreams >= MAX_STREAMS) {
    captureException(new Error(`SSE stream cap reached (${activeStreams}/${MAX_STREAMS}) — shedding`), {
      tags: { area: 'sse', tenant: tenant.id },
    });
    return c.json({ error: 'too many open streams, retry shortly' }, 503);
  }

  return streamSSE(c, async (stream) => {
    activeStreams += 1;
    if (activeStreams === WARN_STREAMS) {
      // Early signal: accumulation is climbing toward the cap. Surfaces in
      // upmetrics so we act before it ever becomes an outage.
      captureException(new Error(`SSE streams at watermark ${activeStreams}/${MAX_STREAMS}`), {
        tags: { area: 'sse', tenant: tenant.id },
      });
    }

    let id = 0;
    let expired = false;
    const queue: BroadcastEvent[] = [];
    let resolveWait: (() => void) | null = null;

    const push = (event: BroadcastEvent): void => {
      if ('tenantId' in event && event.tenantId !== tenant.id) return;
      queue.push(event);
      resolveWait?.();
    };

    const unsubscribe = broadcaster.subscribe(push);
    stream.onAbort(() => {
      unsubscribe();
      resolveWait?.();
    });

    const pinger = setInterval(() => push({ type: 'ping' }), 30_000);
    // Bounded lifetime — guarantees the slot is freed even if abort never fires.
    const lifeTimer = setTimeout(() => { expired = true; resolveWait?.(); }, MAX_LIFETIME_MS);

    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'hello', tenantId: tenant.id }),
        event: 'hello',
        id: String(id++),
      });

      while (!stream.aborted && !expired) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
          });
          resolveWait = null;
          continue;
        }
        const event = queue.shift()!;
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
          id: String(id++),
        });
      }
    } finally {
      clearInterval(pinger);
      clearTimeout(lifeTimer);
      unsubscribe();
      activeStreams = Math.max(0, activeStreams - 1);
    }
  });
});
