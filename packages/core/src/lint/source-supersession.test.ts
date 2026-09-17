/**
 * F275.3 — the lint must never raise a contradiction between two editions of the
 * SAME source.
 *
 * The checker below ALWAYS says "these contradict each other". That is
 * deliberate: a test where the model could answer no by itself would pass
 * without proving anything. Everything green here is green because the skip
 * worked — not because there was nothing to skip.
 */
import { describe, it, expect, mock } from 'bun:test';
import {
  detectContradictions,
  sameSource,
  type ContradictionCandidate,
  type NewNeuron,
} from './contradictions.js';

const ALWAYS_CONTRADICTS = mock(async () => ({
  contradicts: true,
  summary: 'they each say something else',
  newQuote: 'now',
  existingQuote: 'before',
}));

function neuron(id: string, identity: string | null): NewNeuron {
  return { documentId: id, filename: `${id}.md`, title: id, content: `content ${id}`, version: 1, sourceIdentity: identity };
}
function counterpart(id: string, identity: string | null): ContradictionCandidate {
  return { documentId: id, filename: `${id}.md`, title: id, content: `content ${id}`, version: 1, sourceIdentity: identity };
}

const URL_A = 'url:https://broberg.ai/flagskibe/bid';
const URL_B = 'url:https://broberg.ai/indsigter/design';

describe('F275.3 AC#0 — two editions of the same source raise NO contradiction', () => {
  it('same URL ⇒ zero findings, and the checker was never even asked', async () => {
    ALWAYS_CONTRADICTS.mockClear();
    const findings = await detectContradictions(
      neuron('new', URL_A), [counterpart('old', URL_A)], ALWAYS_CONTRADICTS, undefined, true,
    );
    expect(findings).toEqual([]);
    // The skip sits BEFORE the call: an edit on the site costs no money either.
    expect(ALWAYS_CONTRADICTS).not.toHaveBeenCalled();
  });
});

describe('F275.3 AC#1 — NEGATIVE CONTROL: different sources still contradict', () => {
  it('two different URLs produce a finding', async () => {
    const findings = await detectContradictions(
      neuron('new', URL_A), [counterpart('other', URL_B)], ALWAYS_CONTRADICTS, undefined, true,
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.kind).toBe('contradiction-alert');
  });

  it('mixed batch: only the counterpart with the SAME source is skipped', async () => {
    // Without this, "always skip" would pass just as green as the rule.
    const findings = await detectContradictions(
      neuron('new', URL_A),
      [counterpart('same-source', URL_A), counterpart('other-source', URL_B), counterpart('unknown', null)],
      ALWAYS_CONTRADICTS, undefined, true,
    );
    expect(findings.map((f) => (f.details as { existingDocumentId: string }).existingDocumentId).sort())
      .toEqual(['other-source', 'unknown']);
  });
});

describe('F275.3 AC#4 — THE SAFE DEFAULT: no identity ⇒ CONTRADICTION', () => {
  it('two Neurons WITHOUT an identity are not "the same unknown source"', async () => {
    // Had the doubt fallen the other way, the entire current base — where the
    // field is empty until the backfill has run — would become invisible to
    // detection the second the switch was turned on. And a contradiction that is
    // never raised looks exactly like one that does not exist.
    const findings = await detectContradictions(
      neuron('new', null), [counterpart('old', null)], ALWAYS_CONTRADICTS, undefined, true,
    );
    expect(findings.length).toBe(1);
  });

  it('only one side known ⇒ still a contradiction, in both directions', async () => {
    expect((await detectContradictions(neuron('n', URL_A), [counterpart('g', null)], ALWAYS_CONTRADICTS, undefined, true)).length).toBe(1);
    expect((await detectContradictions(neuron('n', null), [counterpart('g', URL_A)], ALWAYS_CONTRADICTS, undefined, true)).length).toBe(1);
  });

  it('sameSource() says it itself: null never matches null', () => {
    expect(sameSource({ sourceIdentity: null }, { sourceIdentity: null })).toBe(false);
    expect(sameSource({ sourceIdentity: URL_A }, { sourceIdentity: null })).toBe(false);
    expect(sameSource({ sourceIdentity: URL_A }, { sourceIdentity: URL_A })).toBe(true);
    expect(sameSource({ sourceIdentity: URL_A }, { sourceIdentity: URL_B })).toBe(false);
  });

  it('an empty string is not an identity that matches another empty one either', () => {
    // sourceIdentity() never returns '', but a raw DB value could be.
    expect(sameSource({ sourceIdentity: '' }, { sourceIdentity: '' })).toBe(true);
    // ^ documented honestly: '' === '' is true. That is why sourceIdentity() must
    //   keep rejecting empty values — see source-identity.ts.
  });
});

describe('F275.3 AC#3 — the switch governs it', () => {
  it('switch OFF ⇒ the lint behaves as it did before the feature existed', async () => {
    const findings = await detectContradictions(
      neuron('new', URL_A), [counterpart('old', URL_A)], ALWAYS_CONTRADICTS, undefined, false,
    );
    expect(findings.length).toBe(1);
  });

  it('argument OMITTED ⇒ old behaviour as well', async () => {
    // The default is `false` on purpose: a new rule must not be able to sneak in
    // through an argument a caller forgot to pass.
    const findings = await detectContradictions(neuron('new', URL_A), [counterpart('old', URL_A)], ALWAYS_CONTRADICTS);
    expect(findings.length).toBe(1);
  });
});

describe('F275.3 — the skip leaves the old rules alone', () => {
  it('a Neuron still does not contradict itself', async () => {
    const findings = await detectContradictions(
      neuron('same', URL_A), [counterpart('same', URL_B)], ALWAYS_CONTRADICTS, undefined, true,
    );
    expect(findings).toEqual([]);
  });

  it('a checker that fails still stays silent — it does not raise a guess', async () => {
    const findings = await detectContradictions(
      neuron('new', URL_A),
      [counterpart('other', URL_B)],
      mock(async () => { throw new Error('the model did not answer'); }),
      undefined, true,
    );
    expect(findings).toEqual([]);
  });
});
