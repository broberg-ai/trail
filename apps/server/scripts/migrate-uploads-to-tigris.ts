/**
 * F222.1 — copy every upload file from the local volume into Tigris.
 *
 * Run ON the engine machine: bun /app/apps/server/scripts/migrate-uploads-to-tigris.ts
 *
 * COPY, never move: the local files stay untouched (no naked cutover — serving
 * flips to Tigris only after this reports clean, and the volume copy remains
 * the rollback until F222.1 closes). Idempotent: a key that already exists in
 * the bucket WITH the same byte-size is skipped, so a crashed run is resumed
 * by running it again.
 *
 * Every uploaded file is verified by SIZE COMPARISON against the bucket's own
 * listing afterwards — the report counts what the BUCKET says it holds, not
 * what the loop believes it sent.
 */
import { join } from 'node:path';
import { LocalStorage, TigrisStorage } from '@trail/storage';

const UPLOADS_ROOT = process.env.TRAIL_UPLOADS_DIR ?? join(process.env.TRAIL_DATA_DIR ?? '/data', 'uploads');
const local = new LocalStorage(UPLOADS_ROOT);
const tigris = new TigrisStorage({
  bucket: process.env.BUCKET_NAME ?? '',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  endpoint: process.env.AWS_ENDPOINT_URL_S3 ?? '',
  region: process.env.AWS_REGION,
  stagingDir: '/tmp/tigris-migrate-staging',
});

const t0 = Date.now();
console.log(`[migrate] læser lokal fil-liste under ${UPLOADS_ROOT} …`);
const localSizes = await local.statMany('');
// _tmp/ holds chunked-upload staging leftovers — ephemeral, never migrated.
const toMigrate = [...localSizes.entries()].filter(([k]) => !k.startsWith('_tmp/'));
const totalBytes = toMigrate.reduce((n, [, b]) => n + b, 0);
console.log(`[migrate] ${toMigrate.length} filer · ${(totalBytes / 1e6).toFixed(0)} MB (skipper ${localSizes.size - toMigrate.length} _tmp-filer)`);

console.log('[migrate] læser bucket-liste …');
const bucketSizes = await tigris.statMany('');
console.log(`[migrate] bucket har ${bucketSizes.size} objekter i forvejen`);

let copied = 0;
let skipped = 0;
let failedFiles: string[] = [];
let copiedBytes = 0;

for (const [key, size] of toMigrate) {
  if (bucketSizes.get(key) === size) {
    skipped++;
    continue;
  }
  try {
    const bytes = await local.get(key);
    if (!bytes) throw new Error('lokal fil forsvandt under kørslen');
    await tigris.put(key, bytes);
    copied++;
    copiedBytes += size;
    if (copied % 200 === 0) {
      console.log(`[migrate] ${copied} kopieret · ${(copiedBytes / 1e6).toFixed(0)} MB · ${Math.round((Date.now() - t0) / 1000)}s`);
    }
  } catch (err) {
    failedFiles.push(key);
    console.error(`[migrate] FEJL på ${key}:`, (err as Error).message);
  }
}

// The verdict comes from the BUCKET, not from the loop's own bookkeeping.
console.log('[migrate] læser bucket-listen IGEN til facit …');
const after = await tigris.statMany('');
let matched = 0;
const mismatched: string[] = [];
for (const [key, size] of toMigrate) {
  if (after.get(key) === size) matched++;
  else mismatched.push(`${key} (lokal ${size} vs bucket ${after.get(key) ?? 'MANGLER'})`);
}

console.log('\n===== FACIT =====');
console.log(`lokale filer:        ${toMigrate.length} (${(totalBytes / 1e6).toFixed(0)} MB)`);
console.log(`kopieret nu:         ${copied}`);
console.log(`sprunget over (lå der allerede, samme størrelse): ${skipped}`);
console.log(`bucket bekræfter byte-match: ${matched} af ${toMigrate.length}`);
if (failedFiles.length) console.log(`FEJLEDE: ${failedFiles.length}\n  ${failedFiles.slice(0, 10).join('\n  ')}`);
if (mismatched.length) console.log(`MISMATCH: ${mismatched.length}\n  ${mismatched.slice(0, 10).join('\n  ')}`);
console.log(`tid: ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(matched === toMigrate.length ? 0 : 1);
