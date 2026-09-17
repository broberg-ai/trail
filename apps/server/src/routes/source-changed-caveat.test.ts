/**
 * F275.5 AC#1 — the old claim must not answer as if it were CURRENT.
 *
 * Marking a page in the database is not enough: the mark has to reach the place
 * where the page turns into an answer. Otherwise supersession has only tidied the
 * queue while the brain keeps answering from yesterday's text — and that is worse
 * than today, because it no longer looks like a problem.
 *
 * Measured through the REAL retrieval endpoint, not through the formatting
 * function.
 */
import { test, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  createLibsqlDatabase, tenants, users, knowledgeBases, documents, documentChunks, apiKeys,
} from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-kaf', U = 'u-kaf', KB = 'kb-kaf';
const KEY = 'trail_' + 'f'.repeat(64);
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

/** The page content is Danish because the product's content is Danish. */
const CLAIM = 'Projektet bygges nu og er endnu ikke lanceret hos kunderne i Danmark.';

async function retrieve() {
  const res = await app.request(`http://engine.local/api/v1/knowledge-bases/${KB}/retrieve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'projektet lanceret kunderne', topK: 5 }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { formattedContext: string; chunks: unknown[] };
}

beforeAll(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `kaf-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.initFTS();
  await trail.db.insert(tenants).values({ id: T, slug: 'kaf', name: 'Kaf', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'k@f.dk', displayName: 'K', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Kaf', slug: KB, language: 'da' }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(KEY).digest('hex'), scope: 'all',
  }).run();
  await trail.db.insert(documents).values({
    id: 'overview', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/', filename: 'overview.md', title: 'Overblik', content: CLAIM, fileType: 'md',
  }).run();
  await trail.db.insert(documentChunks).values({
    id: 'c1', tenantId: T, knowledgeBaseId: KB, documentId: 'overview', chunkIndex: 0, content: CLAIM, tokenCount: 20,
  }).run();
  app = createApp(trail, new Map([['kaf', trail]]));
});

test('POSITIVE CONTROL: without the mark the page answers with no caveat', () => {
  // Without it, the test below only proves that something was in the answer.
  return retrieve().then((r) => {
    expect(r.formattedContext).toContain('bygges nu');
    expect(r.formattedContext).not.toContain('⚠️');
  });
});

test('AC#1 LOAD-BEARING: with the mark the answer carries a caveat — BEFORE the content', async () => {
  await trail.db.update(documents)
    .set({ sourceChangedAt: Date.parse('2026-09-16T10:00:00Z') })
    .where(eq(documents.id, 'overview')).run();
  const r = await retrieve();

  expect(r.formattedContext).toContain('Kilden bag denne side fik en ny udgave');
  // DANISH TIME BY ZONE NAME: 10:00 UTC on 16 Sept is 16 September in Copenhagen.
  expect(r.formattedContext).toContain('16. september');
  expect(r.formattedContext).toContain('svar aldrig som om det er bekræftet mod den nyeste kilde');

  // THE ORDER IS LOAD-BEARING. A warning placed UNDER a text is read after the
  // claim has been believed — by a human and by a model alike.
  expect(r.formattedContext.indexOf('⚠️')).toBeLessThan(r.formattedContext.indexOf('bygges nu'));
});

test('clearing the mark ⇒ the caveat disappears again', async () => {
  // The way back has its own test: a mark that can only be SET would look
  // identical to one that works, until someone tried to clear it.
  await trail.db.update(documents).set({ sourceChangedAt: null }).where(eq(documents.id, 'overview')).run();
  const r = await retrieve();
  expect(r.formattedContext).not.toContain('⚠️');
  expect(r.formattedContext).toContain('bygges nu');
});
