/**
 * F230.1 runtime proof — the repair, against a real DB.
 *
 * The unit tests prove list() no longer emits a double slash. This proves the
 * REPAIR: broken rows become reachable, and an already-correct row comes out
 * untouched. The second half is the one that matters — a repair that rewrites
 * every row would pass a "0 broken afterwards" check while corrupting the rest.
 *
 * Run: bun run apps/server/scripts/verify-f230-slash-repair.ts
 */
import { existsSync, rmSync } from 'node:fs';

const DB = '/tmp/f230-verify.db';
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);

const { createLibsqlDatabase } = await import('@trail/db');
const trail = await createLibsqlDatabase({ path: DB });
await trail.runMigrations();

let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail++;
};

await trail.execute('PRAGMA foreign_keys = OFF');
const insert = async (id: string, filename: string, storagePath: string) =>
  trail.execute(
    `INSERT INTO document_images (id,document_id,tenant_id,knowledge_base_id,filename,storage_path,content_hash,size_bytes,width,height)
     VALUES ('${id}','doc1','t1','kb1','${filename}','${storagePath}','h',10,100,100)`,
  );

await insert('a', '/page-1-img-11.png', 't1/kb1/doc1/images//page-1-img-11.png');
await insert('b', '/page-14-img-1.png', 't1/kb1/doc1/images//page-14-img-1.png');
const GOOD_FILE = 'page-2-img-1.png';
const GOOD_PATH = 't1/kb1/doc1/images/page-2-img-1.png';
await insert('c', GOOD_FILE, GOOD_PATH);

const countBroken = async () =>
  Number(
    ((await trail.execute("SELECT COUNT(*) AS n FROM document_images WHERE filename LIKE '/%'"))
      .rows[0] as { n: number }).n,
  );
const row = async (id: string) =>
  (await trail.execute(`SELECT filename, storage_path AS sp FROM document_images WHERE id='${id}'`))
    .rows[0] as { filename: string; sp: string };

check('3 rows in, 2 of them broken', (await countBroken()) === 2);

// DRY first — it must change nothing. A dry run that quietly writes is worse
// than no dry run at all, because it is used precisely when you are unsure.
process.env.TRAIL_FIX_IMAGE_SLASH = '1';
process.env.TRAIL_FIX_IMAGE_SLASH_DRY = '1';
const { fixImageSlash } = await import('../src/bootstrap/fix-image-slash.js');
await fixImageSlash(trail);
check('DRY changed nothing — still 2 broken', (await countBroken()) === 2);

delete process.env.TRAIL_FIX_IMAGE_SLASH_DRY;
await fixImageSlash(trail);

check('0 broken rows afterwards', (await countBroken()) === 0);
const a = await row('a');
check('filename is normalised exactly', a.filename === 'page-1-img-11.png', a.filename);
check('storage path has no double slash', a.sp === 't1/kb1/doc1/images/page-1-img-11.png', a.sp);

// THE NEGATIVE CONTROL. Strict equality on both fields, printed on failure —
// "contains" would pass on a truncated or mangled value.
const c = await row('c');
check('NEGATIVE CONTROL — the healthy row is byte-identical', c.filename === GOOD_FILE && c.sp === GOOD_PATH, `${c.filename} | ${c.sp}`);

// Idempotence: a second run must be a no-op, not a second rewrite.
const before = JSON.stringify(await row('a'));
await fixImageSlash(trail);
check('running it twice changes nothing the second time', JSON.stringify(await row('a')) === before);

console.log(fail === 0 ? '\nALLE KONTROLLER BESTÅET' : `\n${fail} KONTROL(LER) FEJLEDE`);
process.exit(fail === 0 ? 0 : 1);
