/**
 * F229.1 — the entropy gate.
 *
 * These tests build REAL image bytes with sharp rather than mocking it, because
 * the thing under test is a claim about what sharp reports for a picture of
 * nothing. A mocked `stats()` would prove only that our `if` works.
 *
 * The failures they are written against are the ones that fail GREEN:
 *   · an unreadable image counted as blank (a decoder we did not anticipate,
 *     silently deleting a fifth of a corpus and calling it a filter);
 *   · the gate firing when it is switched off;
 *   · `<=` where `<` belongs, so an image exactly at the threshold vanishes;
 *   · a real photograph measuring low enough to be discarded.
 */
import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { imageEntropyVerdict } from '../services/document-images.js';

/** A rectangle in one colour — the shape the owner opened and found. */
async function solidBlob(w = 416, h = 439): Promise<Uint8Array> {
  const png = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 173, g: 216, b: 230 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/** Random pixels — the far end of the scale, standing in for a photograph. */
async function noisyImage(w = 200, h = 200): Promise<Uint8Array> {
  const raw = Buffer.alloc(w * h * 3);
  // Deterministic pseudo-noise so the test cannot flake on a lucky seed.
  let x = 123456789;
  for (let i = 0; i < raw.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = x % 256;
  }
  const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return new Uint8Array(png);
}

test('a solid-colour rectangle is BLANK — the image the owner opened', async () => {
  const v = await imageEntropyVerdict(await solidBlob(), 0.5);
  expect(v.kind).toBe('blank');
});

test('NEGATIVE CONTROL — a noisy image is KEPT at the same threshold', async () => {
  // Without this, "blank" above could just mean the function always says blank.
  const v = await imageEntropyVerdict(await noisyImage(), 0.5);
  expect(v.kind).toBe('keep');
});

test('the gate is OFF for null, undefined and 0 — behaviour is unchanged', async () => {
  const blob = await solidBlob();
  for (const off of [null, undefined, 0]) {
    const v = await imageEntropyVerdict(blob, off);
    // Not merely "kept" — the row must say we never measured, so a caller can
    // tell "we looked and it was fine" from "we never looked".
    expect(v.kind).toBe('unmeasured');
  }
});

test('bytes sharp cannot read are UNMEASURED, never blank', async () => {
  // The expensive confusion: an image we failed to decode is not an image
  // without content. Discarding it would delete data and look like a filter.
  const v = await imageEntropyVerdict(new Uint8Array([1, 2, 3, 4, 5]), 0.5);
  expect(v.kind).toBe('unmeasured');
});

test('MEASURED — a perfectly solid fill is entropy 0, exactly', async () => {
  // Worth pinning as a number rather than as "low": it means NO positive
  // threshold can ever keep a one-colour image, so the setting cannot be
  // tuned into uselessness from this end.
  const v = await imageEntropyVerdict(await solidBlob(), 0.5);
  expect((v as { entropy: number }).entropy).toBe(0);
});

test('the SAME image flips verdict when the threshold moves — direction of `<`', async () => {
  // Guards against an inverted comparison. Every other test here would still
  // pass with the operator flipped if the thresholds happened to sit on the
  // convenient side; this one holds the image fixed and moves the threshold.
  const img = await noisyImage();
  expect((await imageEntropyVerdict(img, 0.5)).kind).toBe('keep');
  expect((await imageEntropyVerdict(img, 8)).kind).toBe('blank');
});

test('exactly AT the threshold is KEPT (< and not <=), matching the px filter', async () => {
  const measured = await imageEntropyVerdict(await noisyImage(), 0.5);
  expect(measured.kind).toBe('keep');
  const at = (measured as { entropy: number }).entropy;
  // Same entropy, threshold set exactly to it: keep. One notch above: blank.
  expect((await imageEntropyVerdict(await noisyImage(), at)).kind).toBe('keep');
  expect((await imageEntropyVerdict(await noisyImage(), at + 0.001)).kind).toBe('blank');
});
