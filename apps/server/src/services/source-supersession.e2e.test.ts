/**
 * F275.3 AC#0 — the whole way through, counted from a FRESH read of the queue.
 *
 * The owner's case, verbatim: *"when I edit a document in the CMS, it means a new
 * contradiction does not land in the queue every time."* The unit-tested version
 * proves the skip works inside the function; this one proves no row lands in the
 * queue he actually looks at.
 *
 * The checker ALWAYS says "these contradict each other". So everything green here
 * is green because the skip worked — not because there was nothing to find.
 *
 * The document text is Danish because the pages this lint runs over are Danish,
 * and the full-text pre-filter tokenises them.
 */
import { test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, documents, queueCandidates } from '@trail/db';
import { eq, and } from 'drizzle-orm';
import { scanDocForContradictions } from './contradiction-lint.js';

const T = 't-afl', U = 'u-afl', KB = 'kb-afl';
const URL_A = 'url:https://broberg.ai/flagskibe/bid';
const URL_B = 'url:https://broberg.ai/indsigter/design';
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

const ALWAYS_CONTRADICTS = async () => ({
  contradicts: true,
  summary: 'de siger hver sit om det samme',
  newQuote: 'lanceret',
  existingQuote: 'bygges nu',
});

/** Shared vocabulary, so the full-text pre-filter FINDS the counterpart. Without
 *  overlap the test would pass because there were no candidates — not because we
 *  skipped. */
function text(tail: string) {
  return (
    'Flagskibet BID er platformen for bygherrer og entreprenører i Danmark. ' +
    'Projektet omfatter udbudsmateriale, licitation, tilbudsgivning og aftaleindgåelse ' +
    'mellem parterne i byggeriet. Platformen understøtter digitale processer hele vejen ' +
    'fra projektering til aflevering af byggeriet. ' + tail
  );
}

async function neuron(id: string, identity: string | null, tail: string) {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/sources/', filename: `${id}.md`, title: `BID ${id}`,
    content: text(tail), fileType: 'md', version: 1, sourceIdentity: identity,
  }).run();
}

/** A FRESH read of the queue — never a return value from the function we just
 *  called. */
async function contradictionsInQueue(): Promise<number> {
  const rows = await trail.db
    .select({ id: queueCandidates.id })
    .from(queueCandidates)
    .where(and(eq(queueCandidates.knowledgeBaseId, KB), eq(queueCandidates.kind, 'contradiction-alert')))
    .all();
  return rows.length;
}

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `afl-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* fresh */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.initFTS();
  await trail.db.insert(tenants).values({ id: T, slug: 'afl', name: 'Afl', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'a@b.dk', displayName: 'A', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Afl', slug: KB, language: 'da' }).run();
  // THE SOURCE. The connector is the one that actually delivers broberg.ai's pages.
  await trail.db.insert(documents).values({
    id: 'source-a', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/sources/', filename: 'bid.md', content: text('kilde'), fileType: 'md',
    sourceIdentity: URL_A, metadata: JSON.stringify({ connector: 'broberg-ai-site-sync', sourceUrl: 'https://broberg.ai/flagskibe/bid' }),
  }).run();
});

test('AC#0 — two editions of the SAME source: ZERO contradictions in the queue', async () => {
  await neuron('edition-1', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('edition-2', URL_A, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'edition-2', ALWAYS_CONTRADICTS);
  expect(await contradictionsInQueue()).toBe(0);
});

test('AC#1 NEGATIVE CONTROL — two DIFFERENT sources: the contradiction survives', async () => {
  // Without this, AC#0 only proves the lint is silent, not that it is precise.
  await trail.db.insert(documents).values({
    id: 'source-b', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/sources/', filename: 'design.md', content: text('anden kilde'), fileType: 'md',
    sourceIdentity: URL_B, metadata: JSON.stringify({ connector: 'broberg-ai-site-sync' }),
  }).run();
  await neuron('from-a', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('from-b', URL_B, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'from-b', ALWAYS_CONTRADICTS);
  expect(await contradictionsInQueue()).toBeGreaterThan(0);
});

test('AC#4 POSITIVE CONTROL — the same setup WITH an identity is skipped', async () => {
  // Without it, the test below only proves something landed in the queue, not
  // that the skip would have worked had the identity been there. Two Neurons
  // similar enough for full-text search to find each other is a precondition for
  // both halves, and it must be measured, not assumed.
  await neuron('with-1', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('with-2', URL_A, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'with-2', ALWAYS_CONTRADICTS);
  expect(await contradictionsInQueue()).toBe(0);
});

test('AC#4 THE SAFE DEFAULT — with no provenance the contradiction is raised', async () => {
  // The entire existing base has the field empty. If the lint read "empty" as
  // "same source", it would go invisible to detection the second the switch was
  // turned on — and a contradiction that is never raised looks exactly like one
  // that does not exist.
  //
  // NOTHING ELSE IN THIS BRAIN. The two tests are deliberately separated: with
  // both halves in one setup, the nameless Neuron would contradict the one WITH
  // an identity, the queue would be non-empty, and the test would pass even with
  // both null guards broken. Measured — it did exactly that, which is why they
  // were split.
  await neuron('without-1', null, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('without-2', null, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'without-2', ALWAYS_CONTRADICTS);
  expect(await contradictionsInQueue()).toBeGreaterThan(0);
});

/**
 * TWO GUARDS ON THE SAFE DEFAULT, and they MASK each other:
 *
 *   outer  `sameSourceSupersedesHere`: no identity ⇒ false (saves a lookup)
 *   inner  `sameSource`:               null never matches null (load-bearing)
 *
 * Break only ONE and the other catches it, and this file stays green. The inner
 * guard is therefore mutation-proven where it lives alone — in
 * `packages/core/src/lint/source-supersession.test.ts`, where it turns 2 tests
 * red. The AC#4 test above only goes red when BOTH are broken, which is the right
 * answer for an e2e: it measures the chain, not the individual link.
 */

test('AC#3 — the Brain switch OFF: the lint behaves as before the feature existed', async () => {
  await trail.db.update(knowledgeBases).set({ newVersionIsCanon: false }).where(eq(knowledgeBases.id, KB)).run();
  await neuron('edition-1', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('edition-2', URL_A, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'edition-2', ALWAYS_CONTRADICTS);
  expect(await contradictionsInQueue()).toBeGreaterThan(0);
});

test('AC#3 — the CONNECTOR switch alone is enough to turn it off', async () => {
  // The hierarchy from the other side: the master switch is ON, but this
  // particular connector is exempted. Without this test only the coarse switch
  // would have been measured.
  await trail.db.update(knowledgeBases)
    .set({ canonOffConnectors: JSON.stringify(['broberg-ai-site-sync']) })
    .where(eq(knowledgeBases.id, KB)).run();
  await neuron('edition-1', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('edition-2', URL_A, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'edition-2', ALWAYS_CONTRADICTS);
  expect(await contradictionsInQueue()).toBeGreaterThan(0);
});

test('a DIFFERENT connector being off does not touch this source', async () => {
  // Proves the exemption hits the named connector and not merely "a" connector.
  await trail.db.update(knowledgeBases)
    .set({ canonOffConnectors: JSON.stringify(['upload']) })
    .where(eq(knowledgeBases.id, KB)).run();
  await neuron('edition-1', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('edition-2', URL_A, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'edition-2', ALWAYS_CONTRADICTS);
  expect(await contradictionsInQueue()).toBe(0);
});
