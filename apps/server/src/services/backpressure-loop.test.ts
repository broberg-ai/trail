/**
 * F281.1 — a held compile job must NEVER call itself in a loop.
 *
 * When capacity is full the job should stay queued and wait for the periodic
 * scheduler. It did not: the drain block in `claimAndRun` found precisely the
 * job we had just put down and called itself again immediately — in a loop,
 * without pause.
 *
 * MEASURED 17 Sept 2026 on the server's own suite: 686,041 lines of
 * "[backpressure] holding job_… — global-concurrency" and a 62 MB log file
 * within seconds. The suite never finished.
 *
 * The pressure is created with the TENANT RATE and not the global cap, because
 * `runningLocally` is shared module state: an earlier test file may have left
 * Brains in it, and then this test would pass or fail for a reason other than
 * its own. 60 rows hit the default ceiling regardless of ordering.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import {
  createLibsqlDatabase,
  tenants,
  users,
  knowledgeBases,
  documents,
  ingestJobs,
} from '@trail/db';
import { triggerIngest } from './ingest.js';
import { DEFAULT_BACKPRESSURE } from '@trail/shared';

const T = 't-ring', U = 'u-ring', KB = 'kb-ring';
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;
let heldJobId: string | undefined;

/** Fills the tenant's hourly window right up. */
async function fillHourlyWindow(): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0; i < DEFAULT_BACKPRESSURE.maxPerHourPerTenant; i++) {
    await trail.db.insert(ingestJobs).values({
      id: `job-fill-${i}`, tenantId: T, knowledgeBaseId: KB,
      documentId: 'doc-ring', status: 'done', startedAt: now,
    }).run();
  }
}

async function clearHourlyWindow(): Promise<void> {
  for (let i = 0; i < DEFAULT_BACKPRESSURE.maxPerHourPerTenant; i++)
    await trail.db.delete(ingestJobs).where(eq(ingestJobs.id, `job-fill-${i}`)).run();
}

/**
 * Runs `fn` and counts how many "holding" lines it wrote.
 *
 * THE EMERGENCY BRAKE is not decoration. The loop is a chain of awaited DB calls,
 * i.e. pure microtasks — it starves the timers, so a `setTimeout` wait never
 * fires. Without the brake the test HANGS instead of failing, and a test that
 * hangs reports nothing. Measured: the test was killed after 120 seconds with an
 * empty log, because `console.log` had been intercepted.
 *
 * The brake archives the source. The next round of the loop sees an archived
 * source, cancels the job and stops — without starting a real compile.
 */
async function countHoldingLines(fn: () => void, waitMs: number, cap = 200): Promise<number> {
  const real = console.log;
  let n = 0;
  let braked = false;
  console.log = (...a: unknown[]) => {
    if (typeof a[0] !== 'string' || !a[0].includes('[backpressure] holding')) return;
    n++;
    if (n >= cap && !braked) {
      braked = true;
      void trail.db.update(documents).set({ archived: true })
        .where(eq(documents.id, 'doc-ring')).run();
    }
  };
  try {
    fn();
    await new Promise((r) => setTimeout(r, waitMs));
  } finally {
    console.log = real;
  }
  return n;
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `ring-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'ring', name: 'Ring', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'r@ring.dk', displayName: 'R', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Ring', slug: KB, language: 'da' }).run();
  await trail.db.insert(documents).values({
    id: 'doc-ring', tenantId: T, knowledgeBaseId: KB, userId: U, kind: 'source',
    filename: 'r.md', fileType: 'md', fileSize: 10, status: 'pending',
  }).run();
});

afterAll(() => { try { trail?.close?.(); } catch { /* already closed */ } });

test('LOAD-BEARING: a held job writes ONE holding line, not thousands', async () => {
  await fillHourlyWindow();

  const lines = await countHoldingLines(
    () => triggerIngest({ trail, docId: 'doc-ring', kbId: KB, tenantId: T, userId: U }),
    400,
  );

  // Before the fix: tens of thousands in 400 ms. The ceiling is low enough that
  // a loop cannot sneak under it, and high enough that one extra periodic tick
  // does not make the test flaky.
  expect(lines).toBeLessThanOrEqual(3);
  expect(lines).toBeGreaterThanOrEqual(1);   // POSITIVE CONTROL: the pressure worked

  const held = await trail.db.select().from(ingestJobs)
    .where(eq(ingestJobs.documentId, 'doc-ring')).all();
  heldJobId = held.find((j) => j.status === 'queued')?.id;
  expect(heldJobId).toBeString();
});

test('THE JOB IS NOT STRANDED: it stays queued and is picked up by the next tick', async () => {
  const afterHold = await trail.db.select().from(ingestJobs)
    .where(eq(ingestJobs.id, heldJobId!)).get();
  expect(afterHold?.status).toBe('queued');   // not lost, not failed

  // Release the capacity and tick the Brain again — exactly the same
  // `tickScheduler` call the periodic scheduler makes every 30 seconds.
  //
  // The source is archived first, so the job terminates on the exit that does
  // NOT start a real — and paid — compile. So this test proves the held job is
  // PICKED UP again by a later tick; it does not prove a full compile, and it
  // does not claim to.
  await clearHourlyWindow();
  await trail.db.update(documents).set({ archived: true })
    .where(eq(documents.id, 'doc-ring')).run();
  triggerIngest({ trail, docId: 'doc-ring', kbId: KB, tenantId: T, userId: U });
  await new Promise((r) => setTimeout(r, 400));

  const pickedUp = await trail.db.select().from(ingestJobs)
    .where(eq(ingestJobs.id, heldJobId!)).get();
  expect(pickedUp?.status).not.toBe('queued');   // the scheduler took it
});
