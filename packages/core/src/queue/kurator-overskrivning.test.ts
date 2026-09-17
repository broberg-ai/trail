/**
 * F275.3 AC#5 — en kurator-redigeret Neuron overskrives ikke TAVST.
 *
 * «Samme kilde, ny udgave er kanon» er hele F275, og den skal også gælde en
 * side et menneske har rettet i. Det der ikke må ske, er at rettelsen forsvinder
 * uden at nogen får det at vide: et lydløst indgreb kan ikke skelnes fra at
 * intet skete, og kuratoren opdager først sin manglende tekst ved et tilfælde.
 *
 * Målt gennem den ÆGTE vej — createCandidate + resolveCandidate — og ikke på en
 * hjælpefunktion. Detektionen sidder i approve-materialiseringen; en prøve på
 * noget andet ville være grøn uden at bevise at den bliver kaldt.
 */
import { test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  createLibsqlDatabase,
  tenants,
  users,
  knowledgeBases,
  documents,
  queueCandidates,
  wikiEvents,
} from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { createCandidate, resolveCandidate, submitCuratorEdit } from './candidates.js';

const T = 't-ko', U = 'u-ko', KB = 'kb-ko';
// Sådan gør kompileringen selv: LLM_ACTOR(ctx.userId) — maskinens skrivning
// hænger på en RIGTIG bruger, det er kun `kind` der er 'llm'.
const MASKINE = { id: U, kind: 'llm' as const };
const KURATOR = { id: U, kind: 'user' as const };
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

/** Skriver en Neuron gennem den rigtige kø — som en kompilering ville. */
async function kompiler(indhold: string) {
  const { candidate, approval } = await createCandidate(
    trail, T,
    {
      knowledgeBaseId: KB,
      kind: 'ingest-summary',
      title: 'BID',
      content: indhold,
      confidence: 0.5,
      metadata: JSON.stringify({ op: 'create', filename: 'bid.md', path: '/neurons/sources/' }),
    },
    MASKINE,
  );
  // `ingest-summary` er en BETROET art og godkendes automatisk af F19-politikken
  // — så kandidaten er allerede afgjort når createCandidate vender tilbage.
  // Kaldte vi resolveCandidate bagefter, ville prøven fejle på «ikke pending»,
  // og det ville ligne en fejl i featuren frem for i prøven.
  return approval ?? resolveCandidate(trail, T, candidate.id, MASKINE, { actionId: 'approve' });
}

/** Kuratorens egen redigering — den vej admin-editoren bruger. */
async function kuratorRetter(docId: string, indhold: string) {
  const nu = await trail.db
    .select({ v: documents.version }).from(documents).where(eq(documents.id, docId)).get();
  return submitCuratorEdit(trail, T, docId, { content: indhold, expectedVersion: nu!.v }, KURATOR);
}

async function konflikterIKoeen() {
  return trail.db
    .select({ id: queueCandidates.id, title: queueCandidates.title, content: queueCandidates.content })
    .from(queueCandidates)
    .where(and(eq(queueCandidates.tenantId, T), eq(queueCandidates.kind, 'version-conflict')))
    .all();
}

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `ko-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'ko', name: 'Ko', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'k@o.dk', displayName: 'K', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Ko', slug: KB, language: 'da' }).run();
});

test('AC#5 DEN BÆRENDE: kuratorens rettelse overskrives — men den MELDES, ordret', async () => {
  const foerste = await kompiler('# BID\n\nProjektet bygges nu.');
  const docId = foerste.documentId!;

  // Kuratoren retter siden i hånden.
  const menneskeTekst = '# BID\n\nProjektet bygges nu. RETTET AF ET MENNESKE: datoen er 4. november.';
  await kuratorRetter(docId, menneskeTekst);
  const efterRedigering = await trail.db
    .select({ v: documents.version, c: documents.content }).from(documents).where(eq(documents.id, docId)).get();

  // Kilden kompileres igen — maskinen skriver ovenpå.
  await kompiler('# BID\n\nProjektet er lanceret.');

  const konflikter = await konflikterIKoeen();
  expect(konflikter.length).toBe(1);
  // ORDRET, ikke et resumé: kuratoren skal kunne sætte sin egen tekst tilbage.
  expect(konflikter[0]!.content).toContain(efterRedigering!.c!);
  expect(konflikter[0]!.title).toContain('blev skrevet over');

  // Og siden ER skrevet over — vi ruller ikke tilbage midt i en kompilering.
  const nu = await trail.db.select({ c: documents.content }).from(documents).where(eq(documents.id, docId)).get();
  expect(nu!.c).toContain('lanceret');
});

test('AC#5 NEGATIV KONTROL: uden en menneskelig rettelse meldes INTET', async () => {
  // Uden den ville «meld altid» bestå lige så grønt som reglen — og køen ville
  // fyldes med en besked ved hver eneste gen-synkronisering fra sitet.
  await kompiler('# BID\n\nProjektet bygges nu.');
  await kompiler('# BID\n\nProjektet er lanceret.');
  expect(await konflikterIKoeen()).toEqual([]);
});

test('AC#5 — beskeden gentages IKKE ved næste maskinelle skrivning', async () => {
  // Signalet er den SENESTE hændelse, ikke «har der nogensinde været en».
  // En besked man lærer at klikke væk er ingen besked.
  const f = await kompiler('# BID\n\nProjektet bygges nu.');
  await kuratorRetter(f.documentId!, '# BID\n\nRettet i hånden.');
  await kompiler('# BID\n\nUdgave 2.');
  expect((await konflikterIKoeen()).length).toBe(1);
  await kompiler('# BID\n\nUdgave 3.');
  expect((await konflikterIKoeen()).length).toBe(1);
});

test('en KURATORS egen skrivning udløser ikke beskeden om sig selv', async () => {
  const f = await kompiler('# BID\n\nProjektet bygges nu.');
  await kuratorRetter(f.documentId!, '# BID\n\nFørste rettelse.');
  await kuratorRetter(f.documentId!, '# BID\n\nAnden rettelse.');
  expect(await konflikterIKoeen()).toEqual([]);
});

test('hændelsen der bærer beviset findes — ellers meldes der intet at gendanne', async () => {
  // Beskeden er kun værd at sende fordi den bærer kuratorens EGEN tekst.
  // Findes øjebliksbilledet ikke, er den en påmindelse om et tab uden indhold.
  const f = await kompiler('# BID\n\nProjektet bygges nu.');
  await kuratorRetter(f.documentId!, '# BID\n\nRettet.');
  const h = await trail.db
    .select({ k: wikiEvents.actorKind, t: wikiEvents.eventType, s: wikiEvents.contentSnapshot })
    .from(wikiEvents).where(eq(wikiEvents.documentId, f.documentId!)).all();
  const sidste = h[h.length - 1]!;
  expect([sidste.k, sidste.t]).toEqual(['user', 'edited']);
  expect(sidste.s).toContain('Rettet.');
});
