/**
 * F275.3 AC#0 — hele vejen igennem, talt fra en FRISK hentning af køen.
 *
 * Christians sag, ordret: *«når jeg retter et dokument i CMS, gør det at der
 * ikke kommer en ny modsigelse i køen hver gang.»* Den enhedsprøvede version
 * beviser at springet effective i funktionen; denne beviser at der ikke lander en
 * række i den kø han faktisk kigger i.
 *
 * Kontrollanten siger ALTID «de modsiger hinanden». Alt der er grønt her, er
 * derfor grønt fordi springet virkede — ikke fordi der ikke var noget at finde.
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

const ALTID_MODSIGELSE = async () => ({
  contradicts: true,
  summary: 'de siger hver sit om det samme',
  newQuote: 'lanceret',
  existingQuote: 'bygges nu',
});

/** Fælles ordforråd, så FTS-forfiltret FINDER modparten. Uden overlap ville
 *  prøven bestå fordi der ikke var nogen kandidater — ikke fordi vi sprang over. */
function tekst(hale: string) {
  return (
    'Flagskibet BID er platformen for bygherrer og entreprenører i Danmark. ' +
    'Projektet omfatter udbudsmateriale, licitation, tilbudsgivning og aftaleindgåelse ' +
    'mellem parterne i byggeriet. Platformen understøtter digitale processer hele vejen ' +
    'fra projektering til aflevering af byggeriet. ' + hale
  );
}

async function neuron(id: string, identitet: string | null, hale: string) {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/sources/', filename: `${id}.md`, title: `BID ${id}`,
    content: tekst(hale), fileType: 'md', version: 1, sourceIdentity: identitet,
  }).run();
}

/** FRISK hentning af køen — aldrig et returtal fra den funktion vi lige kaldte. */
async function modsigelserIKoeen(): Promise<number> {
  const raekker = await trail.db
    .select({ id: queueCandidates.id })
    .from(queueCandidates)
    .where(and(eq(queueCandidates.knowledgeBaseId, KB), eq(queueCandidates.kind, 'contradiction-alert')))
    .all();
  return raekker.length;
}

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `afl-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.initFTS();
  await trail.db.insert(tenants).values({ id: T, slug: 'afl', name: 'Afl', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'a@b.dk', displayName: 'A', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Afl', slug: KB, language: 'da' }).run();
  // KILDEN. Konnektoren er den der faktisk leverer broberg.ai's sider.
  await trail.db.insert(documents).values({
    id: 'source-a', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/sources/', filename: 'bid.md', content: tekst('source'), fileType: 'md',
    sourceIdentity: URL_A, metadata: JSON.stringify({ connector: 'broberg-ai-site-sync', sourceUrl: 'https://broberg.ai/flagskibe/bid' }),
  }).run();
});

test('AC#0 — to udgaver af SAMME source: NUL modsigelser i køen', async () => {
  await neuron('udgave-1', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('udgave-2', URL_A, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'udgave-2', ALTID_MODSIGELSE);
  expect(await modsigelserIKoeen()).toBe(0);
});

test('AC#1 NEGATIV KONTROL — to FORSKELLIGE kilder: modsigelsen overlever', async () => {
  // Uden denne beviser AC#0 kun at linten er tavs, ikke at den er præcis.
  await trail.db.insert(documents).values({
    id: 'source-b', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/sources/', filename: 'design.md', content: tekst('anden source'), fileType: 'md',
    sourceIdentity: URL_B, metadata: JSON.stringify({ connector: 'broberg-ai-site-sync' }),
  }).run();
  await neuron('fra-a', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('fra-b', URL_B, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'fra-b', ALTID_MODSIGELSE);
  expect(await modsigelserIKoeen()).toBeGreaterThan(0);
});

test('AC#4 POSITIV KONTROL — samme opsætning MED identitet springes over', async () => {
  // Uden den beviser prøven herunder kun at der kom noget i køen, ikke at
  // springet ville have virket hvis identiteten var der. To Neuroner der ligner
  // hinanden nok til at FTS finder dem er en forudsætning for begge halvdele,
  // og den skal måles, ikke antages.
  await neuron('med-1', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('med-2', URL_A, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'med-2', ALTID_MODSIGELSE);
  expect(await modsigelserIKoeen()).toBe(0);
});

test('AC#4 DEN SIKRE STANDARD — uden proveniens rejses modsigelsen', async () => {
  // Hele den eksisterende base har feltet tomt. Læste linten «tomt» som «samme
  // source», ville den blive usynlig for detektion i det sekund kontakten blev
  // slået til — og en modsigelse der ikke rejses ser ud som en der ikke findes.
  //
  // INTET ANDET I DENNE BRAIN. De to prøver er bevidst adskilt: lå begge
  // halvdele i samme opsætning, ville den navnløse Neuron modsige den MED
  // identitet, køen ville være ikke-tom, og prøven ville bestå selv med begge
  // null-spærrer brudt. Målt — den gjorde præcis det, og det var derfor de blev
  // delt op.
  await neuron('uden-1', null, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('uden-2', null, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'uden-2', ALTID_MODSIGELSE);
  expect(await modsigelserIKoeen()).toBeGreaterThan(0);
});

/**
 * TO SPÆRRER PÅ DEN SIKRE STANDARD, og de MASKERER hinanden:
 *
 *   ydre   `sammeKildeAfloeserHer`: ingen identitet ⇒ falsk (sparer et opslag)
 *   indre  `sameSource`:            null matcher aldrig null (den bærende)
 *
 * Brydes kun ÉN af dem, fanger den anden det, og denne fil bliver grøn. Den
 * indre spærre er derfor mutations-bevist hvor den lever alene — i
 * `packages/core/src/lint/source-supersession.test.ts`, hvor den vender 2 prøver
 * røde. AC#4-prøven herover vender først rød når BEGGE brydes, hvilket er det
 * rigtige svar for en e2e: den måler kæden, ikke det enkelte led.
 */

test('AC#3 — kontakten FRA på Brainen: linten opfører sig som før featuren fandtes', async () => {
  await trail.db.update(knowledgeBases).set({ newVersionIsCanon: false }).where(eq(knowledgeBases.id, KB)).run();
  await neuron('udgave-1', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('udgave-2', URL_A, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'udgave-2', ALTID_MODSIGELSE);
  expect(await modsigelserIKoeen()).toBeGreaterThan(0);
});

test('AC#3 — KONNEKTOR-kontakten alene er nok til at slå det fra', async () => {
  // Hierarkiet den anden vej: hovedafbryderen står på TIL, men netop denne
  // konnektor er undtaget. Uden denne prøve ville kun den grove kontakt være målt.
  await trail.db.update(knowledgeBases)
    .set({ canonOffConnectors: JSON.stringify(['broberg-ai-site-sync']) })
    .where(eq(knowledgeBases.id, KB)).run();
  await neuron('udgave-1', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('udgave-2', URL_A, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'udgave-2', ALTID_MODSIGELSE);
  expect(await modsigelserIKoeen()).toBeGreaterThan(0);
});

test('en ANDEN konnektor slukket rører ikke denne source', async () => {
  // Beviser at undtagelsen rammer den navngivne konnektor og ikke bare «en».
  await trail.db.update(knowledgeBases)
    .set({ canonOffConnectors: JSON.stringify(['upload']) })
    .where(eq(knowledgeBases.id, KB)).run();
  await neuron('udgave-1', URL_A, 'Projektet bygges nu og er endnu ikke lanceret.');
  await neuron('udgave-2', URL_A, 'Projektet er lanceret og i drift hos kunderne.');
  await scanDocForContradictions(trail, 'udgave-2', ALTID_MODSIGELSE);
  expect(await modsigelserIKoeen()).toBe(0);
});
