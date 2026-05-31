/**
 * F188 verification — exercises the personal-API-key lifecycle end-to-end
 * through the REAL Hono handlers (keys.ts) AND the proxy's resolveApiKey
 * path, asserting observable DB effects against a throwaway control.db.
 *
 * Per CLAUDE.md "Verification before 'this works'": proves runtime
 * behaviour (create → list → use-via-proxy → revoke → 401), not just that
 * it typechecks.
 *
 * Run:  bun run apps/admin-server/scripts/verify-f188.ts
 */

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DB_PATH = join(tmpdir(), `verify-f188-${process.pid}-${Date.now()}.db`);
process.env.TRAIL_ADMIN_CONTROL_DB = DB_PATH;

const { db, schema, client } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');
const { apiKeyRoutes, hashApiKey } = await import('../src/keys.js');
const { Hono } = await import('hono');

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

const app = new Hono();
app.route('/api/control', apiKeyRoutes);

const ORG = 'org-verify';
const USER = 'u-verify';
const SESSION = 'sess-f188-123';
const COOKIE = `trail-session=${SESSION}`;
const ENGINE_BEARER = 'tenant-bearer-xyz';

async function seed() {
  await db.insert(schema.organizations).values({ id: ORG, slug: 'verify-org', name: 'Verify Org' });
  await db.insert(schema.controlTenants).values({
    id: 't-verify', organizationId: ORG, slug: 'verify-org', name: 'Verify Org', language: 'en',
  });
  await db.insert(schema.controlUsers).values({
    id: USER, organizationId: ORG, email: 'dev@verify.test', name: 'Dev', onboarded: true,
  });
  await db.insert(schema.sessions).values({
    id: SESSION, userId: USER, expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  });
  await db.insert(schema.tenantEngines).values({
    tenantId: 't-verify', engineId: 'engine-001',
    engineUrl: 'https://engine-001.trailmem.com',
    provisionedAt: new Date().toISOString(), bearer: ENGINE_BEARER,
  });
}

function post(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify(body),
  });
}
function get(path: string) {
  return app.request(path, { headers: { Cookie: COOKIE } });
}

async function run() {
  console.log(`[verify-f188] temp db: ${DB_PATH}`);
  await runMigrations();
  await seed();

  // 1) control_api_keys table present.
  const cols = await client.execute("PRAGMA table_info('control_api_keys')");
  const colNames = cols.rows.map((r) => (r as { name?: string }).name);
  console.log('\n1. control_api_keys table');
  assert(colNames.includes('prefix') && colNames.includes('key_hash'), 'has prefix + key_hash columns');

  // 2) POST create → raw key returned once.
  console.log('\n2. POST /api-keys');
  const r2 = await post('/api/control/api-keys', { name: 'CI pipeline' });
  const b2 = (await r2.json()) as { id?: string; key?: string; prefix?: string };
  assert(r2.status === 201, `returns 201 (got ${r2.status})`);
  assert(!!b2.key && b2.key.startsWith('trail_') && b2.key.length === 70, 'raw key is trail_<64hex>');
  assert(!!b2.prefix && b2.key!.startsWith(b2.prefix!), 'prefix is a leading slice of the raw key');
  const rawKey = b2.key!;
  const stored = await db.query.controlApiKeys.findFirst({
    where: (k, { eq }) => eq(k.id, b2.id!),
  });
  assert(stored?.keyHash === hashApiKey(rawKey), 'only the sha256 hash is stored (not the raw key)');
  assert(stored?.scope === 'full' && stored?.tenantId === 't-verify', 'scope=full, bound to active tenant');

  // 3) GET list — no hash/raw leaked.
  console.log('\n3. GET /api-keys');
  const r3 = await get('/api/control/api-keys');
  const b3 = (await r3.json()) as { keys: Array<Record<string, unknown>> };
  assert(b3.keys.length === 1, `1 key listed (got ${b3.keys.length})`);
  const listed = b3.keys[0]!;
  assert(!('keyHash' in listed) && !('key' in listed), 'list omits hash + raw key');
  assert('prefix' in listed && 'lastUsedAt' in listed, 'list includes prefix + lastUsedAt');

  // 4) Proxy resolveApiKey resolves the bearer → user + tenant + engine bearer,
  //    and stamps last_used_at.
  console.log('\n4. proxy.resolveApiKey (bearer auth)');
  const proxyMod = await import('../src/proxy.js');
  // resolveApiKey is module-private; exercise it via the exported proxy by
  // calling the same DB path it uses. We re-implement the lookup the proxy
  // does and assert the row + engine binding resolve, then confirm the
  // proxy stamps last_used_at by invoking proxyToEngine against a fake
  // engine. Simpler: drive proxyToEngine with a stub fetch.
  const realFetch = globalThis.fetch;
  let forwardedAuth: string | null = null;
  let forwardedUrl: string | null = null;
  // @ts-expect-error override for test
  globalThis.fetch = async (url: string, init: RequestInit) => {
    forwardedUrl = url.toString();
    forwardedAuth = new Headers(init.headers).get('authorization');
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const proxyApp = new Hono();
  proxyApp.use('*', proxyMod.proxyToEngine);
  const r4 = await proxyApp.request('/api/v1/knowledge-bases', {
    headers: { Authorization: `Bearer ${rawKey}` },
  });
  globalThis.fetch = realFetch;
  assert(r4.status === 200, `proxied request authorized via key (got ${r4.status})`);
  assert(forwardedAuth === `Bearer ${ENGINE_BEARER}`, 'proxy forwards the per-tenant engine bearer, not the personal key');
  assert(!!forwardedUrl && (forwardedUrl as string).includes('engine-001.trailmem.com'), 'routed to the key\'s bound engine');
  const afterUse = await db.query.controlApiKeys.findFirst({ where: (k, { eq }) => eq(k.id, b2.id!) });
  assert(!!afterUse?.lastUsedAt, 'last_used_at stamped after a proxied request');

  // 5) Revoke → next bearer request 401s.
  console.log('\n5. DELETE /api-keys/:id (revoke)');
  const r5 = await app.request(`/api/control/api-keys/${b2.id}`, {
    method: 'DELETE', headers: { Cookie: COOKIE },
  });
  assert(r5.status === 200, `revoke returns 200 (got ${r5.status})`);
  const revoked = await db.query.controlApiKeys.findFirst({ where: (k, { eq }) => eq(k.id, b2.id!) });
  assert(!!revoked?.revokedAt, 'revoked_at set');
  // Re-run the proxy with the now-revoked key → 401.
  const proxyApp2 = new Hono();
  proxyApp2.use('*', proxyMod.proxyToEngine);
  const r5b = await proxyApp2.request('/api/v1/knowledge-bases', {
    headers: { Authorization: `Bearer ${rawKey}` },
  });
  assert(r5b.status === 401, `revoked key → 401 at proxy (got ${r5b.status})`);
  // And it drops out of the list.
  const r5c = await get('/api/control/api-keys');
  const b5c = (await r5c.json()) as { keys: unknown[] };
  assert(b5c.keys.length === 0, 'revoked key removed from list');

  // 6) Auth guards.
  console.log('\n6. auth guards');
  const r6a = await app.request('/api/control/api-keys');
  assert(r6a.status === 401, `unauthenticated list → 401 (got ${r6a.status})`);
  const r6b = await post('/api/control/api-keys', {});
  assert(r6b.status === 400, `create without name → 400 (got ${r6b.status})`);
}

try {
  await run();
} finally {
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
