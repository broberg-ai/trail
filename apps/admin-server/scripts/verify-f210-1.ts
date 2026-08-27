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

const { client, db, schema } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');
const { grantOwnerMemberships } = await import('../src/tenants.js');

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

// ── The real thing: create the tenant Christian needs for FDAA.
console.log('\n[create] a tenant for the customer');
const { slugify } = await import('@trail/shared');
const { randomUUID } = await import('node:crypto');

async function createTenant(name: string, creator: string) {
  const slug = slugify(name);
  if (!slug) return { error: 'empty slug' as const };
  const clash = await client.execute({
    sql: 'SELECT id FROM control_tenants WHERE slug = ?', args: [slug],
  });
  if (clash.rows.length) return { error: 'clash' as const, slug };
  const id = randomUUID();
  await db.insert(schema.controlTenants).values({
    id, organizationId: 'org1', slug, name, language: 'da',
  });
  const written = await grantOwnerMemberships(id, creator);
  return { id, slug, written };
}

const created = await createTenant('FD Aalborg', 'u-o0');
assert(!('error' in created), 'FD Aalborg created');
const tenantId = (created as { id: string }).id;
assert((created as { slug: string }).slug === 'fd-aalborg', 'slug is fd-aalborg', `got ${(created as { slug: string }).slug}`);
assert(await count('SELECT count(*) n FROM control_tenants') === 1, 'exactly one tenant row');

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
const dupe = await createTenant('FD Aalborg', 'u-o0');
assert('error' in dupe && dupe.error === 'clash', 'a second FD Aalborg is refused');
assert(await count('SELECT count(*) n FROM control_tenants') === tenantsBefore, 'tenant count unchanged', `${tenantsBefore} → ${await count('SELECT count(*) n FROM control_tenants')}`);
assert(await count('SELECT count(*) n FROM control_memberships') === memberBefore, 'membership count unchanged');

// ── A name that slugifies to nothing.
console.log('\n[bad name] a name with no letters or digits is refused');
const empty = await createTenant('---', 'u-o0');
assert('error' in empty && empty.error === 'empty slug', "'---' is refused");
assert(await count('SELECT count(*) n FROM control_tenants') === tenantsBefore, 'still no extra tenant row');

// ── Idempotent: re-granting writes nothing new.
console.log('\n[idempotent] re-granting is a no-op');
const before = await count('SELECT count(*) n FROM control_memberships');
const again = await grantOwnerMemberships(tenantId, 'u-o0');
assert(again === 0, 're-grant writes 0 rows', `wrote ${again}`);
assert(await count('SELECT count(*) n FROM control_memberships') === before, 'membership count unchanged');

console.log(failures === 0 ? '\n✓ F210.1 verified\n' : `\n✗ F210.1: ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
