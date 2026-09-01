/**
 * F214.2 — the gate for queue paging.
 *
 * `scripts/verify-f214-2.ts` proves the same properties in more detail, but a
 * script nothing runs is theatre (CLAUDE.md, Harness-kontrakt). This file is
 * what `pnpm test` runs, and what CI blocks the deploy on.
 *
 * The assertion that matters most is the same-second one: `createdAt` is
 * second-resolution and collides (measured on prod: 190 distinct values in 200
 * rows), so a cursor without `id` in it drops rows at page boundaries — silently,
 * and only under the batch writes that produce clustered timestamps. Mutation-
 * checked: remove `id` from the cursor and the ordering, and 5 of 12 rows vanish.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, queueCandidates } from '@trail/db';
import { createApp } from '../app.js';
import type { Hono } from 'hono';

const T = 't-qp', U = 'u-qp', KB = 'kb-qp';
const SAME = '2026-08-20 12:00:00';
const ROWS = [
  ['r01', '2026-08-24 10:00:00'], ['r02', '2026-08-23 10:00:00'],
  ['r03', '2026-08-22 10:00:00'], ['r04', '2026-08-21 10:00:00'],
  ['r05', SAME], ['r06', SAME], ['r07', SAME],
  ['r08', SAME], ['r09', SAME], ['r10', SAME],
  ['r11', '2026-08-19 10:00:00'], ['r12', '2026-08-18 10:00:00'],
] as const;

let app: Hono;

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `qp-${process.env.USER ?? 'x'}-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  const trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.initFTS();
  await trail.db.insert(tenants).values({ id: T, slug: 'qp', name: 'QP', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'qp@local.trail', displayName: 'Q', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'KB', slug: 'kb', language: 'da' }).run();
  await trail.db.insert(sessions).values({ id: 'sess-qp', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();
  await trail.db.insert(queueCandidates).values(
    ROWS.map(([id, createdAt]) => ({
      id, tenantId: T, knowledgeBaseId: KB, kind: 'external-feed' as const,
      title: id, content: 'x', metadata: JSON.stringify({ connector: 'api' }),
      status: 'pending' as const, createdAt,
    })),
  ).run();
  app = createApp(trail, new Map([['qp', trail]]));
});

type Page = { items: Array<{ id: string }>; count: number; nextCursor: string | null; error?: string };
const get = async (qs: string) => {
  const res = await app.request(`http://engine.local/api/v1/queue?${qs}`, { headers: { Cookie: 'session=sess-qp' } });
  return { status: res.status, body: (await res.json()) as Page };
};

test('paging the whole filter sees every row exactly once', async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const p: { status: number; body: Page } = await get(`limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    seen.push(...p.body.items.map((i) => i.id));
    cursor = p.body.nextCursor;
  } while (cursor && ++pages < 20);
  expect(seen.length).toBe(12);
  expect(new Set(seen).size).toBe(12);
  expect(pages).toBeLessThan(19); // the old code never terminated
});

test('same-second rows straddling a page boundary are not dropped', async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  let guard = 0;
  do {
    const p: { status: number; body: Page } = await get(`limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    seen.push(...p.body.items.map((i) => i.id));
    cursor = p.body.nextCursor;
  } while (cursor && ++guard < 20);
  const cluster = seen.filter((id) => ['r05', 'r06', 'r07', 'r08', 'r09', 'r10'].includes(id));
  expect(cluster.sort()).toEqual(['r05', 'r06', 'r07', 'r08', 'r09', 'r10']);
});

test('consecutive pages are disjoint', async () => {
  const p1 = await get('limit=5');
  const p2 = await get(`limit=5&cursor=${encodeURIComponent(p1.body.nextCursor ?? '')}`);
  const a = p1.body.items.map((i) => i.id);
  const b = p2.body.items.map((i) => i.id);
  expect(a.filter((i) => b.includes(i))).toEqual([]);
});

test('a truncated page is distinguishable from a complete one', async () => {
  expect((await get('limit=5')).body.nextCursor).not.toBeNull();
  expect((await get('limit=50')).body.nextCursor).toBeNull();
  // Exact page size: the case where items.length === limit but there is no more.
  const exact = await get('limit=12');
  expect(exact.body.items.length).toBe(12);
  expect(exact.body.nextCursor).toBeNull();
});

test('count is the total, independent of limit and cursor', async () => {
  const p1 = await get('limit=5');
  expect(p1.body.count).toBe(12);
  expect((await get('limit=50')).body.count).toBe(12);
  expect((await get(`limit=5&cursor=${encodeURIComponent(p1.body.nextCursor ?? '')}`)).body.count).toBe(12);
});

test('a malformed cursor is a 400 naming the field — never a silent page 1', async () => {
  const bad = await get('limit=5&cursor=not-a-cursor!!');
  expect(bad.status).toBe(400);
  expect(bad.body.error).toContain('cursor');
  expect(bad.body.items?.[0]?.id).toBeUndefined();
});
