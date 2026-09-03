/**
 * F229.2 runtime proof — OCR reaches the database AND the search index.
 *
 * Three separate claims, because two of them can be true while the third is
 * false and the difference is invisible from the UI:
 *   1. Mistral OCR reads Danish text out of a real image, in the EU.
 *   2. The text lands in document_images.ocr_text.
 *   3. A search for a word that appears ONLY in the OCR text finds the image.
 *
 * Claim 3 is the one that matters to a curator, and it is the one a passing
 * write-test would not have caught: the row can hold the text while the FTS
 * trigger never fired.
 *
 * Needs MISTRAL_API_KEY. Run:
 *   set -a; source .env; set +a
 *   bun run apps/server/scripts/verify-f229-2-ocr.ts
 */
import { existsSync, rmSync } from 'node:fs';
import sharp from 'sharp';

const DB = '/tmp/f229-2-verify.db';
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);

const { createLibsqlDatabase } = await import('@trail/db');
const { ocrImage } = await import('../src/services/vision.js');

let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail++;
};

// A word that exists ONLY inside the picture. If search finds it, the text
// came out of the image — it cannot have leaked in from a filename or a path.
const NONCE = `zonemarkoer${Math.floor(Math.random() * 1e6)}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="240">
<rect width="100%" height="100%" fill="white"/>
<text x="40" y="80" font-family="Helvetica" font-size="40" fill="black">Zoneterapi: 60 min</text>
<text x="40" y="140" font-family="Helvetica" font-size="40" fill="black">Pris 550 kr.</text>
<text x="40" y="200" font-family="Helvetica" font-size="34" fill="black">${NONCE}</text></svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();

console.log('── 1. OCR selv ──');
const r = await ocrImage(new Uint8Array(png), 'image/png');
check('OCR svarede', r !== null);
if (!r) process.exit(1);
check('den danske tekst blev læst', (r.text ?? '').includes('Zoneterapi'), JSON.stringify(r.text));
check('nonce-ordet blev læst', (r.text ?? '').toLowerCase().includes(NONCE), NONCE);
check('modellen er Mistrals OCR', r.model.includes('mistral-ocr'), r.model);

// "No text" must be null, not an empty string: a later reader cannot tell an
// empty string from "OCR never ran", and that is the distinction the whole
// column exists to carry.
const blank = await sharp({
  create: { width: 300, height: 300, channels: 3, background: { r: 200, g: 220, b: 235 } },
}).png().toBuffer();
const blankOcr = await ocrImage(new Uint8Array(blank), 'image/png');
check('et billede UDEN tekst giver null, ikke tom streng', blankOcr !== null && blankOcr.text === null, JSON.stringify(blankOcr?.text));

console.log('\n── 2. teksten når databasen ──');
const trail = await createLibsqlDatabase({ path: DB });
await trail.runMigrations();
const col = await trail.execute(
  "SELECT name FROM pragma_table_info('document_images') WHERE name IN ('ocr_text','ocr_model','ocr_at')",
);
check('de tre ocr-kolonner findes', col.rows.length === 3, JSON.stringify(col.rows.map((x) => (x as { name: string }).name)));
const ftsExists = await trail.execute(
  "SELECT name FROM sqlite_master WHERE name = 'document_images_ocr_fts'",
);
check('ocr-søgeindekset findes', ftsExists.rows.length === 1);

await trail.execute('PRAGMA foreign_keys = OFF');
await trail.execute(
  `INSERT INTO document_images (id,document_id,tenant_id,knowledge_base_id,filename,storage_path,content_hash,size_bytes,width,height,vision_description,ocr_text,ocr_model,ocr_at)
   VALUES ('img1','doc1','t1','kb1','p.png','t1/kb1/doc1/images/p.png','h',10,820,240,'en prisliste',?, ?, datetime('now'))`,
  [r.text ?? '', r.model],
);
const back = (await trail.execute("SELECT ocr_text AS v FROM document_images WHERE id='img1'"))
  .rows[0] as { v: string };
check('ocr_text læses tilbage ordret', back.v === r.text, `${back.v.length} tegn`);

console.log('\n── 3. teksten kan SØGES (det der tæller) ──');
const hit = await trail.execute(
  `SELECT di.id FROM document_images_ocr_fts fts
     JOIN document_images di ON di.rowid = fts.rowid
    WHERE fts.ocr_text MATCH ?`,
  [`"${NONCE}"*`],
);
check('et ord der KUN står i billedet findes via søgning', hit.rows.length === 1, `${hit.rows.length} træf`);

// NEGATIVE CONTROL — the index must not answer for a word nobody wrote.
const miss = await trail.execute(
  `SELECT di.id FROM document_images_ocr_fts fts
     JOIN document_images di ON di.rowid = fts.rowid
    WHERE fts.ocr_text MATCH ?`,
  ['"ordetderikkefindes"*'],
);
check('NEGATIV KONTROL — et ord der ikke står der giver 0 træf', miss.rows.length === 0);

// And the description index must still work — the new table must not have
// displaced the old one.
const desc = await trail.execute(
  `SELECT di.id FROM document_images_fts fts
     JOIN document_images di ON di.rowid = fts.rowid
    WHERE fts.vision_description MATCH ?`,
  ['"prisliste"*'],
);
check('beskrivelses-indekset virker stadig', desc.rows.length === 1);

console.log(fail === 0 ? '\nALLE KONTROLLER BESTÅET' : `\n${fail} KONTROL(LER) FEJLEDE`);
process.exit(fail === 0 ? 0 : 1);
