/**
 * F215.2 proof — you can now mint a key that spans the tenants you belong to,
 * and the narrow default is unchanged.
 *
 * The bug: `keys.ts` wrote `scope: 'full'` unconditionally, so nothing in the
 * product could produce the `scope: 'all'` key that tenant selection requires.
 * F215.1's picker renders only when the caller sees more than one tenant, so it
 * shipped correct and unreachable — the owner installed it, saw no picker, and
 * asked whether he should fetch a new token. The honest answer was "no, that
 * would not help either", which is what made this a defect rather than a
 * preference.
 *
 * The property under test is NOT "a column can hold two values". It is that the
 * two keys REACH different things, measured through the same endpoint the Web
 * Clipper calls — and that `all` is a SELECTOR, not a grant.
 *
 * Run from apps/admin-server:  bun run scripts/verify-f215-2.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(process.env.TMPDIR ?? '/tmp', `f2152-${process.env.USER ?? 'x'}.db`);
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f, { force: true }); } catch { /* first run */ } }
process.env.TRAIL_ADMIN_CONTROL_DB = DB;
process.env.NODE_ENV = 'test';

const { db, schema } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');
const { apiKeyRoutes } = await import('../src/keys.js');
const { Hono } = await import('hono');
const { eq } = await import('drizzle-orm');

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
await db.insert(schema.controlUsers).values({ id: 'u-cb', organizationId: 'org1', email: 'cb@webhouse.dk', name: 'CB', onboarded: true, createdAt: now }).run();
// THREE memberships, and t4 deliberately absent. The whole point of the card is
// that scope decides how much of an EXISTING membership set a key may use, so
// the set has to be bigger than one and smaller than everything.
for (const t of ['t1', 't2', 't3']) {
  await db.insert(schema.controlMemberships).values({ userId: 'u-cb', tenantId: t, role: 'owner', createdAt: now }).run();
}
await db.insert(schema.sessions).values({
  id: 'sess-f2152', userId: 'u-cb',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(), createdAt: now,
}).run();

const app = new Hono();
app.route('/api/control', apiKeyRoutes);
const cookie = { 'Content-Type': 'application/json', Cookie: 'trail-session=sess-f2152; trail-active-tenant=broberg-ai' };

async function createKey(body: unknown) {
  const res = await app.request('http://admin.local/api/control/api-keys', {
    method: 'POST', headers: cookie, body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try { parsed = (await res.clone().json()) as Record<string, unknown>; } catch { /* non-JSON */ }
  return { status: res.status, body: parsed };
}
async function myTenants(key: string) {
  const res = await app.request('http://admin.local/api/control/my-tenants', {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = res.ok ? ((await res.json()) as { scope: string; tenants: Array<{ slug: string }> }) : null;
  return { status: res.status, slugs: (body?.tenants ?? []).map((t) => t.slug).sort(), scope: body?.scope };
}
/** Read the stored scope with a raw query — never through the layer that wrote it. */
async function storedScope(id: string): Promise<string | undefined> {
  const { client } = await import('../src/db.js');
  const r = await client.execute({ sql: 'SELECT scope FROM control_api_keys WHERE id = ?', args: [id] });
  return (r.rows[0] as unknown as { scope: string } | undefined)?.scope;
}
const keyCount = async (): Promise<number> => {
  const { client } = await import('../src/db.js');
  const r = await client.execute('SELECT count(*) c FROM control_api_keys');
  return Number((r.rows[0] as unknown as { c: number }).c);
};

// ── AC1 — the default is untouched ─────────────────────────────────────────
const def = await createKey({ name: 'uden scope' });
check('creating without a scope still works (201)', def.status === 201, `status ${def.status}`);
check(
  'and the STORED scope is still "full" — read back with raw SQL',
  (await storedScope(def.body.id as string)) === 'full',
  `gemt: ${await storedScope(def.body.id as string)}`,
);

// ── AC2 — an 'all' key reaches every membership ────────────────────────────
const all = await createKey({ name: 'clipper', scope: 'all' });
check('creating with scope=all works (201)', all.status === 201, `status ${all.status}`);
check(
  'the stored scope is "all"',
  (await storedScope(all.body.id as string)) === 'all',
  `gemt: ${await storedScope(all.body.id as string)}`,
);
const allReach = await myTenants(all.body.key as string);
check(
  'and it reaches EVERY tenant the user belongs to',
  JSON.stringify(allReach.slugs) === JSON.stringify(['broberg-ai', 'fd-aalborg', 'sanne-andersen']),
  JSON.stringify(allReach.slugs),
);
check(
  'more than one — which is the condition the picker renders on',
  allReach.slugs.length > 1,
  `${allReach.slugs.length} kunder`,
);

// ── AC3 — the narrow key reaches exactly one, same user ────────────────────
// The discriminating control. Both keys belong to a user with THREE
// memberships, so a difference here can only be the scope.
const oneReach = await myTenants(def.body.key as string);
check(
  'the "full" key reaches exactly ONE tenant',
  JSON.stringify(oneReach.slugs) === JSON.stringify(['broberg-ai']),
  JSON.stringify(oneReach.slugs),
);
check(
  'same user, same memberships — so the difference IS the scope',
  oneReach.slugs.length === 1 && allReach.slugs.length === 3,
  `full: ${oneReach.slugs.length}, all: ${allReach.slugs.length}, medlemskaber: 3`,
);

// ── AC4 — an unrecognised scope is refused, and writes nothing ─────────────
for (const bad of ['owner', '', 'ALL', 'partner', 'Full']) {
  const before = await keyCount();
  const res = await createKey({ name: `bad-${bad || 'tom'}`, scope: bad });
  const after = await keyCount();
  check(
    `scope="${bad}" → 400, and no key row written`,
    res.status === 400 && after === before,
    `status ${res.status}, rækker ${before}→${after}, besked ${JSON.stringify(res.body.error)}`,
  );
}
const badMsg = (await createKey({ name: 'x', scope: 'owner' })).body.error as string | undefined;
check(
  'the 400 names the field and lists the legal values',
  !!badMsg && badMsg.startsWith('scope:') && badMsg.includes("'all'") && badMsg.includes("'full'"),
  JSON.stringify(badMsg),
);

// ── AC5 — SELECTOR, NOT GRANT ──────────────────────────────────────────────
// The load-bearing property. Take a membership away and the SAME key narrows,
// without the key being touched. If scope were a grant, it could not.
await db.delete(schema.controlMemberships)
  .where(eq(schema.controlMemberships.tenantId, 't3'))
  .run();
const afterRevoke = await myTenants(all.body.key as string);
check(
  'removing a membership narrows the SAME "all" key immediately',
  JSON.stringify(afterRevoke.slugs) === JSON.stringify(['broberg-ai', 'sanne-andersen']),
  `før ${JSON.stringify(allReach.slugs)} → efter ${JSON.stringify(afterRevoke.slugs)}`,
);
check(
  'the key itself was not modified — its stored scope is still "all"',
  (await storedScope(all.body.id as string)) === 'all',
  `gemt: ${await storedScope(all.body.id as string)}`,
);
check(
  'a tenant the user never belonged to is still absent',
  !afterRevoke.slugs.includes('ikke-mit'),
  JSON.stringify(afterRevoke.slugs),
);

// ── AC6 — the list exposes the scope ───────────────────────────────────────
const listed = await app.request('http://admin.local/api/control/api-keys', { headers: cookie });
const listBody = (await listed.json()) as { keys: Array<{ name: string; scope?: string }> };
check(
  'GET /api-keys reports each key’s scope, so two keys are distinguishable',
  listBody.keys.every((k) => k.scope === 'full' || k.scope === 'all')
    && new Set(listBody.keys.map((k) => k.scope)).size === 2,
  JSON.stringify(listBody.keys.map((k) => `${k.name}=${k.scope}`)),
);

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗'} ${pass} bestået, ${fail} fejlet`);
process.exit(fail === 0 ? 0 : 1);
