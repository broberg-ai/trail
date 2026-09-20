/**
 * F210.1 verification — creating a tenant.
 *
 * Proves, against a throwaway control.db:
 *   · a new name creates exactly one tenant and returns its slug
 *   · a duplicate slug is refused AND writes nothing
 *   · a name with no letters or digits is refused AND writes nothing
 *   · EVERY owner identity is owner on the new tenant IMMEDIATELY — no
 *     restart, no boot migration in between. That last clause is the point:
 *     the boot backfill would eventually fix it, so a test that restarts
 *     first cannot tell a working create from a broken one.
 *
 * Run: bun run apps/admin-server/scripts/verify-f210-1.ts
 */
import { rmSync } from 'node:fs';

const DB = '/tmp/verify-f210-1.db';
for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s); } catch { /* fresh */ } }
process.env.TRAIL_ADMIN_CONTROL_DB = DB;
// Ship-dark: with no engine configured the route creates the control row and
// reports engine:'not-configured'. Unset here so the probe never reaches prod.
delete process.env.TRAIL_ENGINE_URL;
delete process.env.TRAIL_PROVISION_SECRET;

const { client, db, schema } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');
const { grantOwnerMemberships, tenantRoutes } = await import('../src/tenants.js');

// Written out here on purpose, independent of the list the code reads —
// see the same note in verify-f210-4.ts.
const EXPECTED = ['cb@webhouse.dk', 'christian@broberg.dk', 'christian@broberg.ai'];

let failures = 0;
function assert(cond: boolean, msg: string, detail?: string): void {
  if (!cond) { console.error('  ✗ ' + msg + (detail ? `\n      ${detail}` : '')); failures++; return; }
  console.log('  ✓ ' + msg);
}
async function count(sql: string): Promise<number> {
  const r = await client.execute(sql);
  return Number((r.rows[0] as unknown as { n: number }).n);
}
async function roleOf(userId: string, tenantId: string): Promise<string | null> {
  const r = await client.execute({
    sql: 'SELECT role FROM control_memberships WHERE user_id = ? AND tenant_id = ?',
    args: [userId, tenantId],
  });
  return r.rows.length ? String((r.rows[0] as unknown as { role: string }).role) : null;
}

await runMigrations();
await client.execute("INSERT INTO organizations (id, slug, name) VALUES ('org1','broberg-ai','Broberg.ai')");
for (const [i, email] of EXPECTED.entries()) {
  await client.execute(
    `INSERT INTO control_users (id, organization_id, email) VALUES ('u-o${i}','org1','${email}')`,
  );
}
await client.execute("INSERT INTO control_users (id, organization_id, email) VALUES ('u-x','org1','someone@else.dk')");

// ── AC6's baseline: the two tenants that actually exist in production.
// Seeded BEFORE the create so the comparison is over real neighbours rather
// than an empty table — a create cannot disturb rows that are not there.
for (const [id, slug, name] of [['t-brob', 'broberg-ai', 'Broberg.ai'], ['t-sanne', 'sanne-andersen', 'Sanne Andersen']]) {
  await client.execute({
    sql: "INSERT INTO control_tenants (id, organization_id, slug, name, language) VALUES (?, 'org1', ?, ?, 'da')",
    args: [id, slug, name],
  });
}
async function snapshotExisting(): Promise<string> {
  const r = await client.execute(
    "SELECT id, slug, name, language, organization_id FROM control_tenants WHERE slug IN ('broberg-ai','sanne-andersen') ORDER BY slug",
  );
  return JSON.stringify(r.rows);
}
const existingBefore = await snapshotExisting();

// ── The real thing: create the tenant Christian needs for FDAA.
//
// THIS DRIVES THE SHIPPED ROUTE, not a copy of it. The first version of this
// script re-implemented the validate/clash/insert sequence locally and only
// imported `grantOwnerMemberships` — so AC5's mutation check ("remove the
// duplicate-slug guard and AC1 goes red") could not have worked: the guard the
// test exercised was the test's own. A probe that proves a copy of the code
// proves nothing about the code. Every status below comes from
// tenantRoutes.request(), the same handler the Admin SPA calls.
console.log('\n[create] a tenant for the customer');

// The route reads the caller from the `trail-session` cookie, so the probe
// needs a real session row rather than a user id passed in by hand.
const SESSION = 'sess-f210-1';
await client.execute({
  sql: 'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
  args: [SESSION, 'u-o0', new Date(Date.now() + 3_600_000).toISOString()],
});

interface CreateResult { status: number; body: Record<string, unknown> }
async function postTenant(name: string, cookie = `trail-session=${SESSION}`): Promise<CreateResult> {
  const res = await tenantRoutes.request('/tenants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  // Read the body DEFENSIVELY. Under AC5's mutation the route stops answering
  // 409 and the insert hits the table's UNIQUE index instead — Hono then
  // returns a 500 with an HTML body. A bare res.json() throws there, and the
  // run dies with "Failed to parse JSON", which reads like a broken probe
  // rather than a broken product. The assertion must be able to SAY
  // "expected 409, got 500".
  const raw = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = { nonJsonBody: raw.slice(0, 120) };
  }
  return { status: res.status, body };
}

const created = await postTenant('FD Aalborg');
assert(created.status === 201, 'FD Aalborg created (201)', `got ${created.status} ${JSON.stringify(created.body)}`);
const tenantId = String(created.body.id);
assert(created.body.slug === 'fd-aalborg', 'slug is fd-aalborg', `got ${String(created.body.slug)}`);
assert(created.body.engine === 'not-configured', "ships dark: engine reports 'not-configured', it does not claim success", `got ${String(created.body.engine)}`);
assert(await count('SELECT count(*) n FROM control_tenants') === 3, 'exactly one NEW tenant row beside the two existing ones');

// A caller with no session must not be able to create a customer account.
const anon = await postTenant('Nobody Ltd', '');
assert(anon.status === 401, 'NEGATIVE CONTROL: no session → 401', `got ${anon.status}`);
assert(await count('SELECT count(*) n FROM control_tenants') === 3, 'and the anonymous attempt wrote nothing');

// ── The clause that matters: owner NOW, not after a restart.
console.log('\n[owner] every identity is owner immediately — no restart');
for (const [i, email] of EXPECTED.entries()) {
  const role = await roleOf(`u-o${i}`, tenantId);
  assert(role === 'owner', `${email} → owner on the new tenant`, `read back: ${role ?? '(no row)'}`);
}
assert(
  (await roleOf('u-x', tenantId)) === null,
  'NEGATIVE CONTROL: a non-owner gets NO row on the new tenant',
  `read back: ${await roleOf('u-x', tenantId)}`,
);

// ── Duplicate slug: refused, and nothing written.
console.log('\n[duplicate] refused, and writes nothing');
const tenantsBefore = await count('SELECT count(*) n FROM control_tenants');
const memberBefore = await count('SELECT count(*) n FROM control_memberships');
const dupe = await postTenant('FD Aalborg');
assert(dupe.status === 409, 'a second FD Aalborg is refused (409)', `got ${dupe.status} ${JSON.stringify(dupe.body)}`);
assert(await count('SELECT count(*) n FROM control_tenants') === tenantsBefore, 'tenant count unchanged', `${tenantsBefore} → ${await count('SELECT count(*) n FROM control_tenants')}`);
assert(await count('SELECT count(*) n FROM control_memberships') === memberBefore, 'membership count unchanged');

// ── A name that slugifies to nothing.
console.log('\n[bad name] a name with no letters or digits is refused');
const empty = await postTenant('---');
assert(empty.status === 400, "'---' is refused (400)", `got ${empty.status} ${JSON.stringify(empty.body)}`);
assert(await count('SELECT count(*) n FROM control_tenants') === tenantsBefore, 'still no extra tenant row');

// ── Idempotent: re-granting writes nothing new.
console.log('\n[idempotent] re-granting is a no-op');
const before = await count('SELECT count(*) n FROM control_memberships');
const again = await grantOwnerMemberships(tenantId, 'u-o0');
assert(again === 0, 're-grant writes 0 rows', `wrote ${again}`);
assert(await count('SELECT count(*) n FROM control_memberships') === before, 'membership count unchanged');

// ── AC6: the customers who were already there are untouched.
console.log('\n[untouched] broberg-ai and sanne-andersen are byte-for-byte unchanged');
const existingAfter = await snapshotExisting();
assert(
  existingAfter === existingBefore,
  'the two existing tenants are identical before and after the create',
  `before: ${existingBefore}\n      after:  ${existingAfter}`,
);
// NEGATIVE CONTROL for that assertion: if it could not see a change it would
// pass by accident. Change one row on purpose and prove the comparison
// notices, then put it back.
await client.execute("UPDATE control_tenants SET name = 'Tampered' WHERE slug = 'broberg-ai'");
assert(
  (await snapshotExisting()) !== existingBefore,
  'NEGATIVE CONTROL: the comparison DOES notice a changed row',
);
await client.execute("UPDATE control_tenants SET name = 'Broberg.ai' WHERE slug = 'broberg-ai'");
assert((await snapshotExisting()) === existingBefore, 'and the tamper was undone');

console.log(failures === 0 ? '\n✓ F210.1 verified\n' : `\n✗ F210.1: ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
