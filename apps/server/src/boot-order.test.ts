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

/**
 * Alt der UDFØRES i modulets top-level før serveren begynder at lytte.
 *
 * Funktions-KROPPE fjernes først. Det er ikke en detalje: bootTenantMaintenance
 * er DEFINERET før Bun.serve, og en simpel tekstsøgning ville derfor melde den
 * som en synder hver gang. Omvendt — og det er den farlige retning — fangede en
 * tidligere udgave kun linjer uden indrykning, så et vedligeholdelses-kald lagt
 * i en try-blok i top-level ville være sluppet forbi. Præcis den form opstod da
 * den primære kundes opstart blev pakket ind i try/frist (F259.5), så hullet var
 * ikke hypotetisk.
 */
function serveringsVejen(): string {
  const serve = kilde.indexOf('Bun.serve({');
  expect(serve).toBeGreaterThan(0); // uden dette anker beviser resten intet
  let hoved = kilde.slice(0, serve);

  // Fjern hver top-level funktionskrop: fra «function X(» frem til den
  // afsluttende «}» i kolonne 0.
  const uden: string[] = [];
  let i = 0;
  while (i < hoved.length) {
    const m = /(?:^|\n)(?:export )?(?:async )?function \w+/.exec(hoved.slice(i));
    if (!m) { uden.push(hoved.slice(i)); break; }
    const start = i + m.index;
    uden.push(hoved.slice(i, start));
    const slut = hoved.indexOf('\n}', start);
    if (slut === -1) break;
    i = slut + 2;
  }
  hoved = uden.join('');
  return hoved;
}

test('ingen vedligeholdelses-opgave kaldes før Bun.serve', () => {
  const vejen = serveringsVejen();
  // `navn(` — et KALD. En import nævner navnet uden parentes, og en tidligere
  // udgave meldte derfor alle tolv importer som syndere.
  const syndere = VEDLIGEHOLDELSE.filter((navn) => vejen.includes(`${navn}(`));
  expect(syndere).toEqual([]);
});

test('bootTenantMaintenance kaldes ikke i serverings-vejen', () => {
  // Den samlende funktion er lige så farlig som de tolv enkeltvis.
  expect(serveringsVejen()).not.toContain('bootTenantMaintenance(');
});

test('kunderne får KUN det nødvendige før serveren lytter', () => {
  const vejen = serveringsVejen();
  // Positiv kontrol: det nødvendige SKAL stå der. Uden denne ville prøven
  // også være grøn hvis nogen slettede hele opstarten.
  expect(vejen).toContain('bootTenantEssential(');
  expect(vejen).toContain('openTenantPool(');
});

test('det nødvendige er kun skema-operationer — intet der skalerer med basen', () => {
  const krop = kilde.slice(
    kilde.indexOf('async function bootTenantEssential'),
    kilde.indexOf('async function bootTenantMaintenance'),
  );
  expect(krop).toContain('runMigrations');
  expect(krop).toContain('initFTS');
  expect(krop).toContain('ensureIngestUser');
  for (const navn of VEDLIGEHOLDELSE) expect(krop).not.toContain(`${navn}(`);
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
