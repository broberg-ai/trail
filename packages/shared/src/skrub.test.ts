/**
 * F274.1 — filnavnet er også en lækage-flade, og skrub-reglen må kun findes ét sted.
 *
 * Nøglen i prøvedata BYGGES AF DELE. Skrives den som én konstant, ligner repoet
 * selv en lækage, og husets egen secret-scan-hook blokerer commit'en — en prøve
 * der ikke kan committes er ingen prøve.
 */
import { test, expect } from 'bun:test';
import { skrubStreng } from './skrub.js';
import { slugify } from './slug.js';

/** Ikke en ægte nøgle: sat sammen så ingen nøgleformet konstant står i repoet. */
const NØGLE = ['sk', 'ant', 'api03'].join('-') + '-' + 'A'.repeat(32);
const CPR = '010101-0000';

test('DEN BÆRENDE: et CPR i en titel overlever ikke som slug', () => {
  const raa = `F274.1 read-back ${CPR}`;
  // Positiv kontrol: uden den ville en ødelagt slugify bestå lige så grønt.
  expect(slugify(raa)).toContain(CPR);
  expect(slugify(skrubStreng(raa).ren)).not.toContain('010101');
  expect(slugify(skrubStreng(raa).ren)).not.toContain('0000');
});

test('AC#2 — en API-NØGLE i en titel overlever heller ikke som slug', () => {
  // Filnavnet går gennem BEGGE skrubbere, ikke kun CPR-maskéren. Kørte det kun
  // maskerCpr, ville denne være rød.
  const raa = `Deploy-note ${NØGLE}`;
  expect(slugify(raa)).toContain('a'.repeat(32));          // sådan ville lækagen se ud
  const ren = skrubStreng(raa).ren;
  expect(ren).not.toContain(NØGLE);
  expect(slugify(ren)).not.toContain('a'.repeat(32));
  expect(skrubStreng(raa).findings.length).toBeGreaterThan(0);
});

test('begge slags i SAMME streng fjernes uafhængigt af hinanden', () => {
  // Rækkefølgen betyder noget: nøglemaskeringen indsætter sin egen markør,
  // og et CPR i samme tekst må ikke slippe fordi den løb først.
  const r = skrubStreng(`Klient ${CPR} · nøgle ${NØGLE}`);
  expect(r.ren).not.toContain(CPR);
  expect(r.ren).not.toContain(NØGLE);
  expect(r.cprAntal).toBe(1);
  expect(r.findings.length).toBeGreaterThan(0);
});

test('NEGATIV KONTROL: ren tekst røres ikke, og tæller nul', () => {
  // Uden den ville «maskér alt» bestå lige så grønt.
  const r = skrubStreng('Ordrenummer 991399-1234 og version 1.2.3');
  expect(r.ren).toBe('Ordrenummer 991399-1234 og version 1.2.3');
  expect(r.cprAntal).toBe(0);
  expect(r.findings.length).toBe(0);
});
