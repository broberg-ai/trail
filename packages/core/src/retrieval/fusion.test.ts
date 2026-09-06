/**
 * F254.2 — fusionen skal foretrække ENIGHED frem for én metodes overbevisning.
 * Det er hele grunden til at køre to metoder frem for den bedste ene.
 */
import { test, expect } from 'bun:test';
import { reciprocalRankFusion } from './fusion.js';

test('enighed slår en enkelt metodes førsteplads', () => {
  // «enig» ligger nr. 3 i BEGGE. «solo» ligger nr. 1 i den ene og mangler i den anden.
  const r = reciprocalRankFusion({
    ord:    [{ id: 'solo' }, { id: 'x' }, { id: 'enig' }],
    vektor: [{ id: 'y' },    { id: 'z' }, { id: 'enig' }],
  });
  expect(r[0]!.id).toBe('enig');
  expect(r[0]!.ranks).toEqual({ ord: 3, vektor: 3 });
});

test('en metode alene fungerer stadig — rækkefølgen bevares', () => {
  // Uden denne kontrol kunne fusionen kræve to lister for at give mening, og
  // så ville et nedbrud i vektor-halvdelen ikke bare degradere, men ødelægge.
  const r = reciprocalRankFusion({ ord: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
  expect(r.map((x) => x.id)).toEqual(['a', 'b', 'c']);
});

test('en liste kan ikke rykke sig selv op ved at nævne samme id to gange', () => {
  const r = reciprocalRankFusion({
    ord:    [{ id: 'snyd' }, { id: 'snyd' }, { id: 'snyd' }, { id: 'ægte' }],
    vektor: [{ id: 'ægte' }],
  });
  expect(r[0]!.id).toBe('ægte');
  expect(r.find((x) => x.id === 'snyd')!.ranks).toEqual({ ord: 1 });
});

test('rækkefølgen er deterministisk ved uafgjort — ellers kan en måling ikke læses', () => {
  const kør = () => reciprocalRankFusion({ a: [{ id: 'q' }], b: [{ id: 'p' }] }).map((x) => x.id);
  expect(kør()).toEqual(kør());
  expect(kør()).toEqual(['p', 'q']); // samme score, id afgør
});

test('METODENS EGEN SCORE indgår IKKE — bm25 og cosinus er ikke sammenlignelige', () => {
  // bm25 er negativ og ubegrænset; cosinus ligger i [-1,1]. Lagde fusionen dem
  // sammen, ville ét stort negativt tal kunne dominere alt. Her har den
  // dårligst scorende plads 1 og skal stadig vinde over plads 2.
  const r = reciprocalRankFusion({
    ord:    [{ id: 'først', score: -9999 }, { id: 'anden', score: -0.001 }],
    vektor: [{ id: 'først', score: 0.02 },  { id: 'anden', score: 0.99 }],
  });
  expect(r[0]!.id).toBe('først');
});
