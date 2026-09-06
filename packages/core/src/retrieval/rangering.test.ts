/**
 * F262.3 — prøver for den ENE rangering begge ruter deler.
 *
 * Prøverne er skrevet mod OPFØRSEL, ikke mod kildeteksten. En prøve der læser
 * `chat.ts` og kræver at ordet `rangerKandidater` står der, beviser at kaldet
 * findes — ikke at rækkefølgen bliver rigtig. Det er den slags grøn dagen har
 * været fuld af.
 */
import { test, expect } from 'bun:test';
import { rangerKandidater } from './rangering.js';

const d = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (r: { id: string }[]) => r.map((x) => x.id);

test('præcist navn ligger først — også når fletningen er uenig', () => {
  // «cardmem» rangerer nr. 5 på ord og findes slet ikke på vektor, mens fire
  // andre er enige om at ligge højt. Uden trin 1 ville den ligge sidst.
  const r = rangerKandidater(d('a', 'b', 'c', 'd', 'cardmem'), {
    præcise: new Set(['cardmem']),
    ord: d('a', 'b', 'c', 'd', 'cardmem'),
    vektor: d('a', 'b', 'c', 'd'),
  });
  expect(ids(r)[0]).toBe('cardmem');
});

test('MUTATIONSMÅL: fjernes trin 1, falder det præcise navn ned', () => {
  // NEGATIV KONTROL for prøven ovenfor. Uden den beviser «cardmem er nr. 1»
  // ikke at det er trin 1 der gør det — det kunne være tilfældig orden.
  const udenPræcise = rangerKandidater(d('a', 'b', 'c', 'd', 'cardmem'), {
    præcise: new Set<string>(),
    ord: d('a', 'b', 'c', 'd', 'cardmem'),
    vektor: d('a', 'b', 'c', 'd'),
  });
  expect(ids(udenPræcise)[0]).not.toBe('cardmem');
});

test('en Neuron KUN betydnings-søgningen fandt, kan nå toppen', () => {
  // Ordmatchningen fandt tre ting; vektor-halvdelen fandt «kun-vektor» som sin
  // nr. 1. Den gamle chat-sortering (tillid faldende) kunne lægge den sidst,
  // fordi vektor-rangeringen slet ikke indgik.
  const r = rangerKandidater(d('ord1', 'ord2', 'ord3', 'kun-vektor'), {
    præcise: new Set<string>(),
    ord: d('ord1', 'ord2', 'ord3'),
    vektor: d('kun-vektor', 'ord3'),
  });
  expect(ids(r).slice(0, 3)).toContain('kun-vektor');
});

test('enighed slår en enkelt halvdels overbevisning', () => {
  // Kernen i RRF: nr. 2 i BEGGE lister slår nr. 1 i én og fraværende i den anden.
  const r = rangerKandidater(d('enig', 'kun-ord', 'kun-vektor'), {
    præcise: new Set<string>(),
    ord: d('kun-ord', 'enig'),
    vektor: d('kun-vektor', 'enig'),
  });
  expect(ids(r)[0]).toBe('enig');
});

test('reserven bruges KUN når ingen af halvdelene rangerede kandidaten', () => {
  // «lav» har høj reserve-værdi men er rangeret af ordmatchningen; «høj» er
  // ikke rangeret af nogen. Rangeringen skal vinde over reserven.
  const vægt: Record<string, number> = { lav: 0, høj: 100 };
  const r = rangerKandidater(d('lav', 'høj'), {
    præcise: new Set<string>(),
    ord: d('lav'),
    vektor: [],
    reserve: (a, b) => (vægt[b.id] ?? 0) - (vægt[a.id] ?? 0),
  });
  expect(ids(r)).toEqual(['lav', 'høj']);
});

test('to kandidater ingen af halvdelene rangerede, afgøres af reserven', () => {
  const vægt: Record<string, number> = { p: 0.2, q: 0.9 };
  const r = rangerKandidater(d('p', 'q'), {
    præcise: new Set<string>(),
    ord: [],
    vektor: [],
    reserve: (a, b) => (vægt[b.id] ?? 0) - (vægt[a.id] ?? 0),
  });
  expect(ids(r)).toEqual(['q', 'p']);
});

test('vektor-halvdelen slukket → ren ord-rangering, uændret', () => {
  // Regressionsværn: hybrid er slukket pr. videnbase, og den vej har virket
  // hele tiden. Den må ikke ændre sig fordi fletningen blev indført.
  const r = rangerKandidater(d('c', 'a', 'b'), {
    præcise: new Set<string>(),
    ord: d('a', 'b', 'c'),
    vektor: [],
  });
  expect(ids(r)).toEqual(['a', 'b', 'c']);
});

test('input muteres ikke', () => {
  const ind = d('x', 'y', 'z');
  rangerKandidater(ind, { præcise: new Set(['z']), ord: d('x', 'y', 'z'), vektor: [] });
  expect(ids(ind)).toEqual(['x', 'y', 'z']);
});
