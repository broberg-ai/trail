// F263.10 AC#3 — SIKKERHEDS-KONTROLLEN, og den er skrevet så den kan blive rød.
//
// Adressen i en push-nyttelast kommer udefra. Følger routeren den blindt, kan
// en notifikation sende ejeren til et fremmed domæne. Prøven her fejler hvis
// filteret fjernes — det er hele kravet på kortet.
//
// De AFVISTE står FØRST med vilje: en prøve der kun viser at gyldige stier
// slipper igennem, består lige så pænt uden noget filter overhovedet.
import { describe, test, expect } from 'bun:test';
import { erAppSti } from './notification-route';

describe('erAppSti — afviser alt udefra', () => {
  const afvist = [
    'https://andet-sted.dk/',
    'http://andet-sted.dk/kb/1',
    '//andet-sted.dk/kb/1', // starter med «/» og er ALLIGEVEL et fremmed domæne
    '/\\andet-sted.dk', // samme trick, som nogle browsere læser som «//»
    'javascript:alert(1)',
    'data:text/html,<script>',
    'kb/1/sources', // relativ — routeren ville lægge den oven i den nuværende sti
    '',
    undefined,
    null,
    42,
    { navigate: '/kb/1' },
  ];
  for (const v of afvist) {
    test(`afviser ${JSON.stringify(v)}`, () => {
      expect(erAppSti(v)).toBe(false);
    });
  }
});

describe('erAppSti — de rigtige slipper igennem', () => {
  for (const v of ['/', '/settings', '/kb/abc/sources', '/kb/abc/queue']) {
    test(`accepterer ${v}`, () => {
      expect(erAppSti(v)).toBe(true);
    });
  }
});
