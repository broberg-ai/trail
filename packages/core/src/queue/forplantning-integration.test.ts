/**
 * F275.5 AC#5 + AC#2 — forplantningen kører på den vej der FAKTISK modtager en
 * ny kildeversion, og en afhængig side der ikke blev nået giver et SYNLIGT fund.
 *
 * AC#2 er den vigtige: rammer afløsningen kun kilde-Neuronen, bliver køen ren
 * mens hjernen stadig svarer på gårsdagens tekst — og det er VÆRRE end i dag,
 * fordi det ikke længere ligner et problem. Derfor må tavshed aldrig være
 * udfaldet når der ER afhængige sider.
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
const MASKINE = { id: U, kind: 'llm' as const };
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

/** Kompilerer en side FRA kilden — som ingest-vejen gør det. */
async function kompiler(indhold: string, sourceDocumentId?: string) {
  const { candidate, approval } = await createCandidate(
    trail, T,
    {
      knowledgeBaseId: KB, kind: 'ingest-summary', title: 'BID', content: indhold, confidence: 0.5,
      metadata: JSON.stringify({
        op: 'create', filename: 'bid.md', path: '/neurons/sources/',
        ...(sourceDocumentId ? { sourceDocumentId } : {}),
      }),
    },
    MASKINE,
  );
  return approval ?? resolveCandidate(trail, T, candidate.id, MASKINE, { actionId: 'approve' });
}

async function fund() {
  return trail.db
    .select({ title: queueCandidates.title, content: queueCandidates.content, metadata: queueCandidates.metadata })
    .from(queueCandidates)
    .where(and(eq(queueCandidates.tenantId, T), eq(queueCandidates.kind, 'gap-detection')))
    .all();
}

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `fpi-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'fpi', name: 'Fpi', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f@i.dk', displayName: 'F', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Fpi', slug: KB, language: 'da' }).run();
  // KILDEN, med identitet (F275.1).
  await trail.db.insert(documents).values({
    id: 'kilde-bid', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/sources/', filename: 'bid.md', content: 'kildetekst', fileType: 'md', sourceIdentity: URL_A,
  }).run();
  // OVERVIEW — citerer kilden, bærer IKKE dens identitet. Den side der stod
  // forkert i nat, og som ingen anden mekanisme finder.
  await trail.db.insert(documents).values({
    id: 'overview', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/', filename: 'overview.md', title: 'Overblik', content: 'Projektet bygges nu.', fileType: 'md',
  }).run();
  await trail.db.insert(documentReferences).values({
    id: 'r1', tenantId: T, knowledgeBaseId: KB,
    wikiDocumentId: 'overview', sourceDocumentId: 'kilde-bid', claimAnchor: 'c1',
  }).run();
});

test('AC#5 DEN BÆRENDE: en GENKOMPILERING udløser forplantningen på den ægte vej', async () => {
  await kompiler('# BID\n\nProjektet bygges nu.', 'kilde-bid');
  expect(await fund()).toEqual([]);   // første kompilering afløser ingenting

  await kompiler('# BID\n\nProjektet er lanceret.', 'kilde-bid');
  const f = await fund();
  expect(f.length).toBe(1);
  expect(f[0]!.title).toContain('1 side hænger på en kilde');
  expect(f[0]!.content).toContain('Overblik');
  expect(f[0]!.content).toContain('citerer kilden');
});

test('AC#2 — den afhængige side MÆRKES, så den ikke svarer som om intet var sket', async () => {
  await kompiler('# BID\n\nProjektet bygges nu.', 'kilde-bid');
  await kompiler('# BID\n\nProjektet er lanceret.', 'kilde-bid');
  const r = await trail.db
    .select({ t: documents.sourceChangedAt }).from(documents).where(eq(documents.id, 'overview')).get();
  expect(typeof r!.t).toBe('number');
});

test('AC#2 — siden der BLEV kompileret om mærkes IKKE; den er jo ajour', async () => {
  const f = await kompiler('# BID\n\nProjektet bygges nu.', 'kilde-bid');
  await kompiler('# BID\n\nProjektet er lanceret.', 'kilde-bid');
  const r = await trail.db
    .select({ t: documents.sourceChangedAt, i: documents.sourceIdentity })
    .from(documents).where(eq(documents.id, f.documentId!)).get();
  expect(r!.i).toBe(URL_A);
  expect(r!.t).toBeNull();
});

test('NEGATIV KONTROL — en genkompilering UDEN afhængige melder intet', async () => {
  // Uden den ville «meld altid» bestå lige så grønt, og køen ville få en
  // besked ved hver eneste gen-synkronisering fra sitet.
  await trail.db.delete(documentReferences).where(eq(documentReferences.id, 'r1')).run();
  await kompiler('# BID\n\nProjektet bygges nu.', 'kilde-bid');
  await kompiler('# BID\n\nProjektet er lanceret.', 'kilde-bid');
  expect(await fund()).toEqual([]);
});

test('NEGATIV KONTROL — en kompilering UDEN kendt kilde forplanter intet', async () => {
  // Ingen identitet betyder «vi ved det ikke». Markerede vi på den, ville en
  // enkelt kompilering kunne stemple hele den ikke-backfill'ede base.
  await kompiler('# BID\n\nProjektet bygges nu.');
  await kompiler('# BID\n\nProjektet er lanceret.');
  expect(await fund()).toEqual([]);
  const r = await trail.db
    .select({ t: documents.sourceChangedAt }).from(documents).where(eq(documents.id, 'overview')).get();
  expect(r!.t).toBeNull();
});
