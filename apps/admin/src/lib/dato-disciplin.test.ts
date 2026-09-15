/**
 * Ingen skærm formaterer en dato uden om reglen.
 *
 * Ejeren, 15/9 2026: «datoer skal ALTID vises på dansk i mine produkter også
 * selv om sproget er Engelsk.» dates.ts holder reglen — men en regel der kun
 * findes i en hjælper er ikke håndhævet, den er blot tilgængelig.
 *
 * MÅLT DEN DAG DENNE PRØVE BLEV SKREVET: ni steder formaterede datoer, og kun
 * fire gik gennem hjælperne. Af de fem øvrige brugte TRE browserens eget sprog
 * (`toLocaleString()` uden argument, eller `undefined`), så datoen blev
 * amerikansk på en amerikansk maskine. Det er den værste variant, fordi den er
 * usynlig for os: vores egne maskiner står på dansk.
 *
 * Prøven er en LISTE, ikke et mønster. Et mønster kan ikke se forskel på en
 * dato og et tal, og `toLocaleString()` bruges helt legitimt til at sætte
 * tusindtalsseparator på et antal Neuroner.
 */
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROD = new URL('../', import.meta.url).pathname; // apps/admin/src/

/**
 * Steder hvor `toLocaleString` formaterer et TAL og ikke en dato. De skal
 * blive: et antal med dansk tusindtalsseparator er præcis det rigtige.
 *
 * Formen er `fil:tekststump`. Hver linje er en påstand et menneske kan læse
 * og være uenig i.
 */
const TAL_IKKE_DATO: ReadonlyArray<[string, string]> = [
  ['panels/kbs.tsx', 'totalNeurons.toLocaleString'],
  ['panels/kbs.tsx', 'neuronCount.toLocaleString'],
  ['panels/cost.tsx', 'credits.balance.toLocaleString'],
  ['panels/cost.tsx', 'credits.monthlyIncluded.toLocaleString'],
];

/** Filen der EJER reglen må naturligvis kalde de rå API'er. */
const REGLENS_EGEN_FIL = 'lib/dates.ts';

function kildefiler(dir: string, ud: string[] = []): string[] {
  for (const navn of readdirSync(dir)) {
    const sti = join(dir, navn);
    if (statSync(sti).isDirectory()) {
      if (navn === 'node_modules') continue;
      kildefiler(sti, ud);
    } else if ((navn.endsWith('.tsx') || navn.endsWith('.ts')) && !navn.endsWith('.test.ts')) {
      ud.push(sti);
    }
  }
  return ud;
}

/** De kald der kan producere en dato i et andet sprog end dansk. */
const RAA_FORMAT = /\.toLocaleDateString\s*\(|\.toLocaleString\s*\(|new Intl\.DateTimeFormat\s*\(/;

function fundne(): Array<{ fil: string; linje: number; tekst: string }> {
  const fund: Array<{ fil: string; linje: number; tekst: string }> = [];
  for (const sti of kildefiler(ROD)) {
    const rel = sti.slice(ROD.length);
    if (rel === REGLENS_EGEN_FIL) continue;
    const linjer = readFileSync(sti, 'utf8').split('\n');
    linjer.forEach((linje, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(linje)) return; // kommentarer beskriver, de render ikke
      if (!RAA_FORMAT.test(linje)) return;
      if (TAL_IKKE_DATO.some(([f, t]) => rel === f && linje.includes(t))) return;
      fund.push({ fil: rel, linje: i + 1, tekst: linje.trim() });
    });
  }
  return fund;
}

test('POSITIV KONTROL: prøven kan overhovedet finde et rå format-kald', () => {
  // Uden den ville «0 fund» også bestå hvis filsøgningen var gal — og så ville
  // spærren se ud som om reglen holdt, hvilket er værre end ingen spærre.
  const alle = kildefiler(ROD);
  expect(alle.length).toBeGreaterThan(40);
  expect(RAA_FORMAT.test("d.toLocaleDateString('en-US')")).toBe(true);
  expect(RAA_FORMAT.test("n.toLocaleString()")).toBe(true);
  // Reglens egen fil indeholder dem — bevis på at mønsteret matcher ægte kode.
  expect(RAA_FORMAT.test(readFileSync(join(ROD, REGLENS_EGEN_FIL), 'utf8'))).toBe(true);
});

test('ingen skærm formaterer en dato uden om lib/dates.ts', () => {
  const fund = fundne();
  const rapport = fund.map((f) => `  ${f.fil}:${f.linje}  ${f.tekst}`).join('\n');
  expect(
    fund.length,
    `rå dato-formatering uden for lib/dates.ts — brug formatLocaleDate / dansk / danskFuld:\n${rapport}`,
  ).toBe(0);
});

test('undtagelserne PEGER PÅ NOGET — en død undtagelse skjuler at vagten er holdt op med at måle', () => {
  for (const [fil, tekst] of TAL_IKKE_DATO) {
    expect(readFileSync(join(ROD, fil), 'utf8'), `${fil} indeholder ikke længere ${tekst}`).toContain(tekst);
  }
});
