import { describe, expect, test } from 'bun:test';
import { scoreChunk, shouldEmit, DEFAULT_GATE_THRESHOLD } from './gate.js';

describe('scoreChunk', () => {
  test('commitment + date in Danish scores above the default threshold', () => {
    const r = scoreChunk(
      'Vi har aftalt at jeg sender det reviderede tilbud senest 12/8 til Mette.',
    );
    expect(r.score).toBeGreaterThanOrEqual(DEFAULT_GATE_THRESHOLD);
    expect(r.signals.some((s) => s.kind === 'commitment')).toBe(true);
    expect(shouldEmit(r)).toBe(true);
  });

  test('decision in English scores above threshold', () => {
    const r = scoreChunk(
      'After the sync we decided to go with the monthly plan instead of annual billing.',
    );
    expect(r.signals.some((s) => s.kind === 'decision')).toBe(true);
    expect(shouldEmit(r)).toBe(true);
  });

  test('contact + money facts contribute signals', () => {
    const r = scoreChunk(
      'Ny kontakt hos Acme: peter@acme.dk — de betaler 12.500 kr pr. måned i dag.',
    );
    const kinds = r.signals.map((s) => s.kind);
    expect(kinds).toContain('contact');
    expect(kinds).toContain('money');
  });

  test('mundane chatter scores below threshold (strict gate)', () => {
    const r = scoreChunk('haha ja det var virkelig en sjov video du sendte i går aftes');
    expect(shouldEmit(r)).toBe(false);
  });

  test('short fragments are a hard zero', () => {
    expect(scoreChunk('ok fint').score).toBe(0);
    expect(scoreChunk('   ').signals).toEqual([]);
  });

  test('score is capped at 1', () => {
    const r = scoreChunk(
      'Aftalt og besluttet: deadline 2026-08-01, vi vælger Acme. Kontakt lars@acme.dk, ' +
        'tlf +45 12 34 56 78, pris 40.000 kr, faktura sendes senest 1/9. We agreed and decided.',
    );
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.score).toBeGreaterThan(0.8);
  });
});
