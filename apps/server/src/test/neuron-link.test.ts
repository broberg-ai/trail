/**
 * F263.13 — hvor peger «kilde klar» hen?
 *
 * Ejeren 8/9, med et skærmbillede af fire notifikationer på låseskærmen:
 * «de linker ikke til noget relevant. Skal linke til en neuron.»
 *
 * DE TILFÆLDE HVOR VALGET KAN GÅ GALT STÅR FØRST. En prøve der kun viser at
 * én Neuron giver et link til den Neuron, ville bestå på `kandidater[0]` —
 * altså på et vilkårligt valg der rammer rigtigt når der kun er ét at vælge.
 */
import { test, expect } from 'bun:test';
import { vaelgNeuronRute } from '../lib/neuron-link.js';

const KB = 'kb-1';
const referat = { filename: 'min-kilde.md', path: '/neurons/sources/', title: 'Min kilde' };
const begreb = { filename: 'et-begreb.md', path: '/neurons/concepts/', title: 'Et begreb' };
const entitet = { filename: 'en-ting.md', path: '/neurons/entities/', title: 'En ting' };

test('FLERE Neuroner: kilde-referatet vinder — også når det står SIDST', () => {
  // Rækkefølgen er databasens, ikke vores. Står referatet sidst og vi tog den
  // første, ville brugeren lande på en begrebsside uden at kunne se hvad den
  // havde med hans upload at gøre.
  const r = vaelgNeuronRute([begreb, entitet, referat], KB);
  expect(r.navigate).toBe(`/kb/${KB}/neurons/min-kilde`);
  expect(r.titel).toBe('Min kilde');
});

test('INGEN Neuroner: falder tilbage til kildelisten, ikke til en tom side', () => {
  const r = vaelgNeuronRute([], KB);
  expect(r.navigate).toBe(`/kb/${KB}/sources`);
  expect(r.titel).toBeNull();
});

test('INTET kilde-referat: den første Neuron er bedre end kildelisten', () => {
  const r = vaelgNeuronRute([begreb, entitet], KB);
  expect(r.navigate).toBe(`/kb/${KB}/neurons/et-begreb`);
});

test('adressen er FILNAVNET, ikke titlen — det er dét læseren matcher på', () => {
  // Titlen bærer store bogstaver, mellemrum og tankestreger; filnavnet er
  // slug'en. Bruger vi titlen, rammer vi ved siden af hver gang de er uens.
  const r = vaelgNeuronRute(
    [{ filename: 'fra-artikel-til-podcast.md', path: '/neurons/sources/', title: 'Fra artikel til podcast — broberg.ai' }],
    KB,
  );
  expect(r.navigate).toBe(`/kb/${KB}/neurons/fra-artikel-til-podcast`);
});

test('æøå og mellemrum i filnavnet kodes, så adressen ikke knækker', () => {
  const r = vaelgNeuronRute(
    [{ filename: 'sådan vælger du.md', path: '/neurons/sources/', title: null }],
    KB,
  );
  expect(r.navigate).toBe(`/kb/${KB}/neurons/${encodeURIComponent('sådan vælger du')}`);
  // Uden titel bruges slug'en som tekst — aldrig et tomt navn i notifikationen.
  expect(r.titel).toBe('sådan vælger du');
});
