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

// ─────────────────────────────────────────────────────────────────────────────
// AC5 — FIRST LOGIN by an owner identity that has no control_users row.
//
// MEASURED before building it, and it was worse than the AC describes:
//   auth.ts   no row → `{ok:true, sent:false}`  — SILENT. No mail, no error,
//             no reason. Indistinguishable from a mail that never arrived.
//   oauth.ts  no row → `?error=email_not_registered`
// Both doors locked the owner out of his own system on his 2nd/3rd address.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[AC5] first login by an owner identity with no user row');
const { ensureOwnerIdentity } = await import('../src/tenants.js');

// Delete one identity entirely — user row AND its memberships — to replay a
// genuinely-first login rather than a partially-present one.
await client.execute("DELETE FROM control_memberships WHERE user_id = 'u-o2'");
await client.execute("DELETE FROM control_users WHERE id = 'u-o2'");
const goneEmail = EXPECTED[2]!;
assert(
  await count(`SELECT count(*) n FROM control_users WHERE email = '${goneEmail}'`) === 0,
  `NEGATIVE CONTROL: ${goneEmail} really has no user row now`,
);

const recreated = await ensureOwnerIdentity(goneEmail);
assert(recreated !== null, `first login CREATES the user for ${goneEmail}`);
const newId = recreated?.id ?? '';
for (const t of ['t-a', 't-b', 't-c']) {
  const r = await roleOf(newId, t);
  assert(r === 'owner', `and owner on ${t} immediately — no restart`, `expected owner, read ${r ?? '(no row)'}`);
}

// A NON-owner address must get nothing from this path. If it did, the fix
// would be a way for any address to write itself into every customer.
// someone@else.dk is seeded as u-x above, so "no row exists" would be the
// wrong assertion — and it FAILED, correctly, when I first wrote it that way.
// What matters is that this path writes NOTHING for a non-owner.
const strangerRowsBefore = await count('SELECT count(*) n FROM control_memberships');
const strangerUsersBefore = await count('SELECT count(*) n FROM control_users');
const stranger = await ensureOwnerIdentity('someone@else.dk');
assert(stranger === null, 'NEGATIVE CONTROL: a non-owner address gets NOTHING from this path');
assert(
  await count('SELECT count(*) n FROM control_memberships') === strangerRowsBefore,
  'and it granted the non-owner no membership',
);
assert(
  await count('SELECT count(*) n FROM control_users') === strangerUsersBefore,
  'and created no user',
);
// A brand-new non-owner address must also get nothing.
assert((await ensureOwnerIdentity('nobody@nowhere.dk')) === null, 'nor does an UNKNOWN non-owner address');
assert(
  await count("SELECT count(*) n FROM control_users WHERE email = 'nobody@nowhere.dk'") === 0,
  'and no row appeared for it',
);

// Idempotent: a second login writes nothing new.
const rowsBefore = await count('SELECT count(*) n FROM control_memberships');
await ensureOwnerIdentity(goneEmail);
assert(
  await count('SELECT count(*) n FROM control_memberships') === rowsBefore,
  'a second login is a no-op (idempotent)',
);

// ─────────────────────────────────────────────────────────────────────────────
// AC8 — the Lens principal must NOT be an owner. Adding the identity list
// must not have elevated it.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[AC8] the Lens principal is still not an owner');
const { LENS_PRINCIPAL_EMAIL } = await import('@trail/shared');
assert(
  !(await import('@trail/shared')).isOwnerIdentity(LENS_PRINCIPAL_EMAIL),
  `${LENS_PRINCIPAL_EMAIL} is NOT in the owner list`,
);
assert(
  (await ensureOwnerIdentity(LENS_PRINCIPAL_EMAIL)) === null,
  'and the login path refuses to create/elevate it',
);

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — one source for the identity list, in PRODUCTION code.
//
// Scoped to apps/*/src and packages/*/src on purpose, and the reason is on
// the record: verify-f210-1.ts and this file write the three addresses out
// DELIBERATELY, independent of the list the code reads, so a tampered or
// emptied OWNER_IDENTITIES cannot make either probe pass vacuously. A test
// that imports the value it is checking proves only that the file parses.
// So the rule is enforced where it protects something — routes and
// migrations — and knowingly broken in the probes.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[AC1] the addresses appear as literals in ONE production file');
const grep = Bun.spawnSync([
  'bash', '-c',
  "grep -rn 'cb@webhouse\\.dk\\|christian@broberg\\.dk\\|christian@broberg\\.ai' " +
  "apps/*/src packages/*/src --include='*.ts' --include='*.tsx' 2>/dev/null " +
  "| grep -v '^packages/shared/src/owner-identities.ts' " +
  "| grep -v '\\.test\\.ts' | grep -v '/test/' " +
  "| grep -v '\\*' | grep -v '//' || true",
], { cwd: new URL('../../..', import.meta.url).pathname });
const stray = new TextDecoder().decode(grep.stdout).trim();
assert(
  stray === '',
  'no owner address is a literal in production code outside owner-identities.ts',
  stray ? `found:\n      ${stray.split('\n').join('\n      ')}` : '',
);

// CAN THIS ASSERTION EVEN FAIL? An empty grep result and a broken grep look
// identical, so prove the pattern finds the addresses when the single
// exemption is lifted. Without this, a typo in the regex would read as "clean".
const selfCheck = Bun.spawnSync([
  'bash', '-c',
  "grep -rn 'cb@webhouse\\.dk\\|christian@broberg\\.dk\\|christian@broberg\\.ai' " +
  "packages/shared/src/owner-identities.ts 2>/dev/null | wc -l",
], { cwd: new URL('../../..', import.meta.url).pathname });
assert(
  Number(new TextDecoder().decode(selfCheck.stdout).trim()) >= 3,
  'SELF-CHECK: the grep pattern DOES find all three addresses where they live',
  `matched ${new TextDecoder().decode(selfCheck.stdout).trim()} line(s) in owner-identities.ts`,
);

// And the enforcement really READS that list rather than a copy: migrations.ts
// must not contain a hardcoded address (its old shape did, in raw SQL).
const mig = await Bun.file(new URL('../src/migrations.ts', import.meta.url)).text();
assert(
  !/cb@webhouse\.dk/.test(mig.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')),
  'migrations.ts no longer hardcodes an address in its SQL',
);
assert(
  /ownerIdentitiesSqlList|OWNER_IDENTITIES/.test(mig),
  'and it imports the shared list instead',
);

// ─────────────────────────────────────────────────────────────────────────────
// AC5b (the structural seal) — tenant creation has exactly ONE door, and it
// grants owner. That is WHY login does not need its own grant for a tenant
// created at runtime. If someone adds a second door, this goes red.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[one door] a tenant can only be created in one place');
const doors = Bun.spawnSync([
  'bash', '-c',
  "grep -rln 'INSERT INTO control_tenants\\|insert(schema.controlTenants)' apps/*/src packages/*/src 2>/dev/null || true",
], { cwd: new URL('../../..', import.meta.url).pathname });
const doorFiles = new TextDecoder().decode(doors.stdout).trim().split('\n').filter(Boolean);
assert(
  doorFiles.length === 1 && doorFiles[0] === 'apps/admin-server/src/tenants.ts',
  'exactly ONE production file creates a tenant row',
  `found: ${doorFiles.join(', ') || '(none)'}`,
);
const tenantsSrc = await Bun.file(new URL('../src/tenants.ts', import.meta.url)).text();
const insertAt = tenantsSrc.indexOf('insert(schema.controlTenants)');
const grantAt = tenantsSrc.indexOf('grantOwnerMemberships(id, user.id)');
assert(
  insertAt > 0 && grantAt > insertAt,
  'and the owner grant follows the insert in that same handler',
  `insert@${insertAt} grant@${grantAt}`,
);

// ─────────────────────────────────────────────────────────────────────────────
// AC6 — every removal/demotion path refuses EACH of the three addresses.
//
// verify-f210-3.ts already proves it for cb@webhouse.dk. That is exactly the
// single-address shape this card exists to close, so the assertion is worth
// little here unless all three are driven. The guard is
// `isOwnerIdentity(target.email)`, which covers all three by construction —
// but "by construction" is the claim, and this is the measurement.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[AC6] no route can demote or remove ANY of the three');
const { tenantRoutes } = await import('../src/tenants.js');

// A session for the caller, and a SECOND owner on t-a — without it the
// last-owner rule would refuse the delete anyway and this would pass with the
// owner protection deleted from the source. (verify-f210-3.ts learned that
// the hard way; its own comment records it.)
await client.execute({
  sql: "INSERT OR REPLACE INTO sessions (id, user_id, expires_at) VALUES ('s-o0', 'u-o0', ?)",
  args: [new Date(Date.now() + 3_600_000).toISOString()],
});
await client.execute("INSERT OR REPLACE INTO control_memberships (user_id, tenant_id, role) VALUES ('u-x','t-a','owner')");
assert(await roleOf('u-x', 't-a') === 'owner', 'a second, NON-owner-identity owner is in place on t-a');

async function member(method: 'DELETE' | 'PATCH', userId: string, body?: unknown): Promise<number> {
  const res = await tenantRoutes.request(`/tenants/t-a/members/${userId}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: 'trail-session=s-o0' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.status;
}

// u-o2 was deleted and recreated by AC5, so look the id up rather than
// assuming it is still 'u-o2'.
async function idOf(email: string): Promise<string> {
  const r = await client.execute({ sql: 'SELECT id FROM control_users WHERE email = ?', args: [email] });
  return r.rows.length ? String((r.rows[0] as unknown as { id: string }).id) : '';
}

for (const email of EXPECTED) {
  const uid = await idOf(email);
  assert(uid !== '', `${email} has a user row to attack`);
  if (!uid) continue;
  await client.execute({
    sql: "INSERT OR REPLACE INTO control_memberships (user_id, tenant_id, role) VALUES (?, 't-a', 'owner')",
    args: [uid],
  });

  const delStatus = await member('DELETE', uid);
  assert(delStatus >= 400 && delStatus < 500, `DELETE of ${email} refused`, `status ${delStatus}`);
  assert(await roleOf(uid, 't-a') === 'owner', `and ${email} still reads owner (raw SQL)`, `read back: ${await roleOf(uid, 't-a')}`);

  const patchStatus = await member('PATCH', uid, { role: 'member' });
  assert(patchStatus >= 400 && patchStatus < 500, `PATCH demoting ${email} refused`, `status ${patchStatus}`);
  assert(await roleOf(uid, 't-a') === 'owner', `${email} still owner after the demote attempt`, `read back: ${await roleOf(uid, 't-a')}`);
}

// NEGATIVE CONTROL: the routes are not simply refusing everything. A
// non-owner-identity member CAN be demoted — otherwise every assertion above
// would pass against a route that rejects every request.
await client.execute("INSERT OR REPLACE INTO control_memberships (user_id, tenant_id, role) VALUES ('u-x','t-a','owner')");
const okStatus = await member('PATCH', 'u-x', { role: 'member' });
assert(okStatus < 400, 'NEGATIVE CONTROL: a NON-owner owner CAN be demoted', `status ${okStatus}`);
assert(await roleOf('u-x', 't-a') === 'member', 'and the demotion really landed', `read back: ${await roleOf('u-x', 't-a')}`);

console.log(
  failures === 0
    ? '\n✓ F210.4 verified\n'
    : `\n✗ F210.4: ${failures} assertion(s) failed\n`,
);
process.exit(failures === 0 ? 0 : 1);
