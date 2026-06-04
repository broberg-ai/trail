import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { captureException } from '@upmetrics/sdk';
import { requireAuth, getTenant } from '../middleware/auth.js';
import { broadcaster, type BroadcastEvent } from '../services/broadcast.js';

export const streamRoutes = new Hono();

streamRoutes.use('*', requireAuth);

/**
 * SSE connection guards + GC (2026-06-04 saturation incident).
 *
 * Root cause: the admin proxy didn't abort the proxy→engine fetch when a
 * browser SSE disconnected, so engine-side stream handlers leaked — each held a
 * request slot against Fly's `hard_limit = 100`. On ~zero traffic, tabs +
 * EventSource reconnects + rolling deploys accumulated orphaned streams until
 * the engine saturated → Fly "no healthy instances" (total outage).
 *
 * Three independent guarantees so the failure CLASS can't recur:
 *   - MAX_STREAMS: synchronous hard cap (well under Fly's 100) — excess is shed
 *     with a clean 503, never queued toward saturation.
 *   - CONNECTION GC: a single module-level reaper runs every REAP_INTERVAL_MS
 *     and force-closes any stream past MAX_LIFETIME — ACTIVELY, not relying on
 *     each stream's own loop being responsive or its abort having fired. This is
 *     the "continuous garbage collection" of connections.
 *   - WARN watermark → upmetrics, emitted by the reaper every sweep while above
 *     threshold, so accumulation surfaces EARLY (not 7 min post-death via the
 *     external uptime probe).
 */
const MAX_STREAMS = 60; // Fly hard_limit is 100; keep ≥40 slots for normal API.
const WARN_STREAMS = 35;
const MAX_LIFETIME_MS = 30 * 60_000; // 30 min; client EventSource auto-reconnects.
const REAP_INTERVAL_MS = 60_000;

interface StreamHandle {
  startedAt: number;
  tenantId: string;
  close: () => void; // wakes the stream loop so it exits + cleans up in finally.
}
const liveStreams = new Set<StreamHandle>();

// The connection GC: one timer for the whole process. Force-closes stale
// streams + emits a continuous early-warning while above the watermark.
setInterval(() => {
  const now = Date.now();
  let reaped = 0;
  for (const h of liveStreams) {
    if (now - h.startedAt >= MAX_LIFETIME_MS) {
      h.close();
      reaped += 1;
    }
  }
  if (liveStreams.size > 0 || reaped > 0) {
    console.log(`[stream-gc] active=${liveStreams.size} reaped=${reaped}`);
  }
  if (liveStreams.size >= WARN_STREAMS) {
    captureException(new Error(`SSE streams above watermark: ${liveStreams.size}/${MAX_STREAMS}`), {
      tags: { area: 'sse-gc' },
    });
  }
}, REAP_INTERVAL_MS).unref?.();

streamRoutes.get('/stream', (c) => {
  const tenant = getTenant(c);

  // Load-shed BEFORE opening another long-lived connection. A clean 503 keeps
  // the engine responsive; EventSource retries shortly. Never accumulate toward
  // the Fly hard_limit.
  if (liveStreams.size >= MAX_STREAMS) {
    captureException(new Error(`SSE stream cap reached (${liveStreams.size}/${MAX_STREAMS}) — shedding`), {
      tags: { area: 'sse', tenant: tenant.id },
    });
    return c.json({ error: 'too many open streams, retry shortly' }, 503);
  }

  return streamSSE(c, async (stream) => {
    let id = 0;
    let closed = false;
    const queue: BroadcastEvent[] = [];
    let resolveWait: (() => void) | null = null;

    const push = (event: BroadcastEvent): void => {
      if ('tenantId' in event && event.tenantId !== tenant.id) return;
      queue.push(event);
      resolveWait?.();
    };

    // Registered with the GC so the reaper can force-close us.
    const handle: StreamHandle = {
      startedAt: Date.now(),
      tenantId: tenant.id,
      close: () => { closed = true; resolveWait?.(); },
    };
    liveStreams.add(handle);

    const unsubscribe = broadcaster.subscribe(push);
    stream.onAbort(() => {
      unsubscribe();
      resolveWait?.();
    });

    const pinger = setInterval(() => push({ type: 'ping' }), 30_000);

    try {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'hello', tenantId: tenant.id }),
        event: 'hello',
        id: String(id++),
      });

      while (!stream.aborted && !closed) {
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
      unsubscribe();
      liveStreams.delete(handle);
    }
  });
});
