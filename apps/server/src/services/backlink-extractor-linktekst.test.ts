/**
 * F257.1 — en link-tekst der ER en sti eller et filnavn skal læses som det
 * navn den peger på, så [[Agentic CMS.md]] rammer Neuronen «Agentic CMS».
 *
 * DEN VIGTIGSTE PRØVE HER ER DEN NEGATIVE. `@broberg/ai-sdk` er et ægte
 * Neuron-navn (et pakkenavn), og en regel formuleret som «indeholder en
 * skråstreg» ville omdøbe det til `ai-sdk` og bryde et link der virker i dag.
 * Netop den fejl blev fanget i F256's egen prøve — derfor står den her igen,
 * på LÆSE-siden, hvor den ellers kunne genopstå uafhængigt.
 *
 * MUTATIONS-TJEK (kørt i hånden 6/9): løsnes `erSti` til
 * `titel.includes('/')`, går «pakkenavn med skråstreg røres ikke» RØD. Uden
 * den prøve ville løsningen bestå.
 */
import { test, expect } from 'bun:test';
import { linkTekstTilNavn } from './backlink-extractor.js';

test('absolut sti → sidste led uden .md', () => {
  expect(linkTekstTilNavn('/neurons/concepts/tags.md')).toBe('tags');
  expect(linkTekstTilNavn('/neurons/sessions/trail/f257.md')).toBe('f257');
});

test('bart filnavn → navnet uden endelsen', () => {
  expect(linkTekstTilNavn('Agentic CMS.md')).toBe('Agentic CMS');
  expect(linkTekstTilNavn('AI-native websites.md')).toBe('AI-native websites');
});

test('et almindeligt navn røres ikke', () => {
  expect(linkTekstTilNavn('Christian Broberg')).toBe('Christian Broberg');
  expect(linkTekstTilNavn('Trail')).toBe('Trail');
});

test('NEGATIV KONTROL: pakkenavn med skråstreg røres ikke', () => {
  // Bryder hvis erSti nogensinde løsnes til «indeholder /».
  expect(linkTekstTilNavn('@broberg/ai-sdk')).toBe('@broberg/ai-sdk');
  expect(linkTekstTilNavn('@broberg/webpush')).toBe('@broberg/webpush');
});

test('endelsen matches uanset store bogstaver', () => {
  expect(linkTekstTilNavn('Tags.MD')).toBe('Tags');
});

test('mellemrum omkring trimmes væk', () => {
  expect(linkTekstTilNavn('  /neurons/concepts/tags.md  ')).toBe('tags');
  expect(linkTekstTilNavn('  Christian Broberg  ')).toBe('Christian Broberg');
});

test('en sti der ender på skråstreg kollapser ikke til tomt', () => {
  // '/neurons/concepts/' må ikke give '' — et tomt navn ville matche alt
  // eller intet, og resolveLink ville ikke kunne se forskel.
  expect(linkTekstTilNavn('/neurons/concepts/')).toBe('concepts');
  expect(linkTekstTilNavn('/')).toBe('/');
});

test('SYMMETRI: skrivesiden og læsesiden er enige om hvad en sti er', () => {
  // Skrivesiden (F256) navngiver Neuronen efter sidste led; læsesiden slår
  // op på samme form. Er de uenige, peger linket på et navn der ikke findes.
  const sti = '/neurons/concepts/tags.md';
  expect(linkTekstTilNavn(sti)).toBe('tags');
  // og navnet er allerede-normaliseret-stabilt (idempotent)
  expect(linkTekstTilNavn(linkTekstTilNavn(sti))).toBe('tags');
});
