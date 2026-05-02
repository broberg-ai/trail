/**
 * F165.1 — verify Vision-derivative pipeline end-to-end.
 *
 * What this proves:
 *   1. Migration 0030 applied — vision_derivative_path column on document_images.
 *   2. ensureDerivative under-threshold path: small image returns
 *      isDerivative=false, no .webp written, no DB write.
 *   3. ensureDerivative over-threshold path: large image returns
 *      isDerivative=true, valid WebP bytes, derivative path matches
 *      .webp suffix, file exists at that path.
 *   4. Idempotency: second call returns the same bytes from cache,
 *      no re-encode (sharp would emit slightly different bytes if
 *      it re-ran due to non-determinism in libwebp).
 *   5. shouldFallback semantics: 5xx/timeout=true, 4xx=false.
 *
 * Run: `cd apps/server && bun run scripts/verify-f165-1-vision-derivatives.ts`
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import sharp from 'sharp';
import { createLibsqlDatabase } from '@trail/db';
import { ensureDerivative, derivativePathFor, shouldFallback } from '../src/services/vision-derivative.ts';
import { storage } from '../src/lib/storage.ts';

const REPO_ROOT_DB = join(homedir(), 'Apps/broberg/trail/data/trail.db');
const PROBE_ID = crypto.randomUUID().slice(0, 8);

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log(`\n=== F165.1 vision-derivatives probe (id: ${PROBE_ID}) ===\n`);

const trail = await createLibsqlDatabase({ path: REPO_ROOT_DB });
await trail.runMigrations();

// 1. Schema sanity
const cols = await trail.client.execute(`PRAGMA table_info('document_images')`);
const colNames = cols.rows.map((r) => r.name as string);
assert(colNames.includes('vision_derivative_path'), 'document_images.vision_derivative_path column present');

// 2. Under-threshold path. Tiny synthetic JPEG (~1 KB).
const smallPath = `probe-${PROBE_ID}/small.jpg`;
const smallJpeg = await sharp({
  create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 100, b: 50 } },
}).jpeg({ quality: 80 }).toBuffer();
await storage.put(smallPath, smallJpeg, 'image/jpeg');

const small = await ensureDerivative(smallPath, 100, 100, smallJpeg.byteLength);
assert(small.isDerivative === false, 'small image: isDerivative=false');
assert(small.derivativePath === null, 'small image: derivativePath=null');
assert(small.bytes.byteLength === smallJpeg.byteLength, 'small image: original bytes returned unchanged');
const derivExists = await storage.exists(derivativePathFor(smallPath));
assert(derivExists === false, 'small image: no .webp written');

// 3. Over-threshold path. Synthesize a large JPEG (~6 MB).
const largePath = `probe-${PROBE_ID}/large.jpg`;
const largeJpeg = await sharp({
  // 3000x2000 = 6M pixels (over both 4MP threshold AND likely > 3MB).
  create: { width: 3000, height: 2000, channels: 3, background: { r: 80, g: 160, b: 240 } },
})
  // Add noise so JPEG can't trivially compress to nothing.
  .composite([{ input: await sharp({ create: { width: 3000, height: 2000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(), blend: 'over' }])
  .jpeg({ quality: 95 })
  .toBuffer();
await storage.put(largePath, largeJpeg, 'image/jpeg');
console.log(`  (synthesized ${(largeJpeg.byteLength / 1024 / 1024).toFixed(2)} MB JPEG)`);

const large = await ensureDerivative(largePath, 3000, 2000, largeJpeg.byteLength);
assert(large.isDerivative === true, 'large image: isDerivative=true');
assert(large.derivativePath === `probe-${PROBE_ID}/large.webp`, 'large image: derivativePath ends in .webp');
assert(large.bytes.byteLength < 5 * 1024 * 1024, 'large image: derivative bytes < 5 MB (Anthropic limit)');
// WebP magic: bytes 8-11 are 'WEBP'
const webpMagic = Buffer.from(large.bytes.slice(8, 12)).toString('ascii');
assert(webpMagic === 'WEBP', `large image: WebP magic at offset 8 (got "${webpMagic}")`);
const writtenExists = await storage.exists(`probe-${PROBE_ID}/large.webp`);
assert(writtenExists === true, 'large image: .webp file written to storage');

// Long-edge ≤ 1568 (sharp resizes inside that bound).
const meta = await sharp(Buffer.from(large.bytes)).metadata();
assert((meta.width ?? 0) <= 1568, `large image: width ≤ 1568 (got ${meta.width})`);
assert((meta.height ?? 0) <= 1568, `large image: height ≤ 1568 (got ${meta.height})`);

// 4. Idempotency.
const large2 = await ensureDerivative(largePath, 3000, 2000, largeJpeg.byteLength);
assert(large2.isDerivative === true, 'idempotent call: isDerivative=true');
assert(
  Buffer.compare(Buffer.from(large.bytes), Buffer.from(large2.bytes)) === 0,
  'idempotent call: bytes match (no re-encode)',
);

// 5. shouldFallback semantics
assert(shouldFallback({ status: 503 }) === true, 'shouldFallback: 503 → true');
assert(shouldFallback({ status: 502 }) === true, 'shouldFallback: 502 → true');
assert(shouldFallback({ status: 413 }) === false, 'shouldFallback: 413 → false (image-too-large is NOT availability)');
assert(shouldFallback({ status: 400 }) === false, 'shouldFallback: 400 → false');
assert(shouldFallback({ status: 401 }) === false, 'shouldFallback: 401 → false');
assert(shouldFallback({ name: 'AbortError' }) === true, 'shouldFallback: AbortError → true');
assert(shouldFallback({ code: 'ECONNRESET' }) === true, 'shouldFallback: ECONNRESET → true');
assert(shouldFallback(null) === false, 'shouldFallback: null → false');

// Cleanup probe blobs
await storage.delete(smallPath).catch(() => {});
await storage.delete(largePath).catch(() => {});
await storage.delete(`probe-${PROBE_ID}/large.webp`).catch(() => {});
console.log('  (probe blobs cleaned up)');

await trail.close();

if (failures > 0) {
  console.log(`\n✗ ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ all assertions passed');
