/**
 * F241.1 — the gate for the display thumbnail.
 *
 * THE ASSERTION IS ON SIZE, NOT ON STATUS. Before this change the thumb
 * branch fell through and served the full original — with a 200 and a valid
 * image content-type. So a test that checked "did it answer with an image?"
 * would have been GREEN on the exact bug: 24.4 MB per screenful of Sanne's
 * image list. The only thing that discriminates is that the bytes are
 * SMALLER, and the numbers are printed when they are not.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import sharp from 'sharp';

// A UNIQUE PREFIX PER RUN, rather than pointing storage somewhere else.
//
// Two attempts failed before this one, and both failed GREEN-ish in a way
// worth recording. `STORAGE_ROOT` is not a variable this codebase reads
// (lib/storage.ts:8 reads TRAIL_UPLOADS_DIR), so the tests wrote into the
// developer's REAL uploads directory and a thumbnail cached by an earlier
// run made a later assertion pass for the wrong reason. Setting the right
// variable at module scope then passed alone and failed in the full suite,
// because bun shares one process per package and another test file had
// already imported storage.ts — so the value was read before we set it.
//
// A unique prefix needs neither: no stale bytes can exist under it, and it
// cannot depend on which file loaded first.
const RUN = `thumbtest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const KEYS: string[] = [];
const key = (name: string): string => {
  const k = `${RUN}/${name}`;
  KEYS.push(k);
  return k;
};

beforeAll(() => { /* nothing to set up — the prefix is the isolation */ });

afterAll(async () => {
  const { storage } = await import('../lib/storage.js');
  for (const k of KEYS) {
    for (const p of [k, k.replace(/\.[^.]+$/, '.thumb480.webp')]) {
      try { await storage.delete(p); } catch { /* best effort */ }
    }
  }
});

/**
 * A PNG deliberately BELOW the vision threshold (3 MB / 4 MP) — the
 * 1233-of-1385 case that used to get no thumbnail at all.
 *
 * The pixels are pseudo-random on purpose. A flat fill, or a repeating
 * pattern, compresses to almost nothing, and then the ORIGINAL is smaller
 * than any thumbnail could be — which is a real case (covered below), but
 * makes it the wrong fixture for proving a thumbnail helps.
 */
async function noisyPng(width: number, height: number): Promise<Uint8Array> {
  const channels = 3;
  const raw = Buffer.allocUnsafe(width * height * channels);
  let x = 123456789;
  for (let i = 0; i < raw.length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5; // xorshift32
    raw[i] = x & 0xff;
  }
  const out = await sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
  return new Uint8Array(out);
}

/**
 * A smooth repeating gradient: PNG compresses it superbly (~17 kB), while a
 * lossy WebP of the same pixels comes out far LARGER (~67 kB). Measured, not
 * assumed — this exact pair is what revealed that a thumbnail is not always
 * smaller.
 */
async function pngThatBeatsItsOwnThumb(): Promise<Uint8Array> {
  const width = 900, height = 700, channels = 3;
  const raw = Buffer.allocUnsafe(width * height * channels);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 256;
  const out = await sharp(raw, { raw: { width, height, channels } }).png().toBuffer();
  return new Uint8Array(out);
}

test('a SMALL image (under the vision threshold) still gets a thumbnail, and it is smaller', async () => {
  const { storage } = await import('../lib/storage.js');
  const { ensureDisplayThumb, needsDerivative } = await import('./vision-derivative.js');

  const original = await noisyPng(900, 700);
  const meta = await sharp(Buffer.from(original)).metadata();

  // Guard the premise: this image must be BELOW the vision threshold, or the
  // test is exercising the path that already worked.
  expect(needsDerivative(meta.width ?? 0, meta.height ?? 0, original.byteLength)).toBe(false);

  const path = key('page-1-img-1.png');
  await storage.put(path, original, 'image/png');

  const r = await ensureDisplayThumb(path);

  if (!(r.bytes.byteLength < original.byteLength)) {
    throw new Error(
      `thumbnail is not smaller: thumb=${r.bytes.byteLength}B original=${original.byteLength}B`,
    );
  }
  expect(r.isThumb).toBe(true);
  expect(r.contentType).toBe('image/webp');

  const tmeta = await sharp(Buffer.from(r.bytes)).metadata();
  expect(tmeta.format).toBe('webp');
  expect(Math.max(tmeta.width ?? 0, tmeta.height ?? 0)).toBeLessThanOrEqual(480);
});

// 673 of Sanne's 1385 images are under 50 kB. Re-encoding those as WebP can
// come out BIGGER — measured while writing this: a 67 kB thumb from a 17 kB
// original. Serving that would have made half the list worse while the
// headline number improved.
test('when the ORIGINAL is already smaller, it is served instead — and no thumb is cached', async () => {
  const { storage } = await import('../lib/storage.js');
  const { ensureDisplayThumb, displayThumbPathFor } = await import('./vision-derivative.js');

  const original = await pngThatBeatsItsOwnThumb();
  const path = key('page-9-img-1.png');
  await storage.put(path, original, 'image/png');

  const r = await ensureDisplayThumb(path);

  expect(r.isThumb).toBe(false);
  expect(r.contentType).toBe('application/octet-stream');
  expect(Buffer.from(r.bytes).equals(Buffer.from(original))).toBe(true);
  // A losing thumbnail must not be written: it costs disk for bytes we will
  // never serve, and forces the same comparison on every later read.
  expect(await storage.get(displayThumbPathFor(path))).toBeNull();
});

test('the ORIGINAL is untouched — same bytes after a thumbnail is made', async () => {
  const { storage } = await import('../lib/storage.js');
  const { ensureDisplayThumb } = await import('./vision-derivative.js');

  const original = await noisyPng(900, 700);
  const path = key('page-2-img-1.png');
  await storage.put(path, original, 'image/png');

  await ensureDisplayThumb(path);

  const after = await storage.get(path);
  expect(after).not.toBeNull();
  expect(Buffer.from(after as Uint8Array).equals(Buffer.from(original))).toBe(true);
});

test('idempotent — a second call returns the cached bytes, byte for byte', async () => {
  const { storage } = await import('../lib/storage.js');
  const { ensureDisplayThumb, displayThumbPathFor } = await import('./vision-derivative.js');

  const path = key('page-3-img-1.png');
  await storage.put(path, await noisyPng(900, 700), 'image/png');

  const a = await ensureDisplayThumb(path);
  const b = await ensureDisplayThumb(path);
  expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);

  const stored = await storage.get(displayThumbPathFor(path));
  expect(stored).not.toBeNull();
  expect(Buffer.from(stored as Uint8Array).equals(Buffer.from(a.bytes))).toBe(true);
});

test('the thumbnail does NOT land on the vision-derivative path', async () => {
  const { displayThumbPathFor, derivativePathFor } = await import('./vision-derivative.js');
  const p = 'anywhere/images/page-4-img-1.png';
  // The model's bytes and the screen's bytes must stay two different things.
  expect(displayThumbPathFor(p)).not.toBe(derivativePathFor(p));
  expect(derivativePathFor(p)).toBe('anywhere/images/page-4-img-1.webp');
});
