/**
 * F229.2 — OCR must not be asked to read an image with nothing in it.
 *
 * MEASURED, NOT ASSUMED: handed a plain 300x300 rectangle in one colour,
 * Mistral OCR returned an invented LaTeX formula. No error, no signal. That
 * sentence would have been written into a customer's knowledge base as text
 * READ FROM THEIR OWN SOURCE — the most expensive thing this repo could ship.
 *
 * These tests make no network call: the blank path short-circuits before the
 * API, which is the whole point of the guard.
 */
import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { ocrImage } from '../services/vision.js';

const solid = async (w = 300, h = 300) =>
  new Uint8Array(
    await sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 220, b: 235 } } })
      .png()
      .toBuffer(),
  );

test('a solid-colour image is never sent to OCR', async () => {
  const r = await ocrImage(await solid(), 'image/png');
  expect(r).not.toBeNull();
  expect(r!.text).toBeNull();
  // The model field says WHY there is no text, so a later reader can tell
  // "we skipped it" from "OCR ran and found nothing".
  expect(r!.model).toBe('skipped-blank');
  expect(r!.costCents).toBe(0);
});

test('no text is null, never an empty string', async () => {
  // An empty string would be indistinguishable from "OCR has not run" once it
  // is a column in a database.
  const r = await ocrImage(await solid(), 'image/png');
  expect(r!.text).not.toBe('');
  expect(r!.text).toBeNull();
});

test('MEASURED — the floor sits in an empty band, so nothing readable falls below it', async () => {
  // The least contentful readable thing we can construct: one small word on
  // white. It must measure ABOVE the floor, or the guard would silence real
  // text instead of fabrication.
  const withWord = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="white"/><text x="20" y="150" font-size="18">ok</text></svg>`,
    ),
  )
    .png()
    .toBuffer();
  const { entropy } = await sharp(withWord).stats();
  expect(entropy).toBeGreaterThan(0.01);

  // And the solid one must be below it — the two halves of the same claim.
  const { entropy: blankEntropy } = await sharp(Buffer.from(await solid())).stats();
  expect(blankEntropy).toBeLessThan(0.01);
});
