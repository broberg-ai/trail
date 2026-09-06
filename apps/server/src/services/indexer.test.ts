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
