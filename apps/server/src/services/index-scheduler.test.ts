/**
 * F254.6 — fejeren må ikke vente på en kontakt der venter på fejeren.
 *
 * Målt 6/9 2026: `WHERE hybrid_search_enabled = 1` valgte NUL baser, fordi
 * flaget med vilje er 0 overalt indtil før/efter-målingen er kørt. En Neuron
 * skrevet gennem kandidat-godkendelsen lå stadig uden vektor 25 minutter
 * senere, hvor fejeren skulle have kørt to gange — og intet så forkert ud, for
 * en fejer der vælger nul baser hverken fejler eller logger.
 */
import { test, expect } from 'bun:test';
import { SWEEP_KB_SQL } from './index-scheduler.js';

const normaliseret = SWEEP_KB_SQL.replace(/\s+/g, ' ');

test('FEJEREN VÆLGER OGSÅ BASER DER BLOT ER INDEKSERET — det var hele blokeringen', () => {
  expect(normaliseret).toContain('EXISTS');
  expect(normaliseret).toContain('chunk_embeddings');
});

test('hybrid-flaget vælger stadig en base — en tændt base skal fejes uanset', () => {
  // Kontrollen: uden denne kunne rettelsen have BYTTET den ene betingelse ud
  // med den anden i stedet for at forene dem, og en base med hybrid tændt men
  // et tomt indeks ville aldrig komme i gang.
  expect(normaliseret).toContain('hybrid_search_enabled = 1');
});

test('de to betingelser er OR, ikke AND — et AND ville vælge endnu færre', () => {
  const i = normaliseret.indexOf('hybrid_search_enabled = 1');
  const j = normaliseret.indexOf('EXISTS');
  const imellem = normaliseret.slice(Math.min(i, j), Math.max(i, j));
  expect(imellem).toContain(' OR ');
  expect(imellem).not.toContain(' AND ');
});

test('udvælgelsen filtrerer på basen, ikke på tenant — fejeren kører for alle', () => {
  // En tenant-binding her ville gøre fejeren til noget der skal huskes pr.
  // kunde. Den skal spørge basen, ikke en liste nogen vedligeholder.
  expect(normaliseret).not.toContain('tenant_id = ?');
});
