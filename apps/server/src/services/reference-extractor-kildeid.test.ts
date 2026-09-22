/**
 * F288.1 — bagfyldningen skal ramme DEN kilde kalderen navngav.
 *
 * MÅLT I PRODUKTION 22. september 2026, Music-hjernen i broberg-ai: kilden
 * 181c3073 stod `ready` med neuronCount 0, mens 8 Neuroner kompileret fra den
 * fandtes og var søgbare. Det tal er ikke kosmetik — det er den eneste
 * maskinlæsbare måde at skelne «kilden ligger der» fra «kilden har produceret
 * noget», og en peer læste det som netop den kontrol.
 *
 * Årsagen: `/local-compiled` sendte `doc.filename` til bagfyldningen selvom den
 * havde `doc.id` i hånden, og `findSourceByName` kan ikke skelne to AKTIVE
 * kilder med samme filnavn — `.get()` vælger én, og SQLite bestemmer hvilken.
 *
 * Testene her er skrevet så de IKKE kan bestå ved et tilfælde: begge
 * indsættelses-rækkefølger prøves, så «den rigtige blev valgt» ikke kan være
 * held med hvilken række der lå først.
 */
import { test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, documents, documentReferences } from '@trail/db';
import { eq, and } from 'drizzle-orm';
import { backfillReferencesForSource } from './reference-extractor.js';

const T = 't-f288', U = 'u-f288', KB = 'kb-f288';
const FILNAVN = 'musicbrainz-561d854a.md';
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `f288-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'f288', name: 'F288', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f@288.dk', displayName: 'F', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'F288', slug: KB, language: 'en' }).run();
});

/** En kilde med det DELTE filnavn — kun sourceUrl adskiller de to, præcis som
 *  upload-rutens upsert tillader (den slår op på sourceUrl, ikke på navn). */
async function kilde(id: string, url: string): Promise<void> {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/', filename: FILNAVN, content: '# Miles Davis', fileType: 'md',
    metadata: JSON.stringify({ sourceUrl: url }),
  }).run();
}

async function neuron(id: string): Promise<void> {
  await trail.db.insert(documents).values({
    id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/entities/', filename: `${id}.md`, title: id,
    content: `---\ntitle: ${id}\ntype: entity\nsources: ["${FILNAVN}"]\n---\n\n# ${id}\n`,
    fileType: 'md',
  }).run();
}

async function neuronCount(kildeId: string): Promise<number> {
  return (await trail.db.select().from(documentReferences)
    .where(and(eq(documentReferences.sourceDocumentId, kildeId), eq(documentReferences.knowledgeBaseId, KB)))
    .all()).length;
}

test('LOAD-BEARING: med to aktive kilder på samme filnavn rammer referencen DEN kilde id-et peger på', async () => {
  await kilde('kilde-a', 'https://mb.org/x#nonce-1');
  await kilde('kilde-b', 'https://mb.org/x#nonce-2');
  await neuron('miles-davis');

  await backfillReferencesForSource(trail, KB, FILNAVN, 'kilde-b');

  // Streng lighed på BEGGE tal. «kilde-b fik 1» alene ville bestå selvom
  // kilde-a også havde fået én — og så var samme Neuron talt to gange.
  expect([await neuronCount('kilde-b'), await neuronCount('kilde-a')]).toEqual([1, 0]);
});

/**
 * MUTATIONS-MÅLT, og resultatet er værd at skrive ned: fjernes rettelsen,
 * bliver testen OVENFOR rød og denne her BLIVER GRØN. Det er ikke en svaghed
 * ved den — det er selve beviset for hvad fejlen var. Uden rettelsen afgøres
 * valget af indsættelses-rækkefølgen, så én af de to rækkefølger rammer
 * rigtigt ved et tilfælde. Havde jeg kun skrevet DENNE test, ville jeg have
 * målt held og kaldt det en rettelse.
 */
test('og det gælder også med kilderne indsat i omvendt rækkefølge — ikke held med hvilken række der lå først', async () => {
  await kilde('kilde-b', 'https://mb.org/x#nonce-2');
  await kilde('kilde-a', 'https://mb.org/x#nonce-1');
  await neuron('miles-davis');

  await backfillReferencesForSource(trail, KB, FILNAVN, 'kilde-b');

  expect([await neuronCount('kilde-b'), await neuronCount('kilde-a')]).toEqual([1, 0]);
});

test('UDEN id opfører den sig som før — den navnebaserede vej er ikke fjernet', async () => {
  // Ingen naked cutover: boot-bagfyldningen har intet id at give, og dens vej
  // skal stadig virke. Her er der KUN én kilde, så navneopslaget er entydigt.
  await kilde('kilde-eneste', 'https://mb.org/x');
  await neuron('miles-davis');

  const skrevet = await backfillReferencesForSource(trail, KB, FILNAVN);

  expect(skrevet).toBe(1);
  expect(await neuronCount('kilde-eneste')).toBe(1);
});

test('id-et bruges KUN til det filnavn det hører til — en anden citeret kilde slås stadig op', async () => {
  // Ellers ville et id smitte af på hver eneste kilde en Neuron citerer.
  await kilde('kilde-b', 'https://mb.org/x');
  await trail.db.insert(documents).values({
    id: 'kilde-anden', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/', filename: 'wikipedia-miles.md', content: '# Wikipedia', fileType: 'md',
  }).run();
  await trail.db.insert(documents).values({
    id: 'n-to-kilder', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/entities/', filename: 'n-to-kilder.md', title: 'To kilder',
    content: `---\ntitle: To kilder\ntype: entity\nsources: ["${FILNAVN}", "wikipedia-miles.md"]\n---\n\n# To kilder\n`,
    fileType: 'md',
  }).run();

  await backfillReferencesForSource(trail, KB, FILNAVN, 'kilde-b');

  expect([await neuronCount('kilde-b'), await neuronCount('kilde-anden')]).toEqual([1, 1]);
});
