/**
 * F229.1 runtime proof — the entropy gate, end to end.
 *
 * The unit tests prove the RULE. This proves the CHAIN: a real solid-colour
 * PNG goes through the same persistImagesFromExtraction the uploader calls, and
 * afterwards there is (a) no row, and (b) NO BYTES ON DISK. The second half is
 * the one that would otherwise pass unnoticed — F226 skipped the row and left
 * the file, so a filtered image was hidden rather than discarded, and every
 * count looked right.
 *
 * TRAIL_UPLOADS_DIR is set BEFORE the import that reads it, because
 * lib/storage.ts binds the root at module load.
 *
 * Run: bun run apps/server/scripts/verify-f229-gate.ts
 */
import { existsSync, rmSync } from 'node:fs';

const DB = '/tmp/f229-verify.db';
const UPLOADS = '/tmp/f229-verify-uploads';
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
if (existsSync(UPLOADS)) rmSync(UPLOADS, { recursive: true });
process.env.TRAIL_UPLOADS_DIR = UPLOADS;

const { createLibsqlDatabase } = await import('@trail/db');
const sharp = (await import('sharp')).default;
const { storage } = await import('../src/lib/storage.js');
const { persistImagesFromExtraction } = await import('../src/services/document-images.js');

let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail++;
};

const trail = await createLibsqlDatabase({ path: DB });
await trail.runMigrations();

// 1. The migration is RECORDED — and separately, the DDL LANDED. Drizzle
//    writing a hash is not the same fact as the column existing.
const col = await trail.execute(
  "SELECT name, type FROM pragma_table_info('knowledge_bases') WHERE name = 'min_image_entropy'",
);
check('column min_image_entropy exists on knowledge_bases', col.rows.length === 1, JSON.stringify(col.rows));
check(
  'it is REAL, not INTEGER — thresholds live between 0 and 1',
  String((col.rows[0] as { type?: string } | undefined)?.type ?? '').toUpperCase() === 'REAL',
);

await trail.execute('PRAGMA foreign_keys = OFF');
await trail.execute(
  "INSERT INTO knowledge_bases (id,tenant_id,created_by,name,slug,language,lint_policy,contradiction_lint_enabled,track_access) VALUES ('kb1','t1','u1','KB','kb','da','trusting',1,1)",
);
const readBack = async () =>
  ((await trail.execute("SELECT min_image_entropy AS v FROM knowledge_bases WHERE id='kb1'"))
    .rows[0] as { v: number | null }).v;

check('a new Trail starts with NO gate (NULL)', (await readBack()) === null);
await trail.execute("UPDATE knowledge_bases SET min_image_entropy = 0.5 WHERE id='kb1'");
check('0.5 round-trips through the column', Number(await readBack()) === 0.5);
await trail.execute("UPDATE knowledge_bases SET min_image_entropy = NULL WHERE id='kb1'");
check('NEGATIVE CONTROL — it clears back to NULL', (await readBack()) === null);

// 2. Two real images through the REAL persist path.
const blob = await sharp({
  create: { width: 416, height: 439, channels: 3, background: { r: 173, g: 216, b: 230 } },
}).png().toBuffer();

const w = 200, h = 200;
const raw = Buffer.alloc(w * h * 3);
let x = 123456789;
for (let i = 0; i < raw.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; raw[i] = x % 256; }
const real = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();

const BLOB_PATH = 't1/kb1/doc1/images/blob.png';
const REAL_PATH = 't1/kb1/doc1/images/real.png';

async function run(minEntropy: number | null) {
  await storage.put(BLOB_PATH, blob, 'image/png');
  await storage.put(REAL_PATH, real, 'image/png');
  return persistImagesFromExtraction(
    trail,
    'doc1',
    't1',
    'kb1',
    [
      { filename: 'blob.png', storagePath: BLOB_PATH, page: 1, width: 416, height: 439 },
      { filename: 'real.png', storagePath: REAL_PATH, page: 1, width: w, height: h },
    ],
    null,
    null,
    minEntropy,
  );
}

console.log('\n── gate ARMED at 0.5 ──');
const armed = await run(0.5);
check('exactly one image was discarded as blank', armed.filteredBlank === 1, JSON.stringify(armed));
check('exactly one image was kept', armed.inserted === 1);
check('nothing was counted as "could not read" — a distinct fact', armed.skipped === 0);

const rows = await trail.execute("SELECT filename FROM document_images WHERE document_id='doc1'");
const names = rows.rows.map((r) => (r as { filename: string }).filename);
check('the blob has NO row', !names.includes('blob.png'), JSON.stringify(names));
check('the real image HAS a row — negative control', names.includes('real.png'));

// THE HALF THAT WOULD OTHERWISE PASS UNSEEN.
check('the blob BYTES are gone from storage', (await storage.get(BLOB_PATH)) === null);
check('the real image BYTES are still there', (await storage.get(REAL_PATH)) !== null);

console.log('\n── gate OFF (null) — behaviour must be unchanged ──');
const off = await run(null);
check('nothing is discarded when the gate is off', off.filteredBlank === 0, JSON.stringify(off));
check('BOTH images are stored', off.inserted === 2);
check('the blob bytes SURVIVE when the gate is off', (await storage.get(BLOB_PATH)) !== null);

console.log('\n── F226 orphan bytes, now also deleted ──');
await storage.put(BLOB_PATH, blob, 'image/png');
await storage.put(REAL_PATH, real, 'image/png');
const small = await persistImagesFromExtraction(
  trail, 'doc1', 't1', 'kb1',
  [{ filename: 'blob.png', storagePath: BLOB_PATH, page: 1, width: 10, height: 10 }],
  null,
  64,
  null,
);
check('the too-small image is filtered', small.filteredSmall === 1, JSON.stringify(small));
check('and ITS bytes are gone too — F226 used to leave them', (await storage.get(BLOB_PATH)) === null);

console.log(fail === 0 ? '\nALLE KONTROLLER BESTÅET' : `\n${fail} KONTROL(LER) FEJLEDE`);
process.exit(fail === 0 ? 0 : 1);
