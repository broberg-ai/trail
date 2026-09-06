/**
 * F256.1 — en sti må aldrig blive til et Neuron-navn.
 *
 * Prøven er bygget om DEN MÅLTE hændelse, ikke om min gengivelse af den:
 * titlen og indholdet nedenfor er ordret dem fra doc_3f3c9486-f07 i
 * broberg.ai-basen, den Neuron 63 brudte links pegede på.
 */
import { test, expect } from 'bun:test';
import { neuronTitel, erSti, frontmatterTitel } from './neuron-name.js';
import { slugify } from '@trail/shared';

const ÆGTE_TITEL = '/neurons/entities/christian-broberg.md';
const ÆGTE_INDHOLD = `---
title: Christian Broberg
type: entity
tags: [grundlægger, leder, iværksætter]
date: 2026-09-04
sources: [flagskibe.md]
---

# Christian Broberg {#claim-008a376f}

**Christian Broberg** er grundlægger, leder og strategisk ekspert bag [[broberg.ai]].
`;

test('DEN ÆGTE HÆNDELSE: stien bliver til «Christian Broberg», ikke til hele stien', () => {
  expect(neuronTitel(ÆGTE_TITEL, ÆGTE_INDHOLD)).toBe('Christian Broberg');
});

test('og DERMED bliver filnavnet det links slår op på', () => {
  // Det er dette skridt der var brudt. Link-opløseren slugificerer link-teksten
  // og sammenligner med filnavnets slug — så [[Christian Broberg]] leder efter
  // «christian-broberg» og fandt før «neurons-entities-christian-broberg-md».
  expect(slugify(neuronTitel(ÆGTE_TITEL, ÆGTE_INDHOLD))).toBe('christian-broberg');
  expect(slugify(ÆGTE_TITEL)).toBe('neurons-entities-christian-broberg-md'); // fejlen, dokumenteret
});

test('EN ALMINDELIG TITEL ER UÆNDRET — kontrollen', () => {
  // Uden denne ville «returnér altid frontmatterens titel» bestå lige så grønt,
  // og så ville hver eneste Neuron få sit navn fra frontmatter i stedet for fra
  // det kompileringen bad om.
  expect(neuronTitel('Christian Broberg', ÆGTE_INDHOLD)).toBe('Christian Broberg');
  expect(neuronTitel('Målingen finder fejlen', '# noget helt andet')).toBe('Målingen finder fejlen');
});

test('uden frontmatter-titel bruges stiens SIDSTE led, aldrig hele stien', () => {
  expect(neuronTitel('/neurons/concepts/flagskib.md', 'ingen frontmatter her')).toBe('flagskib');
  expect(neuronTitel('/neurons/entities/broberg-ai.md', '')).toBe('broberg-ai');
});

test('en frontmatter-titel der SELV er en sti bruges ikke — så var vi lige vidt', () => {
  const ondt = '---\ntitle: /neurons/entities/x.md\n---\n# x';
  expect(neuronTitel('/neurons/entities/x.md', ondt)).toBe('x');
});

test('citeret frontmatter-titel afciteres', () => {
  const c = '---\ntitle: "Udgivelse som arkivering"\n---\n# U';
  expect(frontmatterTitel(c)).toBe('Udgivelse som arkivering');
});

test('erSti fanger både absolut og relativ sti', () => {
  expect(erSti('/neurons/entities/x.md')).toBe(true);
  expect(erSti('entities/x.md')).toBe(true); // .md-endelsen fanger den
  expect(erSti('Christian Broberg')).toBe(false);
  expect(erSti('cms — broberg.ai')).toBe(false);
});

test('en titel der er en sti med tomt sidste led falder tilbage på titlen selv', () => {
  // Kan ikke ske i praksis, men et tomt filnavn ville give «.md» og en Neuron
  // uden navn — værre end den fejl vi retter.
  expect(neuronTitel('/neurons/entities/', '')).toBe('entities');
});

test('DEN ANDEN VARIANT: et bart filnavn er lige så skadeligt som en sti', () => {
  // Målt: 14 af de 26 fejlfødte havde INGEN skråstreg. Havde jeg kun rettet
  // sti-varianten, var over halvdelen blevet stående og set rettet ud.
  const indhold = '---\ntitle: Flåden der bygger\n---\n# Flåden der bygger';
  expect(erSti('flåden-der-bygger.md')).toBe(true);
  expect(neuronTitel('flåden-der-bygger.md', indhold)).toBe('Flåden der bygger');
  expect(neuronTitel('flåden-der-bygger.md', 'ingen frontmatter')).toBe('flåden-der-bygger');
});

test('en titel der bare INDEHOLDER et punktum er ikke en fil — kontrollen', () => {
  // «cms — broberg.ai» ender på .ai, som er en del af navnet. Var reglen
  // «indeholder et punktum», ville hver eneste domæne-titel blive omdøbt.
  expect(erSti('cms — broberg.ai')).toBe(false);
  // @broberg/ai-sdk ER et rigtigt Neuron-navn. En regel på «indeholder /»
  // ville omdøbe det til «ai-sdk» og bryde en Neuron der virker i dag.
  expect(erSti('@broberg/ai-sdk')).toBe(false);
  expect(neuronTitel('@broberg/ai-sdk', '')).toBe('@broberg/ai-sdk');
  expect(neuronTitel('cms — broberg.ai', '')).toBe('cms — broberg.ai');
});

/**
 * SPÆRREN MOD AT RETTE DET FORKERTE STED IGEN.
 *
 * Målt 6/9: jeg rettede candidates.ts (materialiseringen), deployede, og
 * opførslen i produktion var UÆNDRET — fordi wiki-write danner filnavnet i
 * candidate-api.ts, LÆNGE før. En rettelse på det forkerte af tre skrivesteder
 * ser præcis ud som en rettelse der ikke er udrullet.
 *
 * Prøven læser de ægte filer. Kommer der et fjerde skrivested, bliver den rød.
 */
import { readFileSync } from 'node:fs';

const SKRIVESTEDER = [
  '../ingest/candidate-api.ts',   // wiki-write · ingest · buddys MCP  ← DEN vigtige
  './candidates.ts',              // materialisering ved godkendelse
  '../../../../apps/mcp/src/index.ts', // det selvstændige stdio-MCP
];

test('INGEN RÅ TITEL når slugify — det var fejlen på tre skrivesteder', () => {
  // Egenskaben, ikke formen: en mellemvariabel er fint (`slugify(visningsTitel)`),
  // en rå titel er ikke (`slugify(args.title)`). Det er PRÆCIS det mønster der
  // stod på alle tre steder, og som gjorde at min første rettelse ikke virkede.
  const RÅ = /slugify\(\s*(args\.title|candidate\.title|title)\s*[,)]/;
  for (const sti of SKRIVESTEDER) {
    const kode = readFileSync(new URL(sti, import.meta.url), 'utf8');
    const kodelinjer = kode.split('\n').filter(
      (l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'),
    );
    // filen danner faktisk et Neuron-navn …
    expect(`${sti} kalder slugify`).toBe(
      kodelinjer.some((l) => l.includes('slugify(')) ? `${sti} kalder slugify` : `${sti} KALDER IKKE slugify`,
    );
    // … og gør det aldrig på en rå titel
    for (const l of kodelinjer) {
      if (RÅ.test(l)) throw new Error(`RÅ TITEL i ${sti}: ${l.trim()}`);
    }
    expect(kode).toContain('neuronTitel');
  }
});
