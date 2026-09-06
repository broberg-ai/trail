/**
 * F257.4 — referencer for ÉN kilde, ikke for hele videnbasen.
 *
 * MÅLT I PRODUKTION 6/9, fundet af ejeren selv:
 *   POST /local-compiled          → 500 efter 284 SEKUNDER
 *   GET  /documents?awaiting…     → 200 efter 224 sekunder
 *   GET  /api/health              → 200 efter 0,2 sekunder
 *
 * Motoren var rask; koden lavede bare 250 fulde Neuron-opslag pr. markering.
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const extractor = readFileSync(new URL('./reference-extractor.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../routes/documents.ts', import.meta.url), 'utf8');

test('MARKERINGS-RUTEN FEJER IKKE HELE BASEN LÆNGERE', () => {
  // Den bærende prøve. backfillReferencesForKb findes stadig og bruges ved boot
  // — men den må ikke kaldes fra en rute et menneske venter på.
  expect(route).toContain('backfillReferencesForSource');
  expect(route).not.toContain('backfillReferencesForKb');
});

test('den kilde-scopede fejer filtrerer på indhold, ikke på hele basen', () => {
  const f = extractor.slice(extractor.indexOf('export async function backfillReferencesForSource'));
  const krop = f.slice(0, f.indexOf('\n}')).replace(/\s+/g, ' ');
  expect(krop).toContain('content LIKE');
  expect(krop).toContain("kind = 'wiki'");
  expect(krop).toContain('archived = 0');
});

test('NEGATIV KONTROL: boot-fejningen over hele basen findes stadig', () => {
  // Uden denne kunne rettelsen have SLETTET den fulde fejning, og en frisk
  // database ville aldrig få sine referencer. Vi flytter den væk fra
  // anmodnings-stien; vi fjerner den ikke.
  expect(extractor).toContain('export async function backfillReferencesForKb');
});

test('et for kort filnavn giver nul uden en eneste forespørgsel', () => {
  // En LIKE på %a% ville ramme hver eneste Neuron og genskabe præcis den fejl
  // vi retter — bare via en anden dør.
  const f = extractor.slice(extractor.indexOf('export async function backfillReferencesForSource'));
  expect(f.slice(0, 900)).toContain('stamme.length < 3');
});

test('filendelsen strippes, så både med og uden .md rammer', () => {
  const f = extractor.slice(extractor.indexOf('export async function backfillReferencesForSource'));
  expect(f.slice(0, 900)).toMatch(/replace\(\/\\\.\[a-z0-9\]\+\$\/i, ''\)/);
});
