/**
 * F275.1 AC#6 — INTEGRATION. Feltet må ikke kun findes i sin egen prøve.
 *
 * `identitetFraMetadata` kan være perfekt og have nul kaldesteder. Vagten læser
 * KILDEN til de ruter der faktisk modtager en kilde, og kræver at hvert sted
 * der skriver `metadata: … sourceUrl …` også sætter `sourceIdentity`.
 *
 * Tre skrivesteder i uploads.ts konstruerer den samme metadata-form. Det er
 * husets dublet-fælde: de er enige i dag, og bliver uenige den dag ét af dem
 * bliver rettet. Vagten gør uenigheden rød.
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const kilde = () => readFileSync(new URL('./uploads.ts', import.meta.url), 'utf8');

test('AC#6 hvert metadata-skrivested sætter OGSÅ sourceIdentity', () => {
  const s = kilde();

  // POSITIV KONTROL FØRST: kan vagten overhovedet finde et skrivested? Uden
  // den ville en omdøbt fil give nul træf, og påstanden bestå på ingenting.
  // MÅLT: et énlinje-mønster (/metadata:[^\n]*sourceUrl/) fandt kun 2 af 3.
  // Det tredje skrivested strækker sig over flere linjer (en ternær). En vagt
  // der tæller for lavt, siger grønt om et sted den aldrig så.
  const steder = [...s.matchAll(/metadata:[\s\S]{0,220}?sourceUrl/g)];
  expect(steder.length).toBeGreaterThanOrEqual(3);

  for (const m of steder) {
    const efter = s.slice(m.index!, m.index! + 400);
    expect(efter, `metadata-skrivested uden sourceIdentity:\n${efter.slice(0, 180)}`)
      .toContain('sourceIdentity');
  }
});

test('AC#6 identiteten har kaldesteder UDEN FOR sine egne prøver', () => {
  // En hjælpefunktion ingen kalder er ikke en integration.
  const s = kilde();
  expect(s).toContain("kildeIdentitet('url'");
  expect((s.match(/kildeIdentitet\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
});

test('NEGATIV KONTROL: vagten kan faktisk sige nej', () => {
  expect(kilde()).not.toContain('en-streng-der-med-sikkerhed-ikke-staar-i-filen');
});
