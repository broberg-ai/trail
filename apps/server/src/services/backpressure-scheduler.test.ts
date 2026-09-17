/**
 * F281.2 — the periodic scheduler must run for EVERY tenant, not just the first.
 *
 * `startBackpressureScheduler` was called once per tenant at boot, but guarded on
 * a module-global timer variable: the second tenant and every one after got a
 * silent no-op. The call site in index.ts claimed verbatim "one timer per tenant
 * so jobs in tenant A never wait on tenant B's rate cap". That was untrue, and it
 * is the code — not the comment — that has been fixed.
 *
 * THIS BECAME LOAD-BEARING WITH F281.1. Before it, a held job kept itself going
 * by calling itself in a loop: expensive and noisy, but it was picked up once
 * capacity appeared. F281.1 removed the loop and made the periodic scheduler the
 * thing that retries. For tenant number two it did not exist — so I would have
 * traded a CPU burning out for a job that never runs at all.
 */
import { test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase } from '@trail/db';
import { startBackpressureScheduler, stopBackpressureScheduler } from './ingest.js';

async function freshDb(name: string) {
  const p = join(process.env.TMPDIR ?? '/tmp', `plan-${name}-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  const t = await createLibsqlDatabase({ path: p });
  await t.runMigrations();
  return t;
}

/** How many tickers are alive right now. */
function activeTimers(): number {
  // `setInterval` returns a Timeout object; we count through a wrapper instead,
  // because Bun does not expose a global list. See below.
  return timerCount;
}

let timerCount = 0;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

afterEach(() => {
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
  stopBackpressureScheduler();
  timerCount = 0;
});

test('LOAD-BEARING: two tenants give two tickers, not one', async () => {
  const a = await freshDb('a');
  const b = await freshDb('b');

  // Count how many intervals the scheduler actually creates.
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    timerCount++;
    return realSetInterval(...args);
  }) as typeof setInterval;

  startBackpressureScheduler(a);
  startBackpressureScheduler(b);

  // Before the fix: 1. Tenant number two got a silent no-op, and its queued jobs
  // were never retried by anyone.
  expect(activeTimers()).toBe(2);
});

test('IDEMPOTENCE PRESERVED: the same tenant twice still gives ONE ticker', async () => {
  const a = await freshDb('c');

  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    timerCount++;
    return realSetInterval(...args);
  }) as typeof setInterval;

  startBackpressureScheduler(a);
  startBackpressureScheduler(a);

  // POSITIVE CONTROL that the fix did not simply delete the guard: boot calls
  // once per tenant, but a repeat must not stack a second timer on top.
  expect(activeTimers()).toBe(1);
});

test('STOP CLOSES THEM ALL: no ticker survives a shutdown', async () => {
  const a = await freshDb('d');
  const b = await freshDb('e');

  let cleared = 0;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    timerCount++;
    return realSetInterval(...args);
  }) as typeof setInterval;
  globalThis.clearInterval = ((h: Parameters<typeof clearInterval>[0]) => {
    cleared++;
    return realClearInterval(h);
  }) as typeof clearInterval;

  startBackpressureScheduler(a);
  startBackpressureScheduler(b);
  stopBackpressureScheduler();

  // A ticker that survives shutdown keeps writing to a closed database. Both
  // must be cleared, not only the first.
  expect(cleared).toBe(2);

  // And a fresh start afterwards must be able to create them again — otherwise a
  // restarted tenant would sit without a scheduler for the rest of the process's
  // lifetime.
  timerCount = 0;
  startBackpressureScheduler(a);
  expect(activeTimers()).toBe(1);
});
