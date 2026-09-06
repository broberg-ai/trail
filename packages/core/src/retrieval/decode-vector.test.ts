/**
 * F260 — en vektor der afkoder til lutter nuller er en TAVS ingenting.
 *
 * MÅLT 6/9 2026 på produktion: alle 1.205 gemte vektorer i broberg.ai afkodede
 * til nuller, mens de rå bytes i basen var korrekte. Hele den semantiske
 * søgning var død, og INTET fejlede: rækkerne fandtes, dækningen sagde 100 %,
 * og cosine svarede `null` — hvilket kaldestedet ikke kunne skelne fra
 * «ingen lighed».
 *
 * Årsagen: libsql leverer et BLOB som ArrayBuffer, og `copy.set(arrayBuffer)`
 * læser nul elementer og kaster ikke.
 *
 * DERFOR PRØVER DENNE FIL BEGGE FORMER. En prøve der kun bruger Uint8Array
 * beviser præcis den halvdel der aldrig var i stykker — det var den prøve der
 * fandtes, og den var grøn hele tiden.
 */
import { test, expect } from 'bun:test';
import { encodeVector, decodeVector, cosine } from './vectors.js';

const V = [-0.0296, 0.0317, 0.009, 0.034, -1, 1, 0.5];

function nærved(a: Float32Array, b: readonly number[]) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < b.length; i += 1) expect(a[i]!).toBeCloseTo(b[i]!, 5);
}

test('Uint8Array afkoder korrekt (vejen der ALDRIG var i stykker)', () => {
  nærved(decodeVector(encodeVector(V)), V);
});

test('ArrayBuffer afkoder korrekt — det er formen driveren giver', () => {
  const u = encodeVector(V);
  const ab = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  expect(ab).toBeInstanceOf(ArrayBuffer);
  nærved(decodeVector(ab), V);
});

test('NEGATIV KONTROL: en afkodet vektor må ikke være lutter nuller', () => {
  // Den ægte fejl havde RIGTIG længde, RIGTIG type og forkert indhold. En
  // prøve der kun tjekker længden ville have været grøn gennem hele fejlen.
  const u = encodeVector(V);
  const ab = u.buffer.slice(0) as ArrayBuffer;
  const d = decodeVector(ab);
  const sum = [...d].reduce((s, x) => s + Math.abs(x), 0);
  expect(d.length).toBe(V.length); // det svage tjek…
  expect(sum).toBeGreaterThan(0); // …og det der faktisk fanger fejlen
});

test('cosine mod sig selv giver 1 gennem ArrayBuffer-vejen', () => {
  // Symptomet i drift var at cosine gav null for ALLE 1.205 vektorer.
  const u = encodeVector(V);
  const ab = u.buffer.slice(0) as ArrayBuffer;
  const a = decodeVector(ab);
  const b = decodeVector(ab);
  const s = cosine(a, b);
  expect(s).not.toBeNull();
  expect(s!).toBeCloseTo(1, 5);
});

test('en ÆGTE nul-vektor giver stadig null — fejlen må ikke skjules', () => {
  // Rettelsen må ikke gøre «kunne ikke beregnes» til et tal.
  const nul = decodeVector(encodeVector([0, 0, 0, 0]));
  expect(cosine(nul, decodeVector(encodeVector([1, 2, 3, 4])))).toBeNull();
});
