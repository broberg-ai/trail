/**
 * F210.4 verification — the owner is `owner` in EVERY tenant, under EVERY one
 * of his identities, ACROSS organisations.
 *
 * Christian, 2026-08-27: "JEG KAN og SKAL og MÅ være admin i ALLE tenants
 * uanset hvilken mail jeg anvender - ikke til diskussion."
 *
 * Runs against a throwaway control.db so it never touches prod.
 *
 * Run: bun run apps/admin-server/scripts/verify-f210-4.ts
 */
import { rmSync } from 'node:fs';
import { OWNER_IDENTITIES } from '@trail/shared';

const DB = '/tmp/verify-f210-4.db';
for (const suffix of ['', '-wal', '-shm']) {
  try { rmSync(DB + suffix); } catch { /* fresh */ }
}
process.env.TRAIL_ADMIN_CONTROL_DB = DB;

const { client } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');

let failures = 0;
function assert(cond: boolean, msg: string, detail?: string): void {
  if (!cond) {
    console.error('  ✗ ' + msg + (detail ? `\n      ${detail}` : ''));
    failures++;
    return;
  }
  console.log('  ✓ ' + msg);
}
async function roleOf(userId: string, tenantId: string): Promise<string | null> {
  // Raw query on purpose: read the row back through a DIFFERENT path than the
  // one that wrote it. A read through the writer proves nothing.
  const r = await client.execute({
    sql: 'SELECT role FROM control_memberships WHERE user_id = ? AND tenant_id = ?',
    args: [userId, tenantId],
  });
  return r.rows.length ? String((r.rows[0] as unknown as { role: string }).role) : null;
}
async function count(sql: string): Promise<number> {
  const r = await client.execute(sql);
  return Number((r.rows[0] as unknown as { n: number }).n);
}

// The three addresses are written out HERE, independently of the list the code
// reads. That independence is the whole point: an earlier version of this
// script seeded its users FROM OWNER_IDENTITIES, so shrinking the list shrank
// the test with it and AC2 stayed green on a mutation that had just locked two
// of his identities out. A test that imports its own expectation only ever
// proves the code agrees with itself.
const EXPECTED = ['cb@webhouse.dk', 'christian@broberg.dk', 'christian@broberg.ai'];

console.log(`\nF210.4 — code lists ${OWNER_IDENTITIES.length}: ${OWNER_IDENTITIES.join(', ')}\n`);
for (const e of EXPECTED) {
  assert(
    (OWNER_IDENTITIES as readonly string[]).includes(e),
    `the identity list carries ${e}`,
    `list is: ${OWNER_IDENTITIES.join(', ')}`,
  );
}

await runMigrations();

// ── Two organisations. The second is one the owner is NOT a member of —
//    that is what makes AC3 a real cross-org test rather than a same-org one.
await client.execute("INSERT INTO organizations (id, slug, name) VALUES ('org1','broberg-ai','Broberg.ai')");
await client.execute("INSERT INTO organizations (id, slug, name) VALUES ('org2','fdaa','FDAA')");

// Owner users. Note the third is stored MIXED-CASE with padding: an OAuth
// provider can hand back 'CB@Webhouse.DK ', and a case-sensitive compare
// would lock him out on a detail he cannot see.
const owners = EXPECTED;
await client.execute(`INSERT INTO control_users (id, organization_id, email) VALUES ('u-o0','org1','${owners[0]}')`);
await client.execute(`INSERT INTO control_users (id, organization_id, email) VALUES ('u-o1','org1','${owners[1]}')`);
await client.execute(`INSERT INTO control_users (id, organization_id, email) VALUES ('u-o2','org1','  ${owners[2]!.toUpperCase()}  ')`);
// A stranger in org1, and a stranger in org2.
await client.execute("INSERT INTO control_users (id, organization_id, email) VALUES ('u-x','org1','someone@else.dk')");
await client.execute("INSERT INTO control_users (id, organization_id, email) VALUES ('u-fdaa','org2','leder@fdaa.dk')");

// Three tenants: two in org1, one in org2 (the customer).
await client.execute("INSERT INTO control_tenants (id, organization_id, slug, name) VALUES ('t-a','org1','broberg-ai','Broberg.ai')");
await client.execute("INSERT INTO control_tenants (id, organization_id, slug, name) VALUES ('t-b','org1','sanne-andersen','Sanne Andersen')");
await client.execute("INSERT INTO control_tenants (id, organization_id, slug, name) VALUES ('t-c','org2','fd-sundhed','FD Sundhed')");

await runMigrations();

// ── AC2 — all identities × all tenants = owner. 3 × 3 = 9 rows.
console.log('\n[AC2] every identity is owner on every tenant');
let ownerRows = 0;
for (const [i, email] of owners.entries()) {
  for (const t of ['t-a', 't-b', 't-c']) {
    const role = await roleOf(`u-o${i}`, t);
    assert(role === 'owner', `${email} on ${t} → owner`, `read back: ${role ?? '(no row at all)'}`);
    if (role === 'owner') ownerRows++;
  }
}
assert(ownerRows === owners.length * 3, `all ${owners.length * 3} owner rows present`, `found ${ownerRows}`);

// ── AC3 — cross-org proven, with the negative control that gives it meaning.
console.log('\n[AC3] cross-org, and the boundary still holds for everyone else');
assert(
  (await roleOf('u-o0', 't-c')) === 'owner',
  'owner reaches a tenant in an organisation he is NOT a member of (org2)',
);
assert(
  (await roleOf('u-x', 't-c')) === null,
  'NEGATIVE CONTROL: a non-owner in org1 has NO row on the org2 tenant',
  `read back: ${await roleOf('u-x', 't-c')}`,
);
assert((await roleOf('u-x', 't-a')) === 'member', 'a non-owner is still member in his own org (no false elevation)');
assert((await roleOf('u-fdaa', 't-c')) === 'member', "the customer's own user is member on their tenant");
assert((await roleOf('u-fdaa', 't-a')) === null, 'NEGATIVE CONTROL: the customer has no row on the owner-org tenants');

// ── Self-heal: a stray demotion is repaired on the next boot, for EVERY identity.
console.log('\n[self-heal] a demotion of any identity is repaired at boot');
await client.execute("UPDATE control_memberships SET role='member' WHERE role='owner'");
await runMigrations();
let healed = 0;
for (const [i] of owners.entries()) {
  for (const t of ['t-a', 't-b', 't-c']) {
    if ((await roleOf(`u-o${i}`, t)) === 'owner') healed++;
  }
}
assert(healed === owners.length * 3, `all ${owners.length * 3} rows healed back to owner`, `healed ${healed}`);

// ── Additive only: the run must never delete a row or lower anyone.
console.log('\n[additive] the backfill never removes or lowers');
const before = await count('SELECT count(*) n FROM control_memberships');
await runMigrations();
const after = await count('SELECT count(*) n FROM control_memberships');
assert(after === before, 'a re-run changes no row count (idempotent)', `${before} → ${after}`);
assert(
  (await roleOf('u-x', 't-a')) === 'member',
  'a non-owner is not touched by the owner enforcement',
);

console.log(
  failures === 0
    ? '\n✓ F210.4 verified\n'
    : `\n✗ F210.4: ${failures} assertion(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
