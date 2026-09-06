/**
 * F259 — INGEN VEDLIGEHOLDELSE MÅ LIGGE FØR `Bun.serve`.
 *
 * Det er dét der væltede produktionen 6/9: opstarten kørte tolv idempotente
 * vedligeholdelses-opgaver PR. KUNDE i en top-level await, før serveren
 * begyndte at lytte. broberg-ai hang i 283 sekunder, kastede en timeout, og en
 * afvist top-level await afslutter processen. Tre kunder lå ned.
 *
 * HVORFOR PRØVEN LÆSER KILDEN i stedet for at køre koden: index.ts ER
 * opstarten — at importere den åbner databaser, starter timere og lytter på en
 * port. Egenskaben der skal bevogtes er en RÆKKEFØLGE i modulets top-level, og
 * den kan læses direkte. En prøve der ikke kan læse det den skal bevogte, er en
 * prøve der beviser noget andet.
 *
 * MUTATIONS-BEVIST 6/9: flyttes ét vedligeholdelses-kald (fx
 * `backfillContentHash`) tilbage over `Bun.serve`, går prøven RØD og navngiver
 * det. Uden den ville en tilbagerulning se grøn ud.
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const kilde = readFileSync(join(import.meta.dir, 'index.ts'), 'utf-8');

/** De tolv opgaver der IKKE må blokere betjeningen. */
const VEDLIGEHOLDELSE = [
  'recoverZombieIngests',
  'rewriteWikiToNeurons',
  'cleanupExternalOrphans',
  'seedMissingGlossaryNeurons',
  'recoverPendingSources',
  'backfillContentHash',
  'backfillDocumentImages',
  'rerunVisionOnNull',
  'fixImageSlash',
  'sweepAutoFlag',
  'seedDevCreditsOnBoot',
  'recoverIngestJobs',
];

/** Alt fra modulets top-level der udføres FØR serveren begynder at lytte. */
function serveringsVejen(): string {
  const serve = kilde.indexOf('Bun.serve({');
  expect(serve).toBeGreaterThan(0); // uden dette anker beviser resten intet
  const linjer = kilde.slice(0, serve).split('\n');
  // Kun top-level sætninger: en linje uden indrykning der begynder med `await`
  // eller `const … = await`. Funktions-KROPPE er indrykkede og tæller ikke —
  // bootTenantMaintenance må gerne DEFINERES her, den må bare ikke KALDES.
  return linjer.filter((l) => /^(await |const .*await |let .*await )/.test(l)).join('\n');
}

test('ingen vedligeholdelses-opgave kaldes før Bun.serve', () => {
  const vejen = serveringsVejen();
  const syndere = VEDLIGEHOLDELSE.filter((navn) => vejen.includes(navn));
  expect(syndere).toEqual([]);
});

test('bootTenantMaintenance kaldes ikke i serverings-vejen', () => {
  // Den samlende funktion er lige så farlig som de tolv enkeltvis.
  expect(serveringsVejen()).not.toContain('bootTenantMaintenance');
});

test('kunderne får KUN det nødvendige før serveren lytter', () => {
  const vejen = serveringsVejen();
  // Positiv kontrol: det nødvendige SKAL stå der. Uden denne ville prøven
  // også være grøn hvis nogen slettede hele opstarten.
  expect(vejen).toContain('bootTenantEssential');
  expect(vejen).toContain('openTenantPool');
});

test('det nødvendige er kun skema-operationer — intet der skalerer med basen', () => {
  const krop = kilde.slice(
    kilde.indexOf('async function bootTenantEssential'),
    kilde.indexOf('async function bootTenantMaintenance'),
  );
  expect(krop).toContain('runMigrations');
  expect(krop).toContain('initFTS');
  expect(krop).toContain('ensureIngestUser');
  for (const navn of VEDLIGEHOLDELSE) expect(krop).not.toContain(navn);
});

test('vedligeholdelsen kører EFTER serveren — i den udskudte fejning', () => {
  const serve = kilde.indexOf('Bun.serve({');
  const deferred = kilde.indexOf('async function bootTenantDeferred');
  expect(deferred).toBeGreaterThan(0);
  const krop = kilde.slice(deferred, kilde.indexOf('\n}', deferred));
  expect(krop).toContain('bootTenantMaintenance');
  // og fejningen sættes i gang efter Bun.serve
  expect(kilde.indexOf('bootTenantDeferred(slug, db)')).toBeGreaterThan(serve);
});

test('alle tolv vedligeholdelses-navne findes stadig i filen', () => {
  // NEGATIV KONTROL mod prøven selv: staves et navn forkert her, ville
  // «ingen syndere» blive grøn ved et stavefejl frem for ved en rigtig
  // rækkefølge. Denne prøve går rød hvis listen holder op med at pege på
  // ægte kode.
  for (const navn of VEDLIGEHOLDELSE) expect(kilde).toContain(navn);
});
