/**
 * F275.1 AC#6 — INTEGRATION. Feltet må ikke kun findes i sin egen prøve.
 *
 * `identityFromMetadata` kan være perfekt og have nul kaldesteder. Vagten læser
 * KILDEN til de ruter der faktisk modtager en source, og kræver at hvert sted
 * der skriver `metadata: … sourceUrl …` også sætter `sourceIdentity`.
 *
 * Tre skrivesteder i uploads.ts konstruerer den samme metadata-form. Det er
 * husets dublet-fælde: de er enige i dag, og bliver uenige den dag ét af dem
 * bliver rettet. Vagten gør uenigheden rød.
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = () => readFileSync(new URL('./uploads.ts', import.meta.url), 'utf8');

test('AC#6 hvert metadata-skrivested sætter OGSÅ sourceIdentity', () => {
  const s = source();

  // POSITIV KONTROL FØRST: kan vagten overhovedet finde et skrivested? Uden
  // den ville en omdøbt fil give nul træf, og påstanden bestå på ingenting.
  // MÅLT: et énlinje-mønster (/metadata:[^\n]*sourceUrl/) fandt kun 2 af 3.
  // Det tredje skrivested strækker sig over flere lines (en ternær). En vagt
  // der tæller for lavt, siger grønt om et sted den aldrig så.
  const sites = [...s.matchAll(/metadata:[\s\S]{0,220}?sourceUrl/g)];
  expect(sites.length).toBeGreaterThanOrEqual(3);

  for (const m of sites) {
    const fields = objectAround(s, m.index!);
    expect(fields, `metadata-skrivested uden sourceIdentity:\n${fields.slice(0, 220)}`)
      .toContain('sourceIdentity');
  }
});

/**
 * Klipper hele det objekt-literal ud som positionen ligger i — fra dets `{`
 * til den matchende `}`, med tællede tuborgparenteser.
 *
 * FØRSTE UDGAVE MÅLTE AFSTAND I TEGN (`slice(i, i + 400)`), og det holdt ikke.
 * 17/9 2026 blev en kommentar på fire lines indsat mellem `metadata` og
 * `sourceIdentity` i den chunk-delte upload — feltet stod der stadig, ti
 * lines nede, men uden for vinduet. Vagten blev rød på en fil der var
 * korrekt. En vagt der fejler på formatering lærer læseren at hæve tallet,
 * og næste gang hæver man det forbi en ægte fejl.
 */
function objectAround(s: string, pos: number): string {
  let start = pos;
  let depth = 0;
  while (start > 0) {
    const c = s[start];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) break; depth--; }
    start--;
  }
  let dyb = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') dyb++;
    else if (s[i] === '}') { dyb--; if (dyb === 0) return s.slice(start, i + 1); }
  }
  return s.slice(start);   // uafsluttet — lad påstanden fejle på indholdet
}

test('AC#6 identiteten har kaldesteder UDEN FOR sine egne prøver', () => {
  // En hjælpefunktion ingen kalder er ikke en integration.
  const s = source();
  expect(s).toContain("sourceIdentity('url'");
  expect((s.match(/sourceIdentity\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
});

test('NEGATIV KONTROL: vagten kan faktisk sige nej', () => {
  expect(source()).not.toContain('en-streng-der-med-sikkerhed-ikke-staar-i-filen');
});
