/**
 * F222.1 — runtime proof that TigrisStorage works against the REAL bucket.
 * Run ON the engine machine (creds live there):
 *   bun /app/apps/server/scripts/verify-tigris.ts
 *
 * Round-trips every verb the seam promises, with a unique key so a stale
 * object can never fake a pass, and a NEGATIVE control (missing key → null,
 * exists → false) so "green" cannot mean "we never looked".
 */
import { TigrisStorage } from '@trail/storage';

const cfg = {
  bucket: process.env.BUCKET_NAME ?? '',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  endpoint: process.env.AWS_ENDPOINT_URL_S3 ?? '',
  region: process.env.AWS_REGION,
  stagingDir: '/tmp/tigris-verify-staging',
};
const s = new TigrisStorage(cfg);

const nonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const key = `_verify/${nonce}/probe.bin`;
const payload = new TextEncoder().encode(`tigris-verify ${nonce}`);

let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

// negative controls FIRST — on a key that cannot exist
check('negativ: get(missing) → null', (await s.get(`_verify/${nonce}/never.bin`)) === null);
check('negativ: exists(missing) → false', (await s.exists(`_verify/${nonce}/never.bin`)) === false);

await s.put(key, payload, 'application/octet-stream');
const back = await s.get(key);
check(
  'put → get runder de SAMME bytes',
  back !== null && Buffer.compare(Buffer.from(back), Buffer.from(payload)) === 0,
  `${back?.length ?? 0} bytes`,
);
check('exists → true', await s.exists(key));

const listed = await s.list(`_verify/${nonce}`);
check('list finder nøglen', listed.length === 1 && listed[0] === key, JSON.stringify(listed));

const sizes = await s.statMany(`_verify/${nonce}`);
check('statMany: korrekt byte-størrelse', sizes.get(key) === payload.length, `${sizes.get(key)}`);

const url = await s.signedUrl(key, 60);
const res = await fetch(url);
const viaUrl = new Uint8Array(await res.arrayBuffer());
check(
  'signedUrl kan hentes af en ANONYM klient og giver samme bytes',
  res.ok && Buffer.compare(Buffer.from(viaUrl), Buffer.from(payload)) === 0,
  `HTTP ${res.status}`,
);

// staging → finalize path
await s.appendChunk(`stage-${nonce}.partial`, 0, payload.subarray(0, 10));
await s.appendChunk(`stage-${nonce}.partial`, 10, payload.subarray(10));
await s.finalize(`stage-${nonce}.partial`, `_verify/${nonce}/finalized.bin`);
const fin = await s.get(`_verify/${nonce}/finalized.bin`);
check(
  'appendChunk×2 → finalize → samme bytes i bucket',
  fin !== null && Buffer.compare(Buffer.from(fin), Buffer.from(payload)) === 0,
);

await s.delete(key);
await s.delete(`_verify/${nonce}/finalized.bin`);
check('delete: get → null bagefter', (await s.get(key)) === null);
await s.delete(key); // idempotent — må ikke kaste
check('delete er idempotent', true);

console.log(failed === 0 ? `\nALLE GRØNNE (bucket: ${cfg.bucket})` : `\n${failed} RØDE`);
process.exit(failed === 0 ? 0 : 1);
