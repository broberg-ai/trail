/**
 * F254.1 — kodning, lighed og dækning.
 *
 * Den vigtigste prøve her er den om NULL: cosinus må ikke svare 0 når den ikke
 * kan beregne. 0 er en GYLDIG lighed (vinkelret), og bruges den også som «ved
 * ikke», kan en sortering ikke skelne et manglende svar fra et dårligt.
 */
import { test, expect } from 'bun:test';
import { encodeVector, decodeVector, cosine, contentHash, EMBEDDING_MODEL, EMBEDDING_PROVIDER } from './vectors.js';

test('en vektor round-tripper gennem BLOB uden at skride', () => {
  const v = [0.1, -0.5, 0.9999, 0, -1];
  const ud = decodeVector(encodeVector(v));
  expect(ud.length).toBe(5);
  for (let i = 0; i < v.length; i += 1) expect(ud[i]).toBeCloseTo(v[i]!, 6);
});

test('1024 dimensioner fylder præcis 4096 byte — ikke JSON', () => {
  expect(encodeVector(new Array(1024).fill(0.5)).byteLength).toBe(4096);
});

test('identiske vektorer har lighed 1, modsatte -1', () => {
  const a = new Float32Array([1, 0, 0]);
  expect(cosine(a, new Float32Array([1, 0, 0]))).toBeCloseTo(1, 6);
  expect(cosine(a, new Float32Array([-1, 0, 0]))).toBeCloseTo(-1, 6);
});

test('vinkelrette vektorer har lighed 0 — og det er et RIGTIGT svar', () => {
  expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
});

test('KAN IKKE BEREGNES giver null, ikke 0 — ellers ligner et manglende svar et dårligt', () => {
  expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toBeNull(); // forskellig længde
  expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 0]))).toBeNull();    // nul-vektor har ingen retning
  expect(cosine(new Float32Array([]), new Float32Array([]))).toBeNull();            // tom
});

test('indholdets fingeraftryk ændrer sig med ét tegn — så en forældet vektor kan ses', () => {
  expect(contentHash('nada-protokollen varer 45 minutter'))
    .not.toBe(contentHash('nada-protokollen varer 40 minutter'));
  expect(contentHash('samme')).toBe(contentHash('samme'));
});

test('EU-RUTEN ER LÅST I EN KONSTANT, ikke i en indstilling', () => {
  // Sannes Neuroner er helbredsoplysninger. @broberg/ai-sdk's embedding-tier
  // peger på OpenAI i USA; denne konstant er det ENE sted overriden står.
  expect(EMBEDDING_PROVIDER).toBe('mistral');
  expect(EMBEDDING_MODEL).toBe('mistral-embed');
});
