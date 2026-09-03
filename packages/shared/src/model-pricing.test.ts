/**
 * F228 — prices come from the SDK, and the ways that goes wrong.
 *
 * Not "does it return a number": the failures worth a test are an unknown model
 * degrading into a confident price, a free ROUTE being priced as its paid
 * model, and the snapshot date going missing so staleness becomes invisible
 * again — which is the whole reason the hand-maintained table was replaced.
 */
import { expect, test } from 'bun:test';
import { modelPricing, isFreeModel, pricesGeneratedAt } from './model-pricing.js';

test('the number that was wrong for four months is now right', () => {
  // Our table said $2.00/$6.00 since 13 May. Mistral Large is the smart tier,
  // so the picker overstated our quality option by 4x.
  const p = modelPricing('mistral-large-latest');
  expect(p).not.toBeNull();
  expect(p!.inputPer1M).toBeLessThan(2.0);
  expect(p!.region).toBe('eu');
});

test('an unknown model is UNKNOWN, never a number', () => {
  // The failure this file exists to prevent: a missing price degrading into a
  // confident one. null is the only honest answer.
  expect(modelPricing('a-model-nobody-has-heard-of')).toBeNull();
  expect(isFreeModel('a-model-nobody-has-heard-of')).toBe(false);
});

test('a FREE ROUTE is free, even though the MODEL is expensive', () => {
  // Claude Sonnet is $3/$15 through the API and $0 through the local CLI. The
  // SDK prices the model; only Trail knows which route an id means.
  expect(modelPricing('claude-sonnet-4-6')).toEqual({
    inputPer1M: 0, outputPer1M: 0, region: 'us', source: 'local-cli',
  });
  expect(isFreeModel('claude-sonnet-4-6')).toBe(true);
});

test('NEGATIVE CONTROL — the paid route of the SAME model is not free', () => {
  // Without this pair, "everything is free" would pass the test above.
  expect(isFreeModel('claude-sonnet-4-6-api')).toBe(false);
  expect(modelPricing('claude-sonnet-4-6-api')!.inputPer1M).toBeGreaterThan(0);
});

test('our own suffixed ids resolve through the alias map', () => {
  // -api is Trail's routing suffix; the SDK has never heard of it.
  expect(modelPricing('claude-haiku-4-5-20251001-api')).not.toBeNull();
});

test('region comes from the SDK, so a GDPR note is data and not a string', () => {
  expect(modelPricing('mistral-small-latest')!.region).toBe('eu');
  expect(modelPricing('anthropic/claude-sonnet-4.6')!.region).toBe('us');
});

test('the snapshot date exists and parses — staleness must stay visible', () => {
  // The one thing the old table could never do: say how old it is.
  const at = pricesGeneratedAt();
  expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(Number.isNaN(Date.parse(at))).toBe(false);
});

test('a free route still reports its region — free is not the same as safe', () => {
  // The call costs nothing and the data still leaves the EU.
  expect(modelPricing('claude-sonnet-4-6')!.region).not.toBe('eu');
});
