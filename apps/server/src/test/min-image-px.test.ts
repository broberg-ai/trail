/**
 * F226 — the per-Trail minimum image size.
 *
 * The rule is small, so the tests are about the ways it could be subtly wrong:
 * an existing Trail changing behaviour on its own, a `>` where `>=` belongs,
 * an area comparison that lets a 2000x10 divider through, and a missing
 * dimension being read as "small" rather than "unknown".
 */
import { expect, test } from 'bun:test';
import { isImageLargeEnough } from '../services/document-images.js';

test('a Trail with no threshold keeps every image — behaviour is unchanged', () => {
  for (const [w, h] of [[1, 1], [8, 8], [4000, 3000]] as Array<[number, number]>) {
    expect(isImageLargeEnough(w, h, null)).toBe(true);
    expect(isImageLargeEnough(w, h, undefined)).toBe(true);
    expect(isImageLargeEnough(w, h, 0)).toBe(true);
  }
});

test('below the threshold is filtered, above is kept', () => {
  expect(isImageLargeEnough(32, 32, 64)).toBe(false);
  expect(isImageLargeEnough(400, 400, 64)).toBe(true);
});

test('NEGATIVE CONTROL — exactly AT the threshold is KEPT (>=, not >)', () => {
  // Off-by-one here would silently discard a whole class of images and look
  // like a rounding difference in the count.
  expect(isImageLargeEnough(64, 64, 64)).toBe(true);
  expect(isImageLargeEnough(63, 64, 64)).toBe(false);
});

test('the SMALLEST side decides — a 2000x10 divider rule is filtered', () => {
  // This is the shape an area-based comparison would let through: 20.000 px²
  // is larger than a 128x128 image nobody would filter.
  expect(isImageLargeEnough(2000, 10, 64)).toBe(false);
  expect(isImageLargeEnough(10, 2000, 64)).toBe(false);
});

test('a missing dimension is UNKNOWN, not small — the image is kept', () => {
  // Discarding on absent data would drop images whose extractor simply did
  // not report a size, and the count would look like a successful filter.
  expect(isImageLargeEnough(0, 0, 64)).toBe(true);
  expect(isImageLargeEnough(500, 0, 64)).toBe(true);
});

test('the measured default (64) matches what was decided on Sanne’s Trail', () => {
  // 690 of 1.557 images fall below 64px, and only 2 of them ever earned a
  // vision description. Pinned so a later change to the recommended default
  // is a deliberate act rather than a drift.
  const DEFAULT = 64;
  expect(isImageLargeEnough(63, 63, DEFAULT)).toBe(false);
  expect(isImageLargeEnough(64, 64, DEFAULT)).toBe(true);
});
