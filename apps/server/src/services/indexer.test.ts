/**
 * F254.1 — portioner måles i TOKENS, ikke i antal.
 *
 * Prøven er bygget om den målte fejl: 64 stykker virkede på broberg.ai og
 * fejlede på Sanne med «Too many tokens overall», fordi hendes tekststykker er
 * længere. Et ANTAL siger intet om hvor lange teksterne er.
 */
import { test, expect } from 'bun:test';
import { portioner, TOKEN_BUDGET, CHARS_PER_TOKEN } from './indexer.js';

const tekst = (tokens: number) => ({ content: 'x'.repeat(Math.round(tokens * CHARS_PER_TOKEN)) });

test('lange stykker deles i FLERE portioner end korte — det var hele fejlen', () => {
  const lange = Array.from({ length: 64 }, () => tekst(750));   // Sannes profil
  const korte = Array.from({ length: 64 }, () => tekst(100));
  expect(portioner(lange).length).toBeGreaterThan(portioner(korte).length);
});

test('ingen portion overskrider budgettet', () => {
  const rows = Array.from({ length: 200 }, (_, i) => tekst(300 + (i % 7) * 400));
  for (const p of portioner(rows)) {
    const t = p.reduce((s, r) => s + r.content.length / CHARS_PER_TOKEN, 0);
    // Ét stykke alene må gerne sprænge budgettet; en portion med flere må ikke.
    if (p.length > 1) expect(t).toBeLessThanOrEqual(TOKEN_BUDGET);
  }
});

test('ET stykke der ALENE er for stort sendes stadig — frem for aldrig at blive forsøgt', () => {
  const p = portioner([tekst(TOKEN_BUDGET * 3)]);
  expect(p.length).toBe(1);
  expect(p[0]!.length).toBe(1);
});

test('ALLE stykker kommer med, præcis én gang', () => {
  const rows = Array.from({ length: 137 }, (_, i) => ({ content: `nr-${i}`.repeat(50) }));
  const flad = portioner(rows).flat();
  expect(flad.length).toBe(137);
  expect(new Set(flad.map((r) => r.content)).size).toBe(137);
});

test('tom liste giver ingen portioner — ikke én tom', () => {
  // En tom portion ville blive sendt som et kald med nul tekster og koste en
  // rundtur for ingenting.
  expect(portioner([])).toEqual([]);
});

/**
 * F254.5 — bagfyldning af tekststykker.
 *
 * Den målte fejl: `storeChunks` kaldes seks steder, og ingen af dem er den vej
 * en Neuron bliver født. Resultatet var at hvert eneste stykke i hver eneste
 * base tilhørte en RÅ KILDE — 182 af 182 stykke-hits over fire søgninger — så
 * vektor-indekset dækkede den skrabede halvdel af korpusset og ikke den skrevne.
 */
import { backfillChunks } from './indexer.js';

type Kaldt = { documentId: string; kbId: string; content: string };

function fakeDb(rows: Array<{ id: string; content: string | null }>) {
  const sqlSet: string[] = [];
  return {
    db: {
      execute: async (sql: string) => { sqlSet.push(sql); return { rows }; },
    } as never,
    sqlSet,
  };
}

test('DOKUMENTER UDEN STYKKER BLIVER CHUNKET — det var hele fejlen', async () => {
  const { db } = fakeDb([
    { id: 'neuron-1', content: 'Trail er en RAG hvis korpus er skrevet.' },
    { id: 'neuron-2', content: 'Compile-at-ingest, ikke query-time.' },
  ]);
  const kaldt: Kaldt[] = [];
  const r = await backfillChunks(db, 't1', 'kb1', async (documentId, kbId, content) => {
    kaldt.push({ documentId, kbId, content });
    return 3;
  });
  expect(kaldt.map((k) => k.documentId)).toEqual(['neuron-1', 'neuron-2']);
  expect(r).toEqual({ documents: 2, chunks: 6 });
});

test('forespørgslen udelukker arkiverede OG dokumenter der allerede HAR stykker', async () => {
  // Uden begge betingelser ville bagfyldningen enten genskabe stykker for
  // arkiveret indhold (som søgningen med vilje skjuler) eller re-chunke hele
  // basen ved hver fejning — storeChunks sletter og genindsætter, så det ville
  // koste en fuld omskrivning af tabellen hvert minut.
  const { db, sqlSet } = fakeDb([]);
  await backfillChunks(db, 't1', 'kb1', async () => 0);
  expect(sqlSet[0]).toContain('d.archived = 0');
  expect(sqlSet[0]).toContain('NOT EXISTS');
});

test('et TOMT dokument kalder ikke storeChunks — ellers gentages arbejdet for evigt', async () => {
  // chunkText('') giver nul stykker, så dokumentet ville stadig mangle stykker
  // ved næste fejning: en transaktion der rydder og genindsætter ingenting,
  // igen og igen, uden nogensinde at flytte noget.
  const { db } = fakeDb([
    { id: 'tom', content: '   ' },
    { id: 'null', content: null },
    { id: 'rigtig', content: 'indhold' },
  ]);
  const kaldt: string[] = [];
  const r = await backfillChunks(db, 't1', 'kb1', async (id) => { kaldt.push(id); return 1; });
  expect(kaldt).toEqual(['rigtig']);
  expect(r.documents).toBe(1);
});

test('et dokument der gav NUL stykker tælles ikke som bagfyldt', async () => {
  const { db } = fakeDb([{ id: 'a', content: 'x' }]);
  const r = await backfillChunks(db, 't1', 'kb1', async () => 0);
  expect(r).toEqual({ documents: 0, chunks: 0 });
});
