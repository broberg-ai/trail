/**
 * F286.8 — modprøver for prompt-ablationen.
 *
 * To ting kan gå galt i stilhed her, og hver har sin prøve:
 *
 * 1. EN IMPORT DER KOSTER PENGE. baseline.ts brugte engang 444 meterede kald
 *    fordi en testfil importerede den. Denne fil ville koste 1.332. Prøven
 *    tæller fetch-kald under import og kræver nul.
 *
 * 2. ET JOIN PÅ POSITION I STEDET FOR ID. Det bærende tal er «hvad blev de
 *    afviste eksempler til». Joines der på rækkefølge, er tallet rigtigt så
 *    længe begge kørsler kommer i samme orden — og lydløst forkert den dag
 *    de ikke gør. Prøven leverer bevidst de to lister i forskellig orden.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

let fetchCalls = 0;
const realFetch = globalThis.fetch;
const realKey = process.env.MISTRAL_API_KEY;

beforeAll(() => {
  // En falsk nøgle, så main() ikke stopper på den manglende nøgle FØR den
  // når at kalde ud — ellers ville prøven bestå af den forkerte grund.
  process.env.MISTRAL_API_KEY = 'test-key-never-sent';
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('{"error":"blocked in test"}', { status: 500 });
  }) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.MISTRAL_API_KEY;
  else process.env.MISTRAL_API_KEY = realKey;
});

describe('import alene', () => {
  test('koster ikke et eneste kald', async () => {
    await import('./prompt-ablation.js');
    // Giv en evt. utilsigtet main() tid til at nå sine første kald.
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchCalls).toBe(0);
  });
});

describe('transitions — join på id, ikke på position', () => {
  type P = { task: 'routing'; id: string; truth: string; predicted: string | null; outcome: 'correct' | 'wrong' | 'no-answer' };
  const p = (id: string, outcome: P['outcome']): P => ({
    task: 'routing',
    id,
    truth: 't',
    predicted: outcome === 'no-answer' ? null : outcome === 'correct' ? 't' : 'x',
    outcome,
  });

  test('en afvisning der bliver et forkert gæt tælles som refusal→wrong', async () => {
    const { transitions } = await import('./prompt-ablation.js');
    const from = [p('a', 'no-answer'), p('b', 'correct')];
    const to = [p('a', 'wrong'), p('b', 'correct')];
    const c = transitions(from as never, to as never);
    expect(c['refusal→wrong']).toBe(1);
    expect(c['correct→correct']).toBe(1);
    expect(c['refusal→correct']).toBeUndefined();
  });

  test('omvendt rækkefølge i anden kørsel giver SAMME tal', async () => {
    const { transitions } = await import('./prompt-ablation.js');
    const from = [p('a', 'no-answer'), p('b', 'correct'), p('c', 'wrong')];
    // Samme udfald pr. id — men leveret baglæns. Et join på position ville
    // parre a med c og c med a, og tallene ville flytte sig.
    const to = [p('c', 'correct'), p('b', 'correct'), p('a', 'wrong')];
    const c = transitions(from as never, to as never);
    expect(c['refusal→wrong']).toBe(1);
    expect(c['wrong→correct']).toBe(1);
    expect(c['correct→correct']).toBe(1);
  });
});

describe('transitions — et fejlet kald er ikke en afvisning', () => {
  test('et kald der aldrig lykkedes tælles ikke som refusal→noget', async () => {
    const { transitions } = await import('./prompt-ablation.js');
    // Samme form som runVariant producerer ved en netværksfejl: label null,
    // outcome no-answer — men failed. Uden spærren ville det her give
    // refusal→correct = 1, altså en netværksfejl forklædt som en afvisning.
    const from = [{ task: 'routing', id: 'x', truth: 't', predicted: null, outcome: 'no-answer', failed: true }];
    const to = [{ task: 'routing', id: 'x', truth: 't', predicted: 't', outcome: 'correct' }];
    const c = transitions(from as never, to as never);
    expect(c['refusal→correct']).toBeUndefined();
    expect(Object.keys(c)).toHaveLength(0);
  });
});
