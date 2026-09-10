/**
 * F266.1 — en ambient-optagelse må aldrig kunne svare en besøgende.
 *
 * DEN BÆRENDE PRØVE ER PUBLIKUMS-FILTERET, ikke at tagget står i en streng.
 * Et mærke der ikke skjuler noget er pynt, og det ville se lige så grønt ud.
 */
import { test, expect } from 'bun:test';
import { AMBIENT_CONNECTOR } from '@trail/shared';
import { isVisibleToAudience } from './audience.js';
import { maerkAmbientInternt } from '@trail/core';

/** Samme form som stampConnector producerer. */
function tagsFor(metadata: string | null): string | null {
  if (!metadata) return null;
  const m = JSON.parse(metadata) as { tags?: string };
  return m.tags ?? null;
}

test('F266.1 DEN BÆRENDE: en ambient-Neuron er USYNLIG for en besøgende, synlig for dig', () => {
  const tags = 'internal';
  // '/neurons/auto/' er hvor en auto-godkendt kandidat lander.
  expect(isVisibleToAudience('tool', '/neurons/auto/', tags)).toBe(false);
  expect(isVisibleToAudience('curator', '/neurons/auto/', tags)).toBe(true);
});

test('F266.1 NEGATIV KONTROL: en IKKE-ambient Neuron er uændret synlig', () => {
  // Uden den ville «mærk alt som internal» bestå prøven ovenfor — og skjule
  // det halve af hjernen for kunderne. En rettelse der flytter fejlen.
  expect(isVisibleToAudience('tool', '/neurons/auto/', null)).toBe(true);
  expect(isVisibleToAudience('tool', '/neurons/concepts/', 'zoneterapi')).toBe(true);
});

test('F266.1 mærket sættes SERVER-SIDE, uanset hvad klienten sender', () => {
  // Ambient-klienten er en separat Swift-app. Beder man DEN om at huske
  // mærket, er én glemt opdatering nok til at lække.
  const kilde = readFileSync(new URL('../../../../packages/core/src/queue/candidates.ts', import.meta.url), 'utf8');
  expect(kilde).toContain('function maerkAmbientInternt(');
  expect(kilde).toContain('if (parsed.connector !== AMBIENT_CONNECTOR) return fallback;');
  // Kaldt fra BEGGE grene i stampConnector — den med en connector fra
  // kalderen, og den hvor den udledes. Én gren ville betyde at en ambient
  // kandidat der selv sætter sin connector slipper umærket igennem.
  expect(kilde.split('maerkAmbientInternt(').length - 1).toBe(3); // def + 2 kald
});

test('F266.1 DEN RIGTIGE BÆRENDE: mærket bliver FAKTISK sat på en ambient-kandidat', () => {
  // FØRSTE UDGAVE AF DENNE FIL KUNNE IKKE SE FEJLEN. Den hardkodede
  // tags='internal' og prøvede kun publikums-filteret — altså at et mærke
  // VIRKER, ikke at det bliver SAT. Mutationen «sæt aldrig mærket» forblev
  // grøn på 4 af 4. Nu køres den rigtige funktion.
  const ud = maerkAmbientInternt({ connector: AMBIENT_CONNECTOR }, '{}');
  expect(JSON.parse(ud!).tags).toBe('internal');

  // Og et eksisterende tag bevares ved siden af, ikke overskrives.
  const medTags = maerkAmbientInternt({ connector: AMBIENT_CONNECTOR, tags: 'møde' }, '{}');
  expect(JSON.parse(medTags!).tags).toBe('møde,internal');
});

test('F266.1 NEGATIV: en ikke-ambient kandidat røres slet ikke', () => {
  const fallback = '{"connector":"buddy"}';
  expect(maerkAmbientInternt({ connector: 'buddy' }, fallback)).toBe(fallback);
});

test('F266.1 allerede mærket → uændret, ingen dublet', () => {
  const fallback = '{"connector":"trail-ambient-capture","tags":"internal"}';
  expect(maerkAmbientInternt({ connector: AMBIENT_CONNECTOR, tags: 'internal' }, fallback)).toBe(fallback);
});

import { readFileSync } from 'node:fs';
