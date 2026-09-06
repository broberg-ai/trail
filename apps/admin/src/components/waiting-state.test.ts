/**
 * F257.4 — prøver for vente-tilstanden.
 *
 * DEN BÆRENDE PÅSTAND er en FRAVÆRS-påstand: der må ikke renderes NOGET de
 * første 300 ms. Den er værd at prøve netop fordi den ikke kan ses — en
 * komponent der renderer et usynligt felt ser identisk ud på et skærmbillede
 * og fylder stadig i layoutet.
 *
 * Første render køres derfor gennem den ÆGTE komponent med
 * preact-render-to-string. Effekter kører ikke i en server-render, hvilket er
 * præcis den tilstand vi vil måle: øjeblikket før fristen er udløbet.
 *
 * At den DUKKER OP efter fristen prøves i en rigtig browser med Lens — ikke
 * simuleret her. En simuleret timer beviser noget om simuleringen.
 */
import { test, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { h } from 'preact';
import { render } from 'preact-render-to-string';
import { WaitingState, VENTE_FRIST_MS, type WaitingStateProps } from './waiting-state';

const HER = new URL('.', import.meta.url).pathname;
const PANELER = join(HER, '..', 'panels');

test('INTET renderes før fristen — begge varianter', () => {
  expect(render(h(WaitingState, {} as WaitingStateProps))).toBe('');
  expect(render(h(WaitingState, { variant: 'list' }))).toBe('');
  expect(render(h(WaitingState, { variant: 'value', label: 'Henter' }))).toBe('');
});

test('fristen er ÉN navngiven konstant, ikke et tal i to kopier', () => {
  expect(VENTE_FRIST_MS).toBe(300);
  const kilde = readFileSync(join(HER, 'waiting-state.tsx'), 'utf-8');
  // Komponenten skal LÆSE konstanten. Skriver nogen 300 direkte i kaldet,
  // findes tallet to steder, og de kan drive fra hinanden.
  expect(kilde).toContain('brugFrist(VENTE_FRIST_MS)');
  expect(kilde).not.toContain('brugFrist(300)');
});

test('MUTATIONSMÅL: en komponent uden frist ville bestå den forkerte vej', () => {
  // NEGATIV KONTROL. Uden den beviser «render === tom streng» ikke at det er
  // fristen der gør det — en komponent der altid returnerer null ville også
  // bestå. Her renderes et element UDEN frist, og det SKAL give indhold.
  const udenFrist = () => h('div', { 'data-testid': 'waiting-state' }, 'x');
  expect(render(h(udenFrist, {}))).not.toBe('');
});

test('den store neuron-animation er væk fra vente-vejen', () => {
  const kilde = readFileSync(join(HER, 'centered-loader.tsx'), 'utf-8');
  expect(kilde).not.toContain('NeuronLoader');
  expect(kilde).toContain('WaitingState');
});

/**
 * Panelerne der viser en LISTE. Ændres listen, er det en bevidst beslutning om
 * hvad der er en liste — ikke noget der driver stille.
 */
const LISTE_PANELER = [
  'sources', 'wiki-tree', 'wiki-reader', 'queue', 'jobs', 'activity', 'work',
  'link-report', 'glossary', 'images', 'brain-versions', 'tenants', 'kbs',
];

test('hvert liste-panel beder om skelet-varianten', () => {
  const mangler: string[] = [];
  for (const navn of LISTE_PANELER) {
    const kilde = readFileSync(join(PANELER, `${navn}.tsx`), 'utf-8');
    if (!/<CenteredLoader[^>]*variant="list"/.test(kilde)) mangler.push(navn);
  }
  // Navngiver dem, frem for at sige «noget manglede».
  expect(mangler).toEqual([]);
});

test('POSITIV KONTROL: listen peger på filer der faktisk findes', () => {
  // Uden den ville en tastefejl i LISTE_PANELER kaste — eller værre, hvis
  // prøven ovenfor havde en try/catch, bestå på nul filer.
  const findes = new Set(readdirSync(PANELER));
  for (const navn of LISTE_PANELER) expect(findes.has(`${navn}.tsx`)).toBe(true);
});
