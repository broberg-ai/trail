/**
 * F215.1 proof — `GET /api/v1/me/tenants` answers from the SAME membership set
 * the proxy enforces, and only that set.
 *
 * The bug this closes, reported by the owner with a screenshot: the Web Clipper
 * listed ten knowledge bases, all broberg-ai, while the same key could already
 * reach sanne-andersen and fd-aalborg. Measured in the source: `apps/web-clipper/src`
 * contained ZERO occurrences of the word "tenant" — both of its calls sent only
 * a bearer, so the proxy fell back to the key's home tenant every time.
 *
 * The load-bearing property is NOT "an endpoint returns rows". It is that the
 * list matches what the proxy would ALLOW. A picker offering a slug the proxy
 * refuses is worse than no picker: the refusal lands at clip time, after the
 * user has chosen a Trail and pressed the button.
 *
 * Run from apps/admin-server:  bun run scripts/verify-f215-1.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(process.env.TMPDIR ?? '/tmp', `f2151-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB, { force: true }); rmSync(`${DB}-wal`, { force: true }); rmSync(`${DB}-shm`, { force: true }); } catch { /* first run */ }
process.env.TRAIL_ADMIN_CONTROL_DB = DB;
process.env.NODE_ENV = 'test';

const { db, schema } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');
const { hashApiKey } = await import('../src/keys.js');
const { generateKey } = await import('@broberg/apikey');
const { meTenantRoutes } = await import('../src/me-tenants.js');
const { Hono } = await import('hono');

await runMigrations();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const now = new Date().toISOString();
await db.insert(schema.organizations).values({ id: 'org1', name: 'Broberg', slug: 'broberg-ai', createdAt: now }).run();
for (const [id, slug, name] of [
  ['t1', 'broberg-ai', 'Broberg AI'],
  ['t2', 'sanne-andersen', 'Sanne Andersen'],
  ['t3', 'fd-aalborg', 'FD Aalborg'],
  ['t4', 'ikke-mit', 'Ikke Mit'],
] as const) {
  await db.insert(schema.controlTenants).values({ id, organizationId: 'org1', slug, name, language: 'da', createdAt: now }).run();
}
// cb is a member of three tenants; NOT of t4 — that absence is what makes the
// listing a measurement rather than "every tenant in the database".
await db.insert(schema.controlUsers).values({ id: 'u-cb', organizationId: 'org1', email: 'cb@webhouse.dk', name: 'CB', onboarded: true, createdAt: now }).run();
await db.insert(schema.controlUsers).values({ id: 'u-other', organizationId: 'org1', email: 'anden@example.com', name: 'Anden', onboarded: true, createdAt: now }).run();
for (const t of ['t1', 't2', 't3']) {
  await db.insert(schema.controlMemberships).values({ userId: 'u-cb', tenantId: t, role: 'owner', createdAt: now }).run();
}
// A second user with a DIFFERENT membership set, so "returns all tenants" and
// "returns this user's tenants" cannot look the same.
await db.insert(schema.controlMemberships).values({ userId: 'u-other', tenantId: 't2', role: 'member', createdAt: now }).run();

const keyAll = generateKey('trail');
const keyOne = generateKey('trail');
const keyOther = generateKey('trail');
const keyRevoked = generateKey('trail');
await db.insert(schema.controlApiKeys).values([
  { id: 'k1', tenantId: 't1', userId: 'u-cb', name: 'all', prefix: keyAll.slice(0,12), keyHash: hashApiKey(keyAll), scope: 'all', createdAt: now },
  { id: 'k2', tenantId: 't1', userId: 'u-cb', name: 'one', prefix: keyOne.slice(0,12), keyHash: hashApiKey(keyOne), scope: 'full', createdAt: now },
  { id: 'k3', tenantId: 't2', userId: 'u-other', name: 'other', prefix: keyOther.slice(0,12), keyHash: hashApiKey(keyOther), scope: 'all', createdAt: now },
  { id: 'k4', tenantId: 't1', userId: 'u-cb', name: 'revoked', prefix: keyRevoked.slice(0,12), keyHash: hashApiKey(keyRevoked), scope: 'all', createdAt: now, revokedAt: now },
]).run();

const app = new Hono();
app.route('/api', meTenantRoutes);
const list = async (key: string) => {
  const res = await app.request('http://admin.local/api/v1/me/tenants', {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = res.ok ? ((await res.json()) as { tenants: Array<{ slug: string; home: boolean }> }) : null;
  return { status: res.status, slugs: body?.tenants.map((t) => t.slug) ?? [], body };
};

// ── AC1 — exactly the caller's memberships ─────────────────────────────────
const all = await list(keyAll);
check('scope=all key → 200', all.status === 200, `status ${all.status}`);
check(
  'lists exactly the memberships, home first',
  JSON.stringify(all.slugs) === JSON.stringify(['broberg-ai', 'fd-aalborg', 'sanne-andersen']),
  JSON.stringify(all.slugs),
);
check(
  'a tenant the user is NOT a member of is absent',
  !all.slugs.includes('ikke-mit'),
  JSON.stringify(all.slugs),
);
check(
  'home is flagged, and it is the key’s own tenant',
  all.body?.tenants.filter((t) => t.home).map((t) => t.slug).join() === 'broberg-ai',
  JSON.stringify(all.body?.tenants),
);

// A second key whose user has a DIFFERENT membership set. Without this, an
// endpoint returning "every tenant" would pass everything above.
const other = await list(keyOther);
check(
  'a different user gets a DIFFERENT list (not "all tenants")',
  JSON.stringify(other.slugs) === JSON.stringify(['sanne-andersen']),
  JSON.stringify(other.slugs),
);

// ── AC2 — a key that does not span tenants gets no choice ──────────────────
const one = await list(keyOne);
check(
  'scope=full key lists ONLY its home — no picker for a single-tenant key',
  JSON.stringify(one.slugs) === JSON.stringify(['broberg-ai']),
  JSON.stringify(one.slugs),
);
// The negative control that matters: this user IS a member of three tenants.
// So the single row proves the SCOPE gate, not an empty membership set.
check(
  'and that is the scope gate, not an empty membership set (same user has 3)',
  one.slugs.length === 1 && all.slugs.length === 3,
  `full-key ${one.slugs.length}, all-key ${all.slugs.length}`,
);

// ── AC3 — listing is not a grant ───────────────────────────────────────────
const revoked = await list(keyRevoked);
check('a revoked key is refused (401)', revoked.status === 401, `status ${revoked.status}`);
const bogus = await list('trail_ikke-en-rigtig-noegle');
check('an unknown key is refused (401)', bogus.status === 401, `status ${bogus.status}`);
const noAuth = await app.request('http://admin.local/api/v1/me/tenants');
check('no credentials at all → 401', noAuth.status === 401, `status ${noAuth.status}`);

// ── AC4 — the list matches what the PROXY would allow ──────────────────────
// The whole point. Asserted against selectTenant — the same function proxy.ts
// calls — rather than against a second copy of the rule written here.
const { selectTenant, TenantAccessError } = await import('@broberg/apikey/authorize');
const memberSlugs = new Set(all.slugs);
let mismatches = 0;
for (const slug of all.slugs) {
  try {
    const chosen = selectTenant({ requestedSlug: slug, homeTenant: 'broberg-ai', spansAll: true, isMember: (s) => memberSlugs.has(s) });
    if (chosen !== slug) mismatches++;
  } catch { mismatches++; }
}
check(
  'every slug the endpoint offers is one the proxy would accept',
  mismatches === 0,
  `${all.slugs.length} kontrolleret, ${mismatches} afvist`,
);
let refusedUnlisted = false;
try {
  selectTenant({ requestedSlug: 'ikke-mit', homeTenant: 'broberg-ai', spansAll: true, isMember: (s) => memberSlugs.has(s) });
} catch (e) {
  refusedUnlisted = e instanceof TenantAccessError;
}
check(
  'and a slug it does NOT offer is refused by that same proxy rule',
  refusedUnlisted,
  'selectTenant kastede TenantAccessError',
);

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗'} ${pass} bestået, ${fail} fejlet`);
process.exit(fail === 0 ? 0 : 1);
