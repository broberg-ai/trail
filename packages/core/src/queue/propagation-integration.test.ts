/**
 * F275.5 AC#5 + AC#2 — propagation runs on the path that ACTUALLY receives a new
 * source version, and a dependent page that was not reached produces a VISIBLE
 * finding.
 *
 * AC#2 is the important one: if supersession only touches the source Neuron, the
 * queue goes clean while the brain still answers from yesterday's text — and that
 * is WORSE than today, because it no longer looks like a problem. So silence must
 * never be the outcome when there ARE dependent pages.
 */
import { test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  createLibsqlDatabase, tenants, users, knowledgeBases, documents, documentReferences, queueCandidates,
} from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { createCandidate, resolveCandidate } from './candidates.js';

const T = 't-fpi', U = 'u-fpi', KB = 'kb-fpi';
const URL_A = 'url:https://broberg.ai/flagskibe/bid';
const MACHINE = { id: U, kind: 'llm' as const };
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

/** Compiles a page FROM the source — the way the ingest path does it. */
async function compile(content: string, sourceDocumentId?: string) {
  const { candidate, approval } = await createCandidate(
    trail, T,
    {
      knowledgeBaseId: KB, kind: 'ingest-summary', title: 'BID', content, confidence: 0.5,
      metadata: JSON.stringify({
        op: 'create', filename: 'bid.md', path: '/neurons/sources/',
        ...(sourceDocumentId ? { sourceDocumentId } : {}),
      }),
    },
    MACHINE,
  );
  return approval ?? resolveCandidate(trail, T, candidate.id, MACHINE, { actionId: 'approve' });
}

async function findings() {
  return trail.db
    .select({ title: queueCandidates.title, content: queueCandidates.content, metadata: queueCandidates.metadata })
    .from(queueCandidates)
    .where(and(eq(queueCandidates.tenantId, T), eq(queueCandidates.kind, 'gap-detection')))
    .all();
}

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `fpi-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'fpi', name: 'Fpi', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f@i.dk', displayName: 'F', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Fpi', slug: KB, language: 'da' }).run();
  // THE SOURCE, with an identity (F275.1).
  await trail.db.insert(documents).values({
    id: 'source-bid', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/sources/', filename: 'bid.md', content: 'source text', fileType: 'md', sourceIdentity: URL_A,
  }).run();
  // OVERVIEW — cites the source, does NOT carry its identity. The page that was
  // wrong that night, and that no other mechanism finds.
  await trail.db.insert(documents).values({
    id: 'overview', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/', filename: 'overview.md', title: 'Overblik', content: 'Projektet bygges nu.', fileType: 'md',
  }).run();
  await trail.db.insert(documentReferences).values({
    id: 'r1', tenantId: T, knowledgeBaseId: KB,
    wikiDocumentId: 'overview', sourceDocumentId: 'source-bid', claimAnchor: 'c1',
  }).run();
});

test('AC#5 LOAD-BEARING: a RECOMPILE triggers propagation on the real path', async () => {
  await compile('# BID\n\nProjektet bygges nu.', 'source-bid');
  expect(await findings()).toEqual([]);   // the first compile supersedes nothing

  await compile('# BID\n\nProjektet er lanceret.', 'source-bid');
  const f = await findings();
  expect(f.length).toBe(1);
  expect(f[0]!.title).toContain('1 side hænger på en kilde');
  expect(f[0]!.content).toContain('Overblik');
  expect(f[0]!.content).toContain('citerer kilden');
});

test('AC#2 — the dependent page is MARKED, so it does not answer as if nothing happened', async () => {
  await compile('# BID\n\nProjektet bygges nu.', 'source-bid');
  await compile('# BID\n\nProjektet er lanceret.', 'source-bid');
  const r = await trail.db
    .select({ t: documents.sourceChangedAt }).from(documents).where(eq(documents.id, 'overview')).get();
  expect(typeof r!.t).toBe('number');
});

test('AC#2 — the page that WAS recompiled is NOT marked; it is up to date', async () => {
  const f = await compile('# BID\n\nProjektet bygges nu.', 'source-bid');
  await compile('# BID\n\nProjektet er lanceret.', 'source-bid');
  const r = await trail.db
    .select({ t: documents.sourceChangedAt, i: documents.sourceIdentity })
    .from(documents).where(eq(documents.id, f.documentId!)).get();
  expect(r!.i).toBe(URL_A);
  expect(r!.t).toBeNull();
});

test('NEGATIVE CONTROL — a recompile with NO dependents reports nothing', async () => {
  // Without it, "always report" would pass just as green, and the queue would
  // get a message on every single re-sync from the site.
  await trail.db.delete(documentReferences).where(eq(documentReferences.id, 'r1')).run();
  await compile('# BID\n\nProjektet bygges nu.', 'source-bid');
  await compile('# BID\n\nProjektet er lanceret.', 'source-bid');
  expect(await findings()).toEqual([]);
});

test('NEGATIVE CONTROL — a compile with NO known source propagates nothing', async () => {
  // No identity means "we do not know". Marking on it would let a single compile
  // stamp the entire un-backfilled base.
  await compile('# BID\n\nProjektet bygges nu.');
  await compile('# BID\n\nProjektet er lanceret.');
  expect(await findings()).toEqual([]);
  const r = await trail.db
    .select({ t: documents.sourceChangedAt }).from(documents).where(eq(documents.id, 'overview')).get();
  expect(r!.t).toBeNull();
});
