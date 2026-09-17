/**
 * F275.5 — supersession has to propagate.
 *
 * THE MEASURED CASE, 15–16 September: five pages said "being built now" after
 * the source said "launched" — overview.md, glossary.md, flagskib.md, the source
 * Neuron and the entity Neuron. Only ONE of them carries the source's URL as its
 * own identity. The setup below is exactly that shape.
 */
import { test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  createLibsqlDatabase, tenants, users, knowledgeBases, documents, documentReferences,
} from '@trail/db';
import { eq } from 'drizzle-orm';
import { dependentsOf, markDependents, clearSourceMark } from './source-propagation.js';

const T = 't-fp', U = 'u-fp', KB = 'kb-fp';
const URL_A = 'url:https://broberg.ai/flagskibe/bid';
const URL_B = 'url:https://broberg.ai/andet';
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

async function source(id: string, identity: string | null) {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/sources/', filename: `${id}.md`, content: 'source text', fileType: 'md',
    sourceIdentity: identity,
  }).run();
}

async function neuron(id: string, identity: string | null) {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/', filename: `${id}.md`, title: id, content: 'page text', fileType: 'md',
    sourceIdentity: identity,
  }).run();
}

/** A citation edge — the link no other mechanism finds. */
async function cites(neuronId: string, sourceId: string) {
  await trail.db.insert(documentReferences).values({
    id: `r-${neuronId}-${sourceId}`, tenantId: T, knowledgeBaseId: KB,
    wikiDocumentId: neuronId, sourceDocumentId: sourceId, claimAnchor: `c-${neuronId}`,
  }).run();
}

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `fp-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'fp', name: 'Fp', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f@p.dk', displayName: 'F', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Fp', slug: KB, language: 'da' }).run();
});

test('AC#0 THE MEASURED CASE: all five pages are found — not only the one carrying the source identity', async () => {
  await source('source-bid', URL_A);
  await neuron('bid', URL_A);              // compiled FROM the source
  await neuron('entity', URL_A);           // likewise
  for (const n of ['overview', 'glossary', 'flagskib']) {
    await neuron(n, null);                 // its own identity is NOT the source URL
    await cites(n, 'source-bid');
  }

  // 'bid' is the one that was just recompiled — it is up to date and excluded.
  const found = await dependentsOf(trail, T, KB, URL_A, 'bid');
  expect(found.map((f) => f.documentId).sort()).toEqual(['entity', 'flagskib', 'glossary', 'overview']);
  expect(found.find((f) => f.documentId === 'entity')?.link).toBe('compiled-from');
  expect(found.find((f) => f.documentId === 'overview')?.link).toBe('cites');
});

test('AC#3 THE DEPENDENCY IS LOOKED UP — a page that merely MENTIONS the same words is untouched', async () => {
  await source('source-bid', URL_A);
  await neuron('bid', URL_A);
  await neuron('unrelated', null);      // no identity, no citation edge
  await neuron('other-source', URL_B);  // a different source
  expect(await dependentsOf(trail, T, KB, URL_A, 'bid')).toEqual([]);
});

test('AC#3 — NO identity does not drag arbitrary pages along', async () => {
  // "We do not know which source this is" must never match another unknown.
  // Otherwise a single recompile would mark the whole un-backfilled base.
  await neuron('without-1', null);
  await neuron('without-2', null);
  expect(await dependentsOf(trail, T, KB, null)).toEqual([]);

  // And an EMPTY string in the column must not match an empty lookup. Without
  // this line the test passed with the guard removed — because SQL matches
  // nothing anyway when no row is empty. It then proved that no such row
  // existed, not that the guard worked. Measured: the mutation was GREEN before
  // this line.
  await source('source-empty', '');
  await neuron('empty', '');
  await cites('empty', 'source-empty');
  expect(await dependentsOf(trail, T, KB, '')).toEqual([]);
});

test('archived pages are not reported — they answer nothing', async () => {
  await source('source-bid', URL_A);
  await neuron('archived', URL_A);
  await trail.db.update(documents).set({ archived: true }).where(eq(documents.id, 'archived')).run();
  expect(await dependentsOf(trail, T, KB, URL_A)).toEqual([]);
});

test('a page that is BOTH compiled from the source and cites it counts ONCE', async () => {
  await source('source-bid', URL_A);
  await neuron('both', URL_A);
  await cites('both', 'source-bid');
  const f = await dependentsOf(trail, T, KB, URL_A);
  expect(f.length).toBe(1);
  // The stronger link wins, so the message to the curator is the right one.
  expect(f[0]!.link).toBe('compiled-from');
});

test('several EDITIONS of the same source: a citation edge to the OLD row still counts', async () => {
  // Every upload is its own row. Looking up only the newest would lose pages
  // citing the previous edition — that is, precisely the oldest and most
  // outdated pages, which are the ones that matter most.
  await source('source-v1', URL_A);
  await source('source-v2', URL_A);
  await neuron('overview', null);
  await cites('overview', 'source-v1');
  expect((await dependentsOf(trail, T, KB, URL_A)).map((f) => f.documentId)).toEqual(['overview']);
});

test('THE MARK is written and READ BACK — the count is measured, not assumed', async () => {
  await source('source-bid', URL_A);
  await neuron('overview', null);
  await cites('overview', 'source-bid');
  const now = Date.now();
  const deps = await dependentsOf(trail, T, KB, URL_A);
  expect(await markDependents(trail, deps, now)).toBe(1);
  const row = await trail.db
    .select({ t: documents.sourceChangedAt }).from(documents).where(eq(documents.id, 'overview')).get();
  expect(row!.t).toBe(now);
});

test('the mark is CLEARED when the page is rewritten — otherwise it reports itself stale forever', async () => {
  await neuron('overview', null);
  await trail.db.update(documents).set({ sourceChangedAt: 123 }).where(eq(documents.id, 'overview')).run();
  await clearSourceMark(trail, 'overview');
  const r = await trail.db
    .select({ t: documents.sourceChangedAt }).from(documents).where(eq(documents.id, 'overview')).get();
  expect(r!.t).toBeNull();
});

test('an empty list marks nothing and claims nothing', async () => {
  expect(await markDependents(trail, [], Date.now())).toBe(0);
});
