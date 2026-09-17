/**
 * F275.1 — backfill of the NEURON side.
 *
 * Measured 17 Sept in broberg.ai: 66 of 66 sources carried an identity, and 0 of
 * 247 Neurons did. The feature was therefore inert for the entire existing base —
 * and it looked exactly as though it worked, because the safe default made it
 * harmless.
 */
import { test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  createLibsqlDatabase, tenants, users, knowledgeBases, documents, documentReferences, apiKeys,
} from '@trail/db';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';

const T = 't-nib', U = 'u-nib', KB = 'kb-nib';
const KEY = 'trail_' + 'b'.repeat(64);
const URL_A = 'url:https://broberg.ai/a';
const URL_B = 'url:https://broberg.ai/b';
let app: ReturnType<typeof createApp>;
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

type Response = { neurons: number; before: number; gained: number; alreadyHad: number; normalised: number; noSource: number; multipleSources: number; after: number; applied: boolean };

async function backfill(apply: boolean): Promise<Response> {
  const res = await app.request('http://engine.local/api/v1/maintenance/backfill-neuron-identity', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ apply }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Response;
}

async function source(id: string, identity: string | null) {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/sources/', filename: `${id}.md`, content: 'x', fileType: 'md', sourceIdentity: identity,
  }).run();
}
async function neuron(id: string) {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/', filename: `${id}.md`, title: id, content: 'x', fileType: 'md',
  }).run();
}
async function cites(n: string, k: string, anchor = 'a1') {
  await trail.db.insert(documentReferences).values({
    id: `r-${n}-${k}-${anchor}`, tenantId: T, knowledgeBaseId: KB,
    wikiDocumentId: n, sourceDocumentId: k, claimAnchor: anchor,
  }).run();
}
async function identityOn(id: string) {
  const r = await trail.db.select({ i: documents.sourceIdentity }).from(documents).where(eq(documents.id, id)).get();
  return r?.i ?? null;
}

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `nib-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'nib', name: 'Nib', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'n@i.dk', displayName: 'N', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Nib', slug: KB, language: 'da' }).run();
  await trail.db.insert(apiKeys).values({
    id: 'k1', tenantId: T, userId: U, name: 'k1',
    keyHash: createHash('sha256').update(KEY).digest('hex'), scope: 'all',
  }).run();
  app = createApp(trail, new Map([['nib', trail]]));
});

test('DRY RUN IS THE DEFAULT — it counts but does not write', async () => {
  // A backfill that can only be run for real is a backfill nobody dares run.
  await source('k1', URL_A);
  await neuron('n1'); await cites('n1', 'k1');
  const t = await backfill(false);
  expect([t.gained, t.after, t.applied]).toEqual([1, 0, false]);
  expect(await identityOn('n1')).toBeNull();
});

test('LOAD-BEARING: a Neuron with ONE source inherits its identity — and the count is read back', async () => {
  await source('k1', URL_A);
  await neuron('n1'); await cites('n1', 'k1');
  const r = await backfill(true);
  expect([r.before, r.gained, r.after]).toEqual([0, 1, 1]);
  expect(await identityOn('n1')).toBe(URL_A);
});

test('the same source cited THREE times is ONE source, not three', async () => {
  // Without DISTINCT, every Neuron with several citations to the same page would
  // land in "multiple sources" and be skipped — that is, the most thorough pages.
  await source('k1', URL_A);
  await neuron('n1');
  for (const a of ['a1', 'a2', 'a3']) await cites('n1', 'k1', a);
  expect((await backfill(true)).gained).toBe(1);
  expect(await identityOn('n1')).toBe(URL_A);
});

test('THE DELIBERATE OMISSION: a Neuron with TWO sources gets NO identity', async () => {
  // "Which source is this page an edition OF" has no unambiguous answer when it
  // rests on two. Guessing the first would let a new edition of THAT supersede a
  // page that also rested on the second — taking valid knowledge away, silently.
  await source('k1', URL_A); await source('k2', URL_B);
  await neuron('n1'); await cites('n1', 'k1'); await cites('n1', 'k2');
  const r = await backfill(true);
  expect([r.gained, r.multipleSources]).toEqual([0, 1]);
  expect(await identityOn('n1')).toBeNull();
});

test('a Neuron WITHOUT citation edges counts as "no source", not as processed', async () => {
  // Conflate the two and the report looks better than reality.
  await neuron('n1');
  const r = await backfill(true);
  expect([r.gained, r.noSource]).toEqual([0, 1]);
});

test('a source WITHOUT an identity yields no inheritance — not an empty identity', async () => {
  await source('k1', null);
  await neuron('n1'); await cites('n1', 'k1');
  const r = await backfill(true);
  expect([r.gained, r.noSource]).toEqual([0, 1]);
  expect(await identityOn('n1')).toBeNull();
});

test('IDEMPOTENT: a second run changes nothing and claims nothing', async () => {
  await source('k1', URL_A);
  await neuron('n1'); await cites('n1', 'k1');
  await backfill(true);
  const again = await backfill(true);
  expect([again.gained, again.alreadyHad, again.after]).toEqual([0, 1, 1]);
});

test('archived Neurons are untouched — they answer nothing', async () => {
  await source('k1', URL_A);
  await neuron('n1'); await cites('n1', 'k1');
  await trail.db.update(documents).set({ archived: true }).where(eq(documents.id, 'n1')).run();
  expect((await backfill(true)).neurons).toBe(0);
});

test('SYNCHRONISATION: a Neuron with an OUTDATED form of the source identity is corrected', async () => {
  // The measured case on 17 Sept: the source carried "%C3%B8", the Neuron carried
  // "ø". As strings they differ, so sameSource() said no to two pages that ARE the
  // same page. Had the backfill only filled empty fields, the wrong form would
  // stand forever — and supersession would never reach that page.
  await source('k1', URL_A);
  await neuron('n1'); await cites('n1', 'k1');
  await trail.db.update(documents).set({ sourceIdentity: 'url:https://broberg.ai/GAMMEL-FORM' })
    .where(eq(documents.id, 'n1')).run();

  const r = await backfill(true);
  expect([r.gained, r.normalised]).toEqual([0, 1]);
  expect(await identityOn('n1')).toBe(URL_A);
});

test('a Neuron that is ALREADY correct counts as neither gained nor normalised', async () => {
  // Otherwise the report would claim something happened on every single run.
  await source('k1', URL_A);
  await neuron('n1'); await cites('n1', 'k1');
  await backfill(true);
  const again = await backfill(true);
  expect([again.gained, again.normalised]).toEqual([0, 0]);
});
