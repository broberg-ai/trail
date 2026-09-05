/**
 * F222.3 — generér pr.-tenant Ed25519-nøglepar + mint sqld-JWT.
 *
 * Kør LOKALT (aldrig på en maskine): bun apps/server/scripts/mint-sqld-token.ts <slug>
 *
 * Udskriver tre linjer:
 *   PUBKEY_B64URL=…   → DB-maskinens env  SQLD_JWT_KEY_<SLUG>  (offentlig — ikke hemmelig)
 *   TOKEN=…           → motorens secret   TRAIL_DB_TOKEN_<SLUG> (hemmelig)
 *   PRIVKEY_PEM (til cardmem Secrets Vault — hemmelig, bruges kun til at minte nye tokens)
 *
 * Tokenet har ingen udløbstid med vilje: det roteres ved at generere et nyt
 * nøglepar og skifte begge sider — én kilde, ét skift.
 */
const slug = process.argv[2];
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error('brug: bun mint-sqld-token.ts <tenant-slug>');
  process.exit(1);
}

const b64url = (b: Uint8Array) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })));
const payload = b64url(
  new TextEncoder().encode(JSON.stringify({ sub: slug, iat: Math.floor(Date.now() / 1000) })),
);
const signingInput = new TextEncoder().encode(`${header}.${payload}`);
const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, signingInput));
const token = `${header}.${payload}.${b64url(sig)}`;

const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8)
  .toString('base64')
  .match(/.{1,64}/g)!
  .join('\n')}\n-----END PRIVATE KEY-----`;

console.log(`PUBKEY_B64URL=${b64url(rawPub)}`);
console.log(`TOKEN=${token}`);
console.log(pem);
