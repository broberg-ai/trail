/**
 * F262 — CHATTEN SKAL FAKTISK BRUGE BETYDNINGS-SØGNINGEN.
 *
 * MÅLT 6/9: ordene «vector», «embed», «cosine» og «hybrid» fandtes IKKE i
 * chat.ts. Hele det semantiske indeks — 1.205 vektorer, 100 % dækning — var
 * usynligt for Aidan, mens søgesiden brugte det. To flader, to forskellige
 * svar på samme spørgsmål, og ingen af dem kunne bruges til at kontrollere den
 * anden.
 *
 * DET ER EN FRAVÆRS-FEJL, og den har ingen fejlmeddelelse. Chatten svarede
 * pænt hele tiden — bare kun på de spørgsmål der tilfældigvis brugte
 * Neuronernes egne ord. «Hvem er grundlæggeren» kunne slet ikke besvares,
 * fordi ingen Neuron indeholder ordet.
 *
 * Prøven læser kilden, fordi det er en fraværs-egenskab: en kørsel kan ikke
 * vise at noget ALDRIG kaldes. Den kræver KALD (`navn(`), ikke omtale — den
 * gamle fil havde ordet «embedded» i to kommentarer, og en tekstsøgning på
 * bare navnet ville have været grøn gennem hele fejlen.
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const kilde = readFileSync(join(import.meta.dir, 'chat.ts'), 'utf-8');

/** Kildens kode uden kommentarer — så omtale ikke tælles som brug. */
function udenKommentarer(): string {
  return kilde
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

test('chatten KALDER vektor-søgningen', () => {
  const kode = udenKommentarer();
  expect(kode).toContain('vectorSearch(');
  expect(kode).toContain('hybridEnabled(');
});

test('NEGATIV KONTROL: omtale i en kommentar tæller ikke som brug', () => {
  // Den gamle fil havde «embedded» i to kommentarer og brugte intet. En
  // prøve på bare ordet ville have været grøn gennem hele fejlen.
  const kode = udenKommentarer();
  expect(kode).not.toContain('the text-retrieved docs had embedded');
  // …og kommentaren FINDES stadig i den rå kilde, så prøven beviser at
  // filtreringen virker frem for at bestå på en tom streng.
  expect(kilde).toContain('the text-retrieved docs had embedded');
});

test('vektor-træf går gennem TRAGTEN, ikke uden om den', () => {
  const kode = udenKommentarer();
  const vec = kode.indexOf('vectorSearch(');
  const conf = kode.indexOf('loadNeuronConfidence(');
  const ranked = kode.indexOf('const rankedDocs');
  expect(vec).toBeGreaterThan(0);
  // Kandidaterne skal være på plads FØR tillids-opslaget og rangeringen,
  // ellers omgår de kind-filteret, faded-heuristics og isChatVisible — og
  // så kan en intern Neuron nå en offentlig chat.
  expect(vec).toBeLessThan(conf);
  expect(conf).toBeLessThan(ranked);
});

test('hybrid er betinget, ikke altid — en slukket videnbase koster ikke et kald', () => {
  const kode = udenKommentarer();
  const i = kode.indexOf('hybridEnabled(');
  const vindue = kode.slice(Math.max(0, i - 120), i + 200);
  expect(vindue).toMatch(/if\s*\(await hybridEnabled\(/);
});

/**
 * F262.3 — BEGGE RUTER SKAL BRUGE DEN SAMME RANGERING.
 *
 * Opførslen er prøvet i `packages/core/src/retrieval/rangering.test.ts`. Det
 * her er den anden halvdel: at ruterne faktisk KALDER den, frem for at have
 * hver sin kopi. En kopi er ikke forkert den dag den skrives — den er forkert
 * den dag den ene bliver rettet.
 */
const søgeruten = readFileSync(join(import.meta.dir, 'search.ts'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('chatten KALDER den fælles rangering', () => {
  expect(udenKommentarer()).toContain('rangerKandidater(');
});

test('søgeruten KALDER den fælles rangering', () => {
  expect(søgeruten).toContain('rangerKandidater(');
});

test('ingen af ruterne har sin EGEN fletning ved siden af', () => {
  // Kaldte en rute både rangerKandidater OG reciprocalRankFusion, ville den
  // have to rangeringer der kan blive uenige — og prøven ovenfor ville
  // stadig være grøn.
  expect(udenKommentarer()).not.toContain('reciprocalRankFusion(');
  expect(søgeruten).not.toContain('reciprocalRankFusion(');
});

test('chatten ordner sine citater — den fælles funktion, ikke en egen sort', () => {
  // Opførslen er prøvet i rangering.test.ts. Det her er kun ledningen: at
  // chatten ikke går uden om og sorterer citaterne på sin egen måde.
  const kode = udenKommentarer();
  expect(kode).toContain('ordnCitater(');
  expect(kode).not.toContain('citations.sort(');
});
