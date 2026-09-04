/**
 * F235 — the letter must state the SAME number the code enforces.
 *
 * The failure this guards is silent and customer-facing: change the TTL, and
 * the letter keeps confidently telling people "15 minutes" while the link dies
 * sooner. Nothing errors, and the person who suffers is the one who trusted
 * the sentence.
 *
 * Asserting on the RENDERED letter, not on the constant — a test that reads
 * the constant twice proves only that a variable equals itself.
 */
import { expect, test } from 'bun:test';
import { MAGIC_LINK_TTL_MIN } from './ttl.js';

test('the constant is a sane number of minutes', () => {
  expect(Number.isInteger(MAGIC_LINK_TTL_MIN)).toBe(true);
  expect(MAGIC_LINK_TTL_MIN).toBeGreaterThan(0);
});

test('the letter states the enforced TTL, and no other number', async () => {
  const src = await Bun.file(new URL('./email.ts', import.meta.url)).text();
  // No bare "expires in <digits> minutes" left anywhere — that is the shape
  // that drifted. It must be interpolated.
  const hardcoded = src.match(/expires in \d+ minutes/g);
  expect(hardcoded).toBeNull();
  expect(src).toContain('${MAGIC_LINK_TTL_MIN} minutes');
});

test('auth enforces the same constant it imports — no second literal', async () => {
  const src = await Bun.file(new URL('./auth.ts', import.meta.url)).text();
  expect(src).toContain("from './ttl.js'");
  // The old local declaration must be gone, or there are two sources again.
  expect(src).not.toMatch(/const MAGIC_LINK_TTL_MIN\s*=/);
});
