/**
 * F215.4 proof — an explicitly presented API key wins over an ambient browser
 * cookie, so the Web Clipper's tenant picker actually selects a tenant.
 *
 * The defect, reported by the owner in the running product: "Uanset hvilken
 * Tenant jeg vælger så defaulter den til Sanne Andersen trail."
 *
 * The proxy resolved `resolveSession(c) ?? resolveApiKey(c)`. A Chrome
 * extension with host_permissions sends the signed-in user's cookies, so every
 * Clipper call carried BOTH credentials and the cookie won — and the cookie
 * path takes its tenant from `trail-active-tenant`, never from X-Trail-Tenant.
 * Measured on prod: the freshly minted key showed last_used_at = null while the
 * popup was busily listing Trails.
 *
 * This drives the REAL proxy against a REAL upstream (a throwaway Bun server
 * standing in for the engine) and asserts on WHICH ENGINE BEARER ARRIVED — the
 * only fact that says where a clip would have been stored. Asserting on a
 * status code would have stayed green through the entire bug.
 *
 * Run from apps/admin-server:  bun run scripts/verify-f215-4.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(process.env.TMPDIR ?? '/tmp', `f2154-${process.env.USER ?? 'x'}.db`);
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f, { force: true }); } catch { /* first run */ } }
process.env.TRAIL_ADMIN_CONTROL_DB = DB;
process.env.NODE_ENV = 'test';

const { db, schema } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');
const { hashApiKey } = await import('../src/keys.js');
const { proxyToEngine } = await import('../src/proxy.js');
const { generateKey } = await import('@broberg/apikey');
const { Hono } = await import('hono');
const { eq } = await import('drizzle-orm');

await runMigrations();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// A stand-in engine that reports the bearer it was handed. Which tenant's
// bearer arrives IS the routing decision — nothing else in the response is.
const engine = Bun.serve({
  port: 0,
  fetch(req) {
    const auth = req.headers.get('authorization') ?? '';
    return Response.json({
      bearer: auth.replace(/^Bearer\s+/i, ''),
      sawTenantHeader: req.headers.get('x-trail-tenant'),
    });
  },
});
const ENGINE_URL = `http://127.0.0.1:${engine.port}`;

const now = new Date().toISOString();
await db.insert(schema.organizations).values({ id: 'org1', name: 'Broberg', slug: 'broberg-ai', createdAt: now }).run();
for (const [id, slug, name] of [
  ['t-sanne', 'sanne-andersen', 'Sanne Andersen'],
  ['t-broberg', 'broberg-ai', 'Broberg.ai'],
  ['t-fd', 'fd-aalborg', 'FD Aalborg'],
  ['t-fremmed', 'ikke-mit', 'Ikke Mit'],
] as const) {
  await db.insert(schema.controlTenants).values({ id, organizationId: 'org1', slug, name, language: 'da', createdAt: now }).run();
}
// One distinct engine bearer per tenant — exactly the prod shape (all three
// point at the same machine; the bearer is what tells the engine who is asking).
const BEARER: Record<string, string> = {
  't-sanne': 'engine_sanne', 't-broberg': 'engine_broberg',
  't-fd': 'engine_fd', 't-fremmed': 'engine_fremmed',
};
for (const [tenantId, bearer] of Object.entries(BEARER)) {
  await db.insert(schema.tenantEngines).values({
    tenantId, engineId: 'e1', engineUrl: ENGINE_URL, provisionedAt: now, bearer,
  }).run();
}
await db.insert(schema.controlUsers).values({ id: 'u-cb', organizationId: 'org1', email: 'cb@webhouse.dk', name: 'CB', onboarded: true, createdAt: now }).run();
for (const t of ['t-sanne', 't-broberg', 't-fd']) {
  await db.insert(schema.controlMemberships).values({ userId: 'u-cb', tenantId: t, role: 'owner', createdAt: now }).run();
}
await db.insert(schema.sessions).values({
  id: 'sess-cb', userId: 'u-cb',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: now,
}).run();

// The key is homed on SANNE, like the one the owner actually minted — so
// "the header worked" and "it fell back to home" give different answers.
const keyAll = generateKey('trail');
const keyNarrow = generateKey('trail');
const keyRevoked = generateKey('trail');
await db.insert(schema.controlApiKeys).values([
  { id: 'k-all', tenantId: 't-sanne', userId: 'u-cb', name: 'Web Clipper', prefix: keyAll.slice(0, 12), keyHash: hashApiKey(keyAll), scope: 'all', createdAt: now },
  { id: 'k-narrow', tenantId: 't-sanne', userId: 'u-cb', name: 'smal', prefix: keyNarrow.slice(0, 12), keyHash: hashApiKey(keyNarrow), scope: 'full', createdAt: now },
  { id: 'k-revoked', tenantId: 't-sanne', userId: 'u-cb', name: 'tilbagekaldt', prefix: keyRevoked.slice(0, 12), keyHash: hashApiKey(keyRevoked), scope: 'all', createdAt: now, revokedAt: now },
]).run();

const app = new Hono();
app.use('/api/v1/*', proxyToEngine);

/** Ask the proxy where this request would have gone. */
async function routeOf(headers: Record<string, string>) {
  const res = await app.request('http://admin.local/api/v1/knowledge-bases', { headers });
  if (!res.ok) return { status: res.status, bearer: null as string | null };
  const body = (await res.json()) as { bearer: string };
  return { status: res.status, bearer: body.bearer };
}
const COOKIE_SANNE = 'trail-session=sess-cb; trail-active-tenant=sanne-andersen';

// ── AC1 — the key wins, and the header is what selects ─────────────────────
// THE BUG, stated as a measurement: cookie says Sanne, header says Broberg.
const both = await routeOf({
  Cookie: COOKIE_SANNE,
  Authorization: `Bearer ${keyAll}`,
  'X-Trail-Tenant': 'broberg-ai',
});
check(
  'cookie(Sanne) + key + header(Broberg) → routed to BROBERG',
  both.bearer === 'engine_broberg',
  `landede hos ${JSON.stringify(both.bearer)}, cookien pegede på engine_sanne`,
);
// A second target, so "it always picks broberg" cannot pass.
const toFd = await routeOf({
  Cookie: COOKIE_SANNE,
  Authorization: `Bearer ${keyAll}`,
  'X-Trail-Tenant': 'fd-aalborg',
});
check(
  '…and switching the header again moves it again — to FD Aalborg',
  toFd.bearer === 'engine_fd',
  JSON.stringify(toFd.bearer),
);
// No header + key: the key's HOME, not the cookie's tenant. They differ here
// only if home === sanne, which it does — so this one is deliberately weak on
// its own and strong beside the two above.
const keyNoHeader = await routeOf({ Cookie: 'trail-session=sess-cb; trail-active-tenant=broberg-ai', Authorization: `Bearer ${keyAll}` });
check(
  'key with NO header ignores the cookie’s tenant and uses the key’s home',
  keyNoHeader.bearer === 'engine_sanne',
  `cookien sagde broberg-ai, nøglens hjem er sanne-andersen → ${JSON.stringify(keyNoHeader.bearer)}`,
);

// ── AC2 — a dead key is a 401, never a demotion to the cookie ──────────────
const revoked = await routeOf({ Cookie: COOKIE_SANNE, Authorization: `Bearer ${keyRevoked}` });
check(
  'a REVOKED key + a valid cookie → 401, not a silent fallback to the cookie',
  revoked.status === 401,
  `status ${revoked.status}, bearer ${JSON.stringify(revoked.bearer)}`,
);
const bogus = await routeOf({ Cookie: COOKIE_SANNE, Authorization: 'Bearer trail_ikkeenrigtignoegle' });
check(
  'an UNKNOWN trail_ key + a valid cookie → 401',
  bogus.status === 401,
  `status ${bogus.status}, bearer ${JSON.stringify(bogus.bearer)}`,
);

// ── AC3 — the cookie-only path is untouched ────────────────────────────────
const cookieOnly = await routeOf({ Cookie: COOKIE_SANNE });
check(
  'cookie alone still routes by trail-active-tenant',
  cookieOnly.bearer === 'engine_sanne',
  JSON.stringify(cookieOnly.bearer),
);
const cookieOtherTenant = await routeOf({ Cookie: 'trail-session=sess-cb; trail-active-tenant=fd-aalborg' });
check(
  '…and follows that cookie when it names a different tenant',
  cookieOtherTenant.bearer === 'engine_fd',
  JSON.stringify(cookieOtherTenant.bearer),
);
// The fallback is "first membership row", and that is PRIMARY-KEY order
// (user_id, tenant_id) — NOT insertion order. My first draft asserted
// engine_sanne because sanne was inserted first, and went red on engine_broberg.
// The honest properties are: it lands inside the membership set, it is stable,
// and this card did not move it — so that is what is asserted.
const cookieNoActive = await routeOf({ Cookie: 'trail-session=sess-cb' });
const cookieNoActiveAgain = await routeOf({ Cookie: 'trail-session=sess-cb' });
check(
  'no active-tenant cookie → falls back inside the membership set, deterministically',
  ['engine_sanne', 'engine_broberg', 'engine_fd'].includes(cookieNoActive.bearer ?? '')
    && cookieNoActive.bearer === cookieNoActiveAgain.bearer,
  `${JSON.stringify(cookieNoActive.bearer)} (PK-orden, ikke indsaettelsesorden)`,
);
// The property THIS card could have broken: the cookie path must answer the
// same whether or not a foreign Authorization header rides along.
const cookieNoActiveForeign = await routeOf({ Cookie: 'trail-session=sess-cb', Authorization: 'Bearer ghp_x' });
check(
  '...and that fallback is unaffected by a foreign Authorization header',
  cookieNoActiveForeign.bearer === cookieNoActive.bearer,
  `uden ${JSON.stringify(cookieNoActive.bearer)} - med ${JSON.stringify(cookieNoActiveForeign.bearer)}`,
);
const cookieForged = await routeOf({ Cookie: 'trail-session=sess-cb; trail-active-tenant=ikke-mit' });
check(
  'a cookie naming a tenant the user does not belong to cannot escape the membership set',
  cookieForged.bearer !== 'engine_fremmed',
  JSON.stringify(cookieForged.bearer),
);

// ── AC4 — a foreign Authorization must not hijack the session path ─────────
const foreign = await routeOf({ Cookie: COOKIE_SANNE, Authorization: 'Bearer ghp_someothertoken' });
check(
  'a non-trail_ bearer leaves the cookie path alone',
  foreign.bearer === 'engine_sanne',
  `status ${foreign.status}, bearer ${JSON.stringify(foreign.bearer)}`,
);
const basic = await routeOf({ Cookie: COOKIE_SANNE, Authorization: 'Basic trail_looksliketrail' });
check(
  'a non-bearer scheme does too, even when the value looks like a key',
  basic.bearer === 'engine_sanne',
  JSON.stringify(basic.bearer),
);

// ── AC5 — selector, not grant, still holds on the key path ─────────────────
const notMember = await routeOf({ Authorization: `Bearer ${keyAll}`, 'X-Trail-Tenant': 'ikke-mit' });
check(
  'a key asking for a tenant its user never joined → 401, not a fallback',
  notMember.status === 401,
  `status ${notMember.status}, bearer ${JSON.stringify(notMember.bearer)}`,
);
const narrowTriesHeader = await routeOf({ Authorization: `Bearer ${keyNarrow}`, 'X-Trail-Tenant': 'broberg-ai' });
check(
  'a scope=full key cannot use the header to leave its home',
  narrowTriesHeader.bearer === 'engine_sanne',
  JSON.stringify(narrowTriesHeader.bearer),
);
const nothing = await routeOf({});
check('no credentials at all → 401', nothing.status === 401, `status ${nothing.status}`);

// ── AC6 — the key is now actually USED (last_used_at stamped) ──────────────
// The fact that exposed the bug: a key that lists Trails but was never used.
await new Promise((r) => setTimeout(r, 50)); // the stamp is best-effort/async
const stamped = await db.query.controlApiKeys.findFirst({ where: eq(schema.controlApiKeys.id, 'k-all') });
check(
  'the key that served the request has last_used_at stamped — the tell that was null on prod',
  !!stamped?.lastUsedAt,
  JSON.stringify(stamped?.lastUsedAt),
);

engine.stop(true);
console.log(`\n${fail === 0 ? '✓ ALLE' : '✗'} ${pass} bestået, ${fail} fejlet`);
process.exit(fail === 0 ? 0 : 1);
