/**
 * F240.1 — the gate for tenant scope on the activity log.
 *
 * TWO REAL DATABASES, because one cannot show the bug. The subscriber is
 * started once per tenant against the same process-global broadcaster, so
 * the defect only appears when a second subscriber is listening — which is
 * exactly the production shape (three tenants on trail-engine-001).
 *
 * THE NEGATIVE CONTROL IS THE POINT. Without a guard, tenant B's row count
 * is ALSO zero — the foreign key rejects the write and logActivity swallows
 * the error. A test that only counted B's rows would therefore be GREEN on
 * the very bug it exists to catch. So `attempted` counts what reached
 * logActivity, and the assertion is on that.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, activityLog, type TrailDatabase } from '@trail/db';
import { broadcaster } from './broadcast.js';
import { startActivityLogger } from './activity-logger.js';

// A's id LOOKS like its slug; B's deliberately does NOT. fd-aalborg's real
// tenant id on prod is a bare UUID while broberg-ai's is `t-broberg-ai`, so a
// future "simplification" to comparing slugs must go RED here, not green.
const A = { slug: 'alpha', tenantId: 't-alpha', user: 'u-a', kb: 'kb-a' };
const B = { slug: 'beta', tenantId: '9f3c1d20-0000-4000-8000-abcdefabcdef', user: 'u-b', kb: 'kb-b' };

let dbA!: TrailDatabase;
let dbB!: TrailDatabase;
const stops: Array<() => void> = [];
const paths: string[] = [];

async function makeTenantDb(t: typeof A): Promise<TrailDatabase> {
  const p = join(process.env.TMPDIR ?? '/tmp', `actlog-${t.slug}-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  paths.push(p, `${p}-wal`, `${p}-shm`);
  const trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: t.tenantId, slug: t.slug, name: t.slug, plan: 'hobby' }).run();
  await trail.db.insert(users).values({
    id: t.user, tenantId: t.tenantId, email: `${t.slug}@local.trail`,
    displayName: t.slug, role: 'owner', onboarded: true,
  }).run();
  await trail.db.insert(knowledgeBases).values({
    id: t.kb, tenantId: t.tenantId, createdBy: t.user, name: 'KB', slug: 'kb', language: 'da',
  }).run();
  return trail;
}

const countRows = async (trail: TrailDatabase): Promise<number> =>
  (await trail.db.select({ id: activityLog.id }).from(activityLog).all()).length;

beforeAll(async () => {
  dbA = await makeTenantDb(A);
  dbB = await makeTenantDb(B);
  stops.push(startActivityLogger(dbA), startActivityLogger(dbB));
});

afterAll(() => {
  for (const stop of stops) stop();
  for (const f of paths) { try { rmSync(f, { force: true }); } catch { /* best effort */ } }
});

const emitForA = (candidateId: string): void => {
  broadcaster.emit({
    type: 'candidate_created', tenantId: A.tenantId, kbId: A.kb,
    candidateId, kind: 'external-feed', title: `t-${candidateId}`,
    status: 'pending', autoApproved: false, createdBy: A.user, confidence: 0.9,
  } as never);
};

// Both subscribers run async, so give the microtask + libsql round-trip a beat.
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 150));

test('an event for tenant A writes EXACTLY ONE row, and only in A', async () => {
  const beforeA = await countRows(dbA);
  const beforeB = await countRows(dbB);

  emitForA('cand-1');
  await settle();

  expect(await countRows(dbA)).toBe(beforeA + 1);
  expect(await countRows(dbB)).toBe(beforeB);
});

test("the row that landed carries A's tenant id — not B's", async () => {
  emitForA('cand-2');
  await settle();

  const rows = await dbA.db.select({ tenantId: activityLog.tenantId }).from(activityLog).all();
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(r.tenantId).toBe(A.tenantId);
});

test("B's database holds NO row for A — measured directly, not inferred", async () => {
  emitForA('cand-3');
  await settle();

  const foreign = await dbB.db.select({ id: activityLog.id }).from(activityLog).all();
  expect(foreign.length).toBe(0);
});

// NEGATIVE CONTROL — mutation marker: "B's subscriber must not even ATTEMPT the write"
//
// Delete the `own.has(event.tenantId)` guard in activity-logger.ts and THIS test
// goes red while the three above stay green, because the foreign key silently
// absorbs the wrong write. That asymmetry is the whole reason this test exists.
test("B's subscriber must not even ATTEMPT the write (the FK is a backstop, not the guard)", async () => {
  const attempted: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    const line = args.map(String).join(' ');
    if (line.includes('[activity-log] write failed')) attempted.push(line);
    original(...(args as []));
  };
  try {
    emitForA('cand-4');
    await settle();
  } finally {
    console.error = original;
  }

  // With the guard: B returns before logActivity, so nothing is attempted.
  // Without it: B attempts the insert and the FK rejects it, which logActivity
  // reports on exactly this line. Counting rows in B cannot tell those apart.
  expect(attempted).toEqual([]);
});

test('the foreign key is STILL THERE — the guard did not replace it', async () => {
  const fks = await dbA.db.all<{ from: string; table: string }>(
    "PRAGMA foreign_key_list('activity_log')" as never,
  );
  const cols = (fks as Array<{ from: string }>).map((f) => f.from).sort();
  expect(cols).toEqual(['actor_id', 'knowledge_base_id', 'tenant_id']);
});

// ── F240.1 review round 1 — the two findings the code+security gate raised ──

test('an event whose tenantId is EMPTY is dropped, not attempted (the guard fails CLOSED)', async () => {
  const attempted: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]): void => {
    const line = args.map(String).join(' ');
    if (line.includes('[activity-log] write failed')) attempted.push(line);
    original(...(args as []));
  };
  const beforeA = await countRows(dbA);
  const beforeB = await countRows(dbB);
  try {
    // MUTATION MARKER: restore `&& event.tenantId` to the guard and this goes red.
    // An empty id belongs to no tenant, so BOTH subscribers must drop it — a guard
    // that only runs when the value is truthy is waved through by the one value
    // that is guaranteed to be wrong.
    broadcaster.emit({
      type: 'candidate_created', tenantId: '', kbId: A.kb,
      candidateId: 'cand-empty', kind: 'external-feed', title: 'empty-tenant',
      status: 'pending', autoApproved: false, createdBy: null, confidence: 0.5,
    } as never);
    await settle();
  } finally {
    console.error = original;
  }

  expect(attempted).toEqual([]);
  expect(await countRows(dbA)).toBe(beforeA);
  expect(await countRows(dbB)).toBe(beforeB);
});

test('a transient tenant-lookup failure does NOT switch the audit log off for good', async () => {
  // The cache holds a PROMISE. If a rejection stays cached, every later event
  // inherits it and nothing is ever logged again — the audit trail goes dark
  // behind a line that reads like noise. So the property under test is that the
  // SECOND event re-runs the lookup rather than reusing the failure.
  //
  // MUTATION MARKER: drop the `.catch(() => { ownTenantIds = null; ... })` and
  // `lookups` stays at 1 — this test goes red while every other test stays green.
  let lookups = 0;
  const failing = {
    db: {
      select: () => ({
        from: () => ({
          all: async (): Promise<Array<{ id: string }>> => {
            lookups += 1;
            throw new Error('database is locked');
          },
        }),
      }),
      insert: () => ({ values: () => ({ run: async (): Promise<void> => undefined }) }),
    },
  } as never;

  // ASSERT ON THE INCREASE, NOT ON AN ABSOLUTE COUNT.
  //
  // `lookups` counts events this logger observes on the SHARED broadcaster, so
  // any other test file emitting a candidate event in the same bun process is
  // also counted. Measured 2026-09-06: this test failed intermittently under
  // turbo (`Expected: 2, Received: 4`) and passed every time the suite ran
  // alone — a flake that made the gate untrustworthy twice in one session, and
  // twice let a commit through on red because "1 fail" could not be told apart
  // from a real regression at a glance.
  //
  // The claim under test is "the second event RE-RAN the lookup", not "exactly
  // two events existed in the universe". The increase is the property; the
  // absolute number was never part of it.
  //
  // MUTATION MARKER (unchanged): drop the `.catch(...)` that clears the cached
  // rejection and the second event reuses the failed promise — `after` equals
  // `first` and this goes red, while every other test stays green.
  const stop = startActivityLogger(failing);
  try {
    emitForA('cand-retry-1');
    await settle();
    const first = lookups;
    expect(first).toBeGreaterThan(0); // the lookup ran at all

    emitForA('cand-retry-2');
    await settle();
    expect(lookups).toBeGreaterThan(first); // retried — the rejection was not cached
  } finally {
    stop();
  }
});
