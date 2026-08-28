/**
 * F215.3 proof — the two endpoints that answer "which tenants may I select?"
 * cannot disagree, because only one of them decides.
 *
 * This script asserts them AGAINST EACH OTHER, not each against a hand-written
 * expectation. That distinction is the whole card: two implementations both
 * matching a list I typed in a test would still be two implementations, and the
 * next change would still only land in one of them. What has to be impossible
 * is a divergence, so the divergence is what is measured.
 *
 * The live defect it closes: `/api/control/my-tenants` returned
 * `role: 'member'` as a hardcoded literal for a single-tenant key, and
 * `apps/ingest-station/src/app.tsx:366` renders that field — so the Station
 * printed "member" beside a tenant the caller owns.
 *
 * Run from apps/admin-server:  bun run scripts/verify-f215-3.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(process.env.TMPDIR ?? '/tmp', `f2153-${process.env.USER ?? 'x'}.db`);
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f, { force: true }); } catch { /* first run */ } }
process.env.TRAIL_ADMIN_CONTROL_DB = DB;
process.env.NODE_ENV = 'test';

const { db, schema } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');
const { apiKeyRoutes, hashApiKey } = await import('../src/keys.js');
const { meTenantRoutes } = await import('../src/me-tenants.js');
const { generateKey } = await import('@broberg/apikey');
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
  ['t1', 'broberg-ai', 'Broberg.ai'],
  ['t2', 'sanne-andersen', 'Sanne Andersen'],
  ['t3', 'fd-aalborg', 'FD Aalborg'],
  ['t4', 'ikke-mit', 'Ikke Mit'],
] as const) {
  await db.insert(schema.controlTenants).values({ id, organizationId: 'org1', slug, name, language: 'da', createdAt: now }).run();
}
await db.insert(schema.controlUsers).values([
  { id: 'u-cb', organizationId: 'org1', email: 'cb@webhouse.dk', name: 'CB', onboarded: true, createdAt: now },
  { id: 'u-other', organizationId: 'org1', email: 'anden@example.com', name: 'Anden', onboarded: true, createdAt: now },
  { id: 'u-orphan', organizationId: 'org1', email: 'forældreløs@example.com', name: 'Orphan', onboarded: true, createdAt: now },
]).run();

// THREE DISTINCT ROLES, inserted in an order that does NOT match the required
// output order. Insertion order would give broberg-ai, sanne-andersen,
// fd-aalborg; name order gives broberg-ai, fd-aalborg, sanne-andersen. So the
// ordering assertion below can actually fail — an unsorted implementation would
// not pass it by luck.
for (const [t, role] of [['t1', 'owner'], ['t2', 'admin'], ['t3', 'member']] as const) {
  await db.insert(schema.controlMemberships).values({ userId: 'u-cb', tenantId: t, role, createdAt: now }).run();
}
await db.insert(schema.controlMemberships).values({ userId: 'u-other', tenantId: 't2', role: 'member', createdAt: now }).run();
// u-orphan deliberately gets NO membership row at all.

const keyAll = generateKey('trail');
const keyOne = generateKey('trail');
const keyOther = generateKey('trail');
const keyOrphan = generateKey('trail');
await db.insert(schema.controlApiKeys).values([
  { id: 'k1', tenantId: 't1', userId: 'u-cb', name: 'all', prefix: keyAll.slice(0, 12), keyHash: hashApiKey(keyAll), scope: 'all', createdAt: now },
  { id: 'k2', tenantId: 't1', userId: 'u-cb', name: 'one', prefix: keyOne.slice(0, 12), keyHash: hashApiKey(keyOne), scope: 'full', createdAt: now },
  { id: 'k3', tenantId: 't2', userId: 'u-other', name: 'other', prefix: keyOther.slice(0, 12), keyHash: hashApiKey(keyOther), scope: 'all', createdAt: now },
  { id: 'k4', tenantId: 't1', userId: 'u-orphan', name: 'orphan', prefix: keyOrphan.slice(0, 12), keyHash: hashApiKey(keyOrphan), scope: 'full', createdAt: now },
]).run();

const app = new Hono();
app.route('/api/control', apiKeyRoutes);
app.route('/api', meTenantRoutes);

type StationRow = { slug: string; name: string; role: string };
type ClipperRow = { slug: string; name: string; home: boolean };

async function station(key: string) {
  const res = await app.request('http://admin.local/api/control/my-tenants', { headers: { Authorization: `Bearer ${key}` } });
  const body = res.ok ? ((await res.json()) as { scope: string; tenants: StationRow[] }) : null;
  return { status: res.status, scope: body?.scope, rows: body?.tenants ?? [] };
}
async function clipper(key: string) {
  const res = await app.request('http://admin.local/api/v1/me/tenants', { headers: { Authorization: `Bearer ${key}` } });
  const body = res.ok ? ((await res.json()) as { tenants: ClipperRow[] }) : null;
  return { status: res.status, rows: body?.tenants ?? [] };
}
const slugs = (rows: Array<{ slug: string }>) => rows.map((r) => r.slug);

// ── AC1 — the two endpoints agree, for BOTH kinds of key ───────────────────
for (const [label, key, expected] of [
  ['scope=all', keyAll, ['broberg-ai', 'fd-aalborg', 'sanne-andersen']],
  ['scope=full', keyOne, ['broberg-ai']],
  ['orphan key', keyOrphan, ['broberg-ai']],
  ['another user', keyOther, ['sanne-andersen']],
] as const) {
  const s = await station(key), cl = await clipper(key);
  check(
    `${label}: both endpoints return the SAME slugs in the SAME order`,
    JSON.stringify(slugs(s.rows)) === JSON.stringify(slugs(cl.rows)),
    `station ${JSON.stringify(slugs(s.rows))} · clipper ${JSON.stringify(slugs(cl.rows))}`,
  );
  check(
    `${label}: …and that order is home-first-then-alphabetical, not insertion order`,
    JSON.stringify(slugs(s.rows)) === JSON.stringify(expected),
    JSON.stringify(slugs(s.rows)),
  );
}

// ── AC2 — the role is READ, not a literal ──────────────────────────────────
// The defect this card closes. u-cb is 'owner' in t1; the old code answered
// 'member' for every single-tenant key, unconditionally.
const one = await station(keyOne);
check(
  'a single-tenant key reports the caller’s REAL role, not the constant "member"',
  one.rows[0]?.role === 'owner',
  `fik ${JSON.stringify(one.rows[0]?.role)}, forventede "owner"`,
);
const all = await station(keyAll);
check(
  'and each tenant carries its own role — three memberships, three different roles',
  JSON.stringify(all.rows.map((r) => `${r.slug}=${r.role}`))
    === JSON.stringify(['broberg-ai=owner', 'fd-aalborg=member', 'sanne-andersen=admin']),
  JSON.stringify(all.rows.map((r) => `${r.slug}=${r.role}`)),
);
check(
  'the three roles are actually distinct — so "reads the column" is proven, not assumed',
  new Set(all.rows.map((r) => r.role)).size === 3,
  JSON.stringify(all.rows.map((r) => r.role)),
);

// ── AC3 — the Ingest Station's contract is byte-for-byte what it parses ────
// Asserted against the keys apps/ingest-station/src/api.ts declares on its
// `Tenant` interface: { slug, name, role } plus a top-level `scope`.
check('Station response carries scope="all" for an all key', all.scope === 'all', JSON.stringify(all.scope));
check('Station response carries scope="full" for a narrow key', one.scope === 'full', JSON.stringify(one.scope));
check(
  'every Station row has exactly the keys its api.ts declares — no more, no less',
  all.rows.every((r) => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['name', 'role', 'slug'])),
  JSON.stringify(all.rows.map((r) => Object.keys(r).sort())),
);
const clipAll = await clipper(keyAll);
check(
  'and the Clipper’s rows keep THEIR shape — {slug,name,home}, no role leaked in',
  clipAll.rows.every((r) => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['home', 'name', 'slug'])),
  JSON.stringify(clipAll.rows.map((r) => Object.keys(r).sort())),
);
check(
  'exactly one row is flagged home, and it is the key’s own tenant',
  clipAll.rows.filter((r) => r.home).map((r) => r.slug).join() === 'broberg-ai',
  JSON.stringify(clipAll.rows),
);

// ── AC4 — a tenant nobody is a member of never appears, on either ──────────
check(
  'a tenant the user never joined is absent from BOTH',
  !slugs(all.rows).includes('ikke-mit') && !slugs(clipAll.rows).includes('ikke-mit'),
  `${JSON.stringify(slugs(all.rows))} / ${JSON.stringify(slugs(clipAll.rows))}`,
);

// ── AC5 — no lock-out for a key with no membership row ─────────────────────
// The LEFT join. An inner join would silently return [] here, and the Ingest
// Station would show an empty picker for a key that works fine.
const orphan = await station(keyOrphan);
check(
  'a key whose user has NO membership row still gets its home tenant back',
  slugs(orphan.rows).join() === 'broberg-ai',
  JSON.stringify(orphan.rows),
);
check(
  'and falls back to "member" rather than null/undefined',
  orphan.rows[0]?.role === 'member',
  JSON.stringify(orphan.rows[0]?.role),
);

// ── AC6 — listing is still not a grant ─────────────────────────────────────
const bogus = await app.request('http://admin.local/api/control/my-tenants', {
  headers: { Authorization: 'Bearer trail_ikke-en-rigtig-noegle' },
});
check('an unknown key is refused by the Station endpoint (401)', bogus.status === 401, `status ${bogus.status}`);
const noAuth = await app.request('http://admin.local/api/control/my-tenants');
check('no credentials at all → 401', noAuth.status === 401, `status ${noAuth.status}`);

// A revoked key must stop listing immediately.
await db.update(schema.controlApiKeys).set({ revokedAt: new Date().toISOString() })
  .where((await import('drizzle-orm')).eq(schema.controlApiKeys.id, 'k1')).run();
const revoked = await station(keyAll);
check('a revoked key stops listing at once (401)', revoked.status === 401, `status ${revoked.status}`);

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗'} ${pass} bestået, ${fail} fejlet`);
process.exit(fail === 0 ? 0 : 1);
