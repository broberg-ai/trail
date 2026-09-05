/**
 * F248.6 — aktivitetstælleren bag sidebarens pulserende prik.
 *
 * Mod RIGTIG SQL, og den bærende del er den NEGATIVE kontrol: en anden
 * tenants kilder i samme database må aldrig tælle med. En tæller der
 * summerer på tværs af tenants ville vise en prik for arbejde ejeren
 * hverken kan se eller påvirke — og den fejl ville se ud som en feature.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  createLibsqlDatabase,
  tenants,
  users,
  knowledgeBases,
  documents,
  type TrailDatabase,
} from '@trail/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

const A = { tenant: 't-act-a', user: 'u-act-a', kb: 'kb-act-a' };
const B = { tenant: 't-act-b', user: 'u-act-b', kb: 'kb-act-b' };

let trail!: TrailDatabase;
const dbPath = join(process.env.TMPDIR ?? '/tmp', `srcact-${process.pid}.db`);

/** Præcis de to forespørgsler ruten kører (samme prædikater, samme rækkefølge). */
async function activityFor(tenantId: string, kbId: string) {
  const base = [
    eq(documents.tenantId, tenantId),
    eq(documents.knowledgeBaseId, kbId),
    eq(documents.kind, 'source'),
    eq(documents.archived, false),
  ];
  const a = await trail.db
    .select({ n: sql<number>`count(*)` })
    .from(documents)
    .where(and(...base, inArray(documents.status, ['uploading', 'pending', 'processing'])))
    .get();
  const w = await trail.db
    .select({ n: sql<number>`count(*)` })
    .from(documents)
    .where(and(...base, eq(documents.awaitingLocalCompile, true)))
    .get();
  return { active: Number(a?.n ?? 0), awaiting: Number(w?.n ?? 0) };
}

beforeAll(async () => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* fresh */ }
  }
  trail = await createLibsqlDatabase({ path: dbPath });
  await trail.runMigrations();
  for (const t of [A, B]) {
    await trail.db.insert(tenants).values({ id: t.tenant, slug: t.tenant, name: t.tenant, plan: 'hobby' }).run();
    await trail.db.insert(users).values({ id: t.user, tenantId: t.tenant, email: `${t.user}@test.local` }).run();
    await trail.db.insert(knowledgeBases).values({
      id: t.kb, tenantId: t.tenant, createdBy: t.user, slug: t.kb, name: t.kb,
    }).run();
  }
  const mk = (t: typeof A, id: string, status: 'uploading' | 'pending' | 'processing' | 'ready', extra: Record<string, unknown> = {}) => ({
    id, tenantId: t.tenant, knowledgeBaseId: t.kb, userId: t.user,
    kind: 'source' as const, filename: `${id}.md`, title: id, path: '/', fileType: 'md', status,
    ...extra,
  });
  // A: 2 arbejder + 1 færdig + 1 parkeret (den parkerede er 'ready', så de to
  // tal måler forskellige ting og ikke kan bytte plads uubemærket).
  await trail.db.insert(documents).values([
    mk(A, 'a-proc-1', 'processing'),
    mk(A, 'a-proc-2', 'uploading'),
    mk(A, 'a-ready', 'ready'),
    mk(A, 'a-parked', 'ready', { awaitingLocalCompile: true }),
    // arkiveret + i gang: må ALDRIG tælle med
    mk(A, 'a-archived', 'processing', { archived: true }),
  ]).run();
  // B: en anden tenants travle kilder — den negative kontrol.
  await trail.db.insert(documents).values([
    mk(B, 'b-proc-1', 'processing'),
    mk(B, 'b-proc-2', 'processing'),
    mk(B, 'b-parked', 'ready', { awaitingLocalCompile: true }),
  ]).run();
});

afterAll(async () => {
  await trail.close?.();
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* fine */ }
  }
});

test('tæller aktivt arbejde og parkerede hver for sig', async () => {
  expect(await activityFor(A.tenant, A.kb)).toEqual({ active: 2, awaiting: 1 });
});

test('NEGATIV KONTROL: en anden tenants travle kilder tælles aldrig med', async () => {
  // B har 2 i gang. Var prædikatet uden tenant/KB, ville A vise 4.
  expect(await activityFor(B.tenant, B.kb)).toEqual({ active: 2, awaiting: 1 });
  const a = await activityFor(A.tenant, A.kb);
  expect(a.active).toBe(2);
});

test('arkiverede kilder tæller ikke som aktivitet', async () => {
  // a-archived er 'processing' men arkiveret; ville active være 3 uden filteret.
  expect((await activityFor(A.tenant, A.kb)).active).toBe(2);
});

test('ingen aktivitet giver nul — prikken skal kunne forsvinde', async () => {
  await trail.db.update(documents).set({ status: 'ready' })
    .where(and(eq(documents.tenantId, A.tenant), inArray(documents.id, ['a-proc-1', 'a-proc-2']))).run();
  expect((await activityFor(A.tenant, A.kb)).active).toBe(0);
});
