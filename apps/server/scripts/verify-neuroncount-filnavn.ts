/**
 * Reproduktion: en kilde står `ready` med neuronCount 0, mens dens Neuroner
 * findes og er søgbare.
 *
 * MÅLT I PRODUKTION 22. september 2026, Music-hjernen i broberg-ai: kilden
 * 181c3073 står `ready` med 8 Neuroner kompileret fra den, og listesvarets
 * `neuronCount` siger 0. Det tal er ikke kosmetik — forager læser netop det
 * felt som deres kontrol på om en afsendt kilde har PRODUCERET noget, og
 * Trails egen Kilde-visning bruger det til badge'et «ready + 0 = kompileret,
 * men gav intet».
 *
 * HYPOTESEN DETTE SCRIPT AFGØR. `neuronCount` tæller rækker i
 * document_references. De udfyldes af backfillReferencesForSource(), som slår
 * kilden op på FILNAVN (resolveSource, strategi 1: eq(documents.filename, …)
 * + `.get()`). Havde to AKTIVE kilder samme filnavn i det øjeblik — hvilket de
 * havde, fordi forager sendte samme MusicBrainz-fil to gange med hver sin
 * sourceUrl — så vælger `.get()` ÉN af dem, og SQLite bestemmer hvilken.
 *
 * Er det rigtigt, kan referencerne lande på den FORKERTE kilde, og den rigtige
 * står tilbage med 0. Scriptet beviser eller aflives hypotesen med en rigtig
 * DB og den rigtige funktion — ikke ved at læse koden og gætte.
 *
 * Kør:  bun run apps/server/scripts/verify-neuroncount-filnavn.ts
 * Koster ingenting: lokal fil-DB, ingen provider, ingen netværk.
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, documents, documentReferences } from '@trail/db';
import { eq, and } from 'drizzle-orm';
import { backfillReferencesForSource } from '../src/services/reference-extractor.js';

const T = 't-nc', U = 'u-nc', KB = 'kb-nc';
const FILNAVN = 'musicbrainz-561d854a.md';

async function main(): Promise<void> {
  const p = join(process.env.TMPDIR ?? '/tmp', `nc-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  const trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'nc', name: 'NC', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'n@c.dk', displayName: 'N', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'NC', slug: KB, language: 'en' }).run();

  // To AKTIVE kilder med SAMME filnavn — præcis produktionens tilstand.
  // Kun sourceUrl adskiller dem, og det er netop den forskel upload-ruten
  // tillader (F275.1's upsert slår op på sourceUrl, ikke på filnavn).
  for (const [id, url] of [['kilde-gammel', 'https://mb.org/a#nonce-1'], ['kilde-ny', 'https://mb.org/a#nonce-2']] as const) {
    await trail.db.insert(documents).values({
      id, tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
      path: '/', filename: FILNAVN, content: '# Miles Davis', fileType: 'md',
      metadata: JSON.stringify({ sourceUrl: url }),
    }).run();
  }

  // Én Neuron der citerer kilden ved filnavn i sin frontmatter — som den
  // lokale kompilering skriver den.
  await trail.db.insert(documents).values({
    id: 'neuron-1', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'wiki',
    path: '/neurons/entities/', filename: 'miles-davis.md', title: 'Miles Davis',
    content: `---\ntitle: Miles Davis\ntype: entity\nsources: ["${FILNAVN}"]\n---\n\n# Miles Davis\n`,
    fileType: 'md',
  }).run();

  const skrevet = await backfillReferencesForSource(trail, KB, FILNAVN);
  const refs = await trail.db.select().from(documentReferences).all();

  console.log(`backfill skrev ${skrevet} reference(r)`);
  for (const r of refs) console.log(`  ${r.wikiDocumentId}  ->  ${r.sourceDocumentId}`);

  // Det tal Kilde-visningen og forager læser: rækker i document_references
  // pr. kilde.
  for (const id of ['kilde-gammel', 'kilde-ny']) {
    const n = (await trail.db.select().from(documentReferences)
      .where(and(eq(documentReferences.sourceDocumentId, id), eq(documentReferences.knowledgeBaseId, KB)))
      .all()).length;
    console.log(`  neuronCount(${id}) = ${n}`);
  }

  const ramteNy = refs.some((r) => r.sourceDocumentId === 'kilde-ny');
  const ramteGammel = refs.some((r) => r.sourceDocumentId === 'kilde-gammel');
  console.log('');
  if (refs.length === 0) {
    console.log('UDFALD: ingen reference skrevet overhovedet — hypotesen var forkert, årsagen ligger et andet sted.');
  } else if (ramteGammel && !ramteNy) {
    console.log('UDFALD: referencen landede på den GAMLE kilde. Arkiveres eller erstattes den,');
    console.log('        står den nye tilbage med neuronCount 0 selvom Neuronerne findes.');
    console.log('        HYPOTESEN BEKRÆFTET.');
  } else if (ramteNy && !ramteGammel) {
    console.log('UDFALD: referencen landede på den NYE kilde — heldigt denne gang, men');
    console.log('        valget er stadig SQLites og ikke vores. Hypotesen står.');
  } else {
    console.log('UDFALD: referencen landede på BEGGE — så tælles den samme Neuron to gange.');
  }
}

await main();
