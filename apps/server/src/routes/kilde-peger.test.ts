/**
 * F269 — pegepinden tilbage til råkilden.
 *
 * Målt 10/9 2026 under oprydningen af 71 engelske dubletsider i broberg.ai:
 * 33 af de 71 råkilder kunne ikke parres med en eneste Neuron. Kæden
 * Neuron → kandidat fandtes; kandidat → råkilde gjorde ikke, og kandidatens
 * metadata bar et `ingestJobId` der ALTID stod null på den lokale vej.
 *
 * Den bærende prøve er den sidste: null og «feltet mangler» må ikke give
 * samme svar, for det var præcis den forveksling der lod hullet ligne dækning.
 */
import { describe, expect, test } from 'bun:test';
import { laesKildePeger } from './documents.js';

describe('laesKildePeger', () => {
  test('læser den lokale vejs pegepind', () => {
    expect(laesKildePeger('{"sourceDocumentId":"doc_abc"}')).toEqual({ sourceDocumentId: 'doc_abc' });
  });

  test('læser sky-vejens pegepind', () => {
    expect(laesKildePeger('{"ingestJobId":"job_1"}')).toEqual({ ingestJobId: 'job_1' });
  });

  test('begge kan stå samtidig', () => {
    expect(laesKildePeger('{"sourceDocumentId":"doc_abc","ingestJobId":"job_1"}'))
      .toEqual({ sourceDocumentId: 'doc_abc', ingestJobId: 'job_1' });
  });

  test('NULL ER IKKE EN PEGEPIND — det er «vi ved det ikke»', () => {
    // Den ægte metadata fra en kompileret Neuron i broberg.ai, ordret:
    const ægte =
      '{"op":"create","filename":"from-article-to-podcast-without-a-microphone-broberg-ai.md",' +
      '"path":"/neurons/sources/","tags":"podcast,ai-agenter","connector":"mcp:claude-code","ingestJobId":null}';
    expect(laesKildePeger(ægte)).toEqual({});
  });

  test('tom streng er heller ikke en pegepind', () => {
    expect(laesKildePeger('{"sourceDocumentId":"","ingestJobId":""}')).toEqual({});
  });

  test('en værdi af forkert type tælles ikke som en pegepind', () => {
    expect(laesKildePeger('{"sourceDocumentId":123,"ingestJobId":true}')).toEqual({});
  });

  test('intet, tomt eller ugyldigt JSON → tom, aldrig et kast', () => {
    expect(laesKildePeger(null)).toEqual({});
    expect(laesKildePeger(undefined)).toEqual({});
    expect(laesKildePeger('')).toEqual({});
    expect(laesKildePeger('{ikke json')).toEqual({});
  });
});
