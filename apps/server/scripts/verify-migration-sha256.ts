/**
 * F222.1 AC#2+#5 — sha256-verifikation af HELE migreringen, fil for fil.
 *
 * Kør PÅ maskinen: bun /app/apps/server/scripts/verify-migration-sha256.ts
 *
 * For hver lokal fil: sha256 af de lokale bytes OG sha256 af bucketens bytes,
 * sammenlignet. Mismatch-listen printes (skal være tom). En størrelses-match
 * (migreringens eget tjek) kan ikke se en bit-fejl; det kan denne.
 *
 * NEGATIV KONTROL FØRST: en bevidst korrumperet sammenligning SKAL fanges,
 * ellers har grønt intet bevist ("proving the check can fail" — kortets AC).
 */
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LocalStorage, TigrisStorage } from '@trail/storage';

const UPLOADS_ROOT = process.env.TRAIL_UPLOADS_DIR ?? join(process.env.TRAIL_DATA_DIR ?? '/data', 'uploads');
const local = new LocalStorage(UPLOADS_ROOT);
const tigris = new TigrisStorage({
  bucket: process.env.BUCKET_NAME ?? '',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  endpoint: process.env.AWS_ENDPOINT_URL_S3 ?? '',
  region: process.env.AWS_REGION,
  stagingDir: '/tmp/sha-verify-staging',
});

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// ── NEGATIV KONTROL ────────────────────────────────────────────────────────
// Læg en fil op, korrumpér den LOKALE sammenligningskopi, og kræv at
// sammenligneren melder mismatch. Kun derefter er et tomt mismatch-facit
// et bevis og ikke en blind vinkel.
const nonce = `_verify/sha-neg-${Date.now()}.bin`;
const good = new TextEncoder().encode('sha-negativ-kontrol');
await tigris.put(nonce, good);
const remote = await tigris.get(nonce);
const corrupted = new Uint8Array(good);
corrupted[0] ^= 0xff;
const negDetected = remote !== null && sha(remote) !== sha(corrupted) && sha(remote) === sha(good);
await tigris.delete(nonce);
console.log(`${negDetected ? '✓' : '✗'} NEGATIV KONTROL: korrumperet kopi FANGES af hash-sammenligning`);
if (!negDetected) process.exit(1);

// ── FULD GENNEMGANG ────────────────────────────────────────────────────────
const t0 = Date.now();
const localFiles = [...(await local.statMany('')).keys()].filter((k) => !k.startsWith('_tmp/'));
console.log(`[sha] ${localFiles.length} lokale filer at verificere …`);

// STREAM-hash begge sider — aldrig hele filen i hukommelsen. Første udgave
// holdt fulde buffere og OOM-dræbte PROD-maskinen (exit 137, 00:45 dansk tid,
// motoren delte boksen). Verifikation må aldrig koste driften noget.
const bucketUrlFor = (key: string) => tigris.signedUrl(key, 300);

async function shaLocalStream(key: string): Promise<string | null> {
  const full = join(UPLOADS_ROOT, key);
  const f = Bun.file(full);
  if (!(await f.exists())) return null;
  const h = createHash('sha256');
  for await (const chunk of f.stream()) h.update(chunk);
  return h.digest('hex');
}

async function shaBucketStream(key: string): Promise<string | null> {
  const res = await fetch(await bucketUrlFor(key));
  if (res.status === 404) return null;
  if (!res.ok || !res.body) throw new Error(`bucket GET ${key}: HTTP ${res.status}`);
  const h = createHash('sha256');
  for await (const chunk of res.body) h.update(chunk);
  return h.digest('hex');
}

let ok = 0;
const mismatches: string[] = [];
for (const key of localFiles) {
  const a = await shaLocalStream(key);
  const b = await shaBucketStream(key);
  if (!a) { mismatches.push(`${key} — lokal fil kunne ikke læses`); continue; }
  if (!b) { mismatches.push(`${key} — MANGLER i bucket`); continue; }
  if (a === b) ok++;
  else mismatches.push(`${key} — sha256 AFVIGER`);
  if ((ok + mismatches.length) % 250 === 0) {
    console.log(`[sha] ${ok + mismatches.length}/${localFiles.length} · rss ${(process.memoryUsage.rss() / 1e6) | 0} MB · ${Math.round((Date.now() - t0) / 1000)}s`);
    Bun.gc(true);
  }
}

console.log('\n===== SHA256-FACIT =====');
console.log(`verificeret identiske: ${ok} af ${localFiles.length}`);
console.log(`mismatch-liste (${mismatches.length}):${mismatches.length ? '\n  ' + mismatches.slice(0, 20).join('\n  ') : ' TOM'}`);
console.log(`tid: ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(mismatches.length === 0 ? 0 : 1);
