/**
 * F210.3 verification — inviting into a CHOSEN tenant, and its member list.
 *
 * Drives the real Hono routes with real session cookies against a throwaway
 * control.db. Nothing is called directly: the gates being proven live in the
 * handlers, so a test that called the helpers would prove the helpers and not
 * the routes.
 *
 * The load-bearing assertion is the NEGATIVE one. Before this card, every
 * invitation landed in the inviter's own account no matter which customer was
 * on screen — and an invitation that lands SOMEWHERE always looks like it
 * worked. So it is not enough that the invitee appears in the target tenant;
 * they must be ABSENT from the inviter's own.
 *
 * Run: bun run apps/admin-server/scripts/verify-f210-3.ts
 */
import { rmSync } from 'node:fs';

const DB = '/tmp/verify-f210-3.db';
for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s); } catch { /* fresh */ } }
process.env.TRAIL_ADMIN_CONTROL_DB = DB;

const { client } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');
const { tenantRoutes } = await import('../src/tenants.js');
const { inviteRoutes } = await import('../src/invite.js');

let failures = 0;
function assert(cond: boolean, msg: string, detail?: string): void {
  if (!cond) { console.error('  ✗ ' + msg + (detail ? `\n      ${detail}` : '')); failures++; return; }
  console.log('  ✓ ' + msg);
}
async function count(sql: string): Promise<number> {
  const r = await client.execute(sql);
  return Number((r.rows[0] as unknown as { n: number }).n);
}
/** Read a role straight out of SQL — never through the layer that wrote it. */
async function roleOf(userId: string, tenantId: string): Promise<string | null> {
  const r = await client.execute({
    sql: 'SELECT role FROM control_memberships WHERE user_id = ? AND tenant_id = ?',
    args: [userId, tenantId],
  });
  return r.rows.length ? String((r.rows[0] as unknown as { role: string }).role) : null;
}

type Requestable = { request: (path: string, init?: RequestInit) => Promise<Response> };
const call = (
  app: Requestable,
  path: string,
  session: string,
  init: RequestInit = {},
) =>
  app.request(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie: `trail-session=${session}`,
      ...(init.headers ?? {}),
    },
  });

await runMigrations();

// ── Seed: two organisations, two tenants, three people ────────────────────
// org1 is the OWNER's own account; org2 is the customer's. That separation is
// the whole point — a customer's people must never land in org1.
await client.execute("INSERT INTO organizations (id, slug, name) VALUES ('org1','broberg-ai','Broberg.ai')");
await client.execute("INSERT INTO organizations (id, slug, name) VALUES ('org2','fdaa','FD Aalborg')");
await client.execute("INSERT INTO control_users (id, organization_id, email) VALUES ('u-cb','org1','cb@webhouse.dk')");
await client.execute("INSERT INTO control_users (id, organization_id, email) VALUES ('u-lene','org2','lene@fdaalborg.dk')");
await client.execute("INSERT INTO control_users (id, organization_id, email) VALUES ('u-mal','org1','mallory@example.dk')");
await client.execute("INSERT INTO control_tenants (id, organization_id, slug, name) VALUES ('t1','org1','broberg-ai','Broberg.ai')");
await client.execute("INSERT INTO control_tenants (id, organization_id, slug, name) VALUES ('t2','org2','fd-aalborg','FD Aalborg')");
await client.execute("INSERT INTO control_memberships (user_id, tenant_id, role) VALUES ('u-cb','t1','owner')");
await client.execute("INSERT INTO control_memberships (user_id, tenant_id, role) VALUES ('u-cb','t2','owner')");
await client.execute("INSERT INTO control_memberships (user_id, tenant_id, role) VALUES ('u-lene','t2','admin')");
await client.execute("INSERT INTO control_memberships (user_id, tenant_id, role) VALUES ('u-mal','t1','member')");
const far = new Date(Date.now() + 3_600_000).toISOString();
for (const [sid, uid] of [['s-cb','u-cb'],['s-lene','u-lene'],['s-mal','u-mal']]) {
  await client.execute({ sql: 'INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)', args: [sid, uid, far] });
}

// ── AC1 — the invitation is AIMED ────────────────────────────────────────
console.log('\n[AC1] an invite with tenantId lands in THAT tenant');
const inv = await call(inviteRoutes as unknown as Requestable, '/invite', 's-cb', {
  method: 'POST',
  body: JSON.stringify({ email: 'jonas@fdaalborg.dk', name: 'Jonas', role: 'member', tenantId: 't2' }),
});
assert(inv.status === 200, 'invite accepted', `status ${inv.status}: ${await inv.clone().text()}`);

const m2 = await call(tenantRoutes as unknown as Requestable, '/tenants/t2/members', 's-cb');
const body2 = (await m2.json()) as { members: Array<{ email: string; role: string }> };
assert(m2.status === 200, 'members of the customer tenant readable');
assert(
  body2.members.some((m) => m.email === 'jonas@fdaalborg.dk'),
  'the invitee IS a member of FD Aalborg',
  JSON.stringify(body2.members.map((m) => m.email)),
);

const m1 = await call(tenantRoutes as unknown as Requestable, '/tenants/t1/members', 's-cb');
const body1 = (await m1.json()) as { members: Array<{ email: string }> };
assert(
  !body1.members.some((m) => m.email === 'jonas@fdaalborg.dk'),
  'NEGATIVE CONTROL: the invitee is NOT in the inviter’s own tenant',
  JSON.stringify(body1.members.map((m) => m.email)),
);
assert(
  (await client.execute("SELECT organization_id FROM control_users WHERE email='jonas@fdaalborg.dk'"))
    .rows.map((r) => (r as unknown as { organization_id: string }).organization_id)[0] === 'org2',
  'the new user row belongs to the CUSTOMER’s organisation',
);

// ── AC2 — a caller with no standing on the target writes nothing ─────────
console.log('\n[AC2] a stranger cannot aim an invite at a tenant they do not administer');
const before = await count('SELECT count(*) n FROM invitations');
const denied = await call(inviteRoutes as unknown as Requestable, '/invite', 's-mal', {
  method: 'POST',
  body: JSON.stringify({ email: 'intruder@example.dk', role: 'owner', tenantId: 't2' }),
});
const after = await count('SELECT count(*) n FROM invitations');
assert(denied.status === 403, 'refused with 403', `status ${denied.status}`);
assert(before === after, 'and NOTHING was written', `invitations ${before} → ${after}`);
assert(
  await count("SELECT count(*) n FROM control_users WHERE email='intruder@example.dk'") === 0,
  'no user row was created either',
);

// ── AC3 — the owner cannot be removed ────────────────────────────────────
console.log('\n[AC3] the owner identity is untouchable');
// Promote a SECOND owner on t2 first. Without this the owner-identity rule is
// never actually exercised: the last-owner rule would refuse the delete anyway
// and the test would pass with the owner protection deleted from the source.
// Measured — the first version of this file did exactly that, and the mutation
// run is what caught it.
await call(tenantRoutes as unknown as Requestable, '/tenants/t2/members/u-lene', 's-cb', {
  method: 'PATCH', body: JSON.stringify({ role: 'owner' }),
});
assert(await roleOf('u-lene', 't2') === 'owner', 'second owner in place, so the last-owner rule cannot mask this');

const del = await call(tenantRoutes as unknown as Requestable, '/tenants/t2/members/u-cb', 's-cb', { method: 'DELETE' });
assert(del.status >= 400 && del.status < 500, 'DELETE of the owner refused', `status ${del.status}`);
assert(await roleOf('u-cb', 't2') === 'owner', 'and the row still reads owner (raw SQL)', `read back: ${await roleOf('u-cb','t2')}`);
const demote = await call(tenantRoutes as unknown as Requestable, '/tenants/t2/members/u-cb', 's-cb', {
  method: 'PATCH', body: JSON.stringify({ role: 'member' }),
});
assert(demote.status >= 400 && demote.status < 500, 'PATCH demoting the owner refused', `status ${demote.status}`);
assert(await roleOf('u-cb', 't2') === 'owner', 'still owner after the demote attempt');

// ── AC4 — the last owner cannot be removed ───────────────────────────────
console.log('\n[AC4] a tenant cannot be left with no owner');
await client.execute("INSERT INTO organizations (id, slug, name) VALUES ('org3','acme','Acme')");
await client.execute("INSERT INTO control_users (id, organization_id, email) VALUES ('u-a','org3','ann@acme.dk')");
await client.execute("INSERT INTO control_users (id, organization_id, email) VALUES ('u-b','org3','bo@acme.dk')");
await client.execute("INSERT INTO control_tenants (id, organization_id, slug, name) VALUES ('t3','org3','acme','Acme')");
await client.execute("INSERT INTO control_memberships (user_id, tenant_id, role) VALUES ('u-a','t3','owner')");
await client.execute("INSERT INTO control_memberships (user_id, tenant_id, role) VALUES ('u-b','t3','member')");
await client.execute({ sql: 'INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)', args: ['s-a','u-a',far] });

const lastOwner = await call(tenantRoutes as unknown as Requestable, '/tenants/t3/members/u-a', 's-a', { method: 'DELETE' });
const lastOwnerBody = (await lastOwner.json()) as { error?: string };
assert(lastOwner.status >= 400 && lastOwner.status < 500, 'removing the only owner refused', `status ${lastOwner.status}`);
assert(
  /last owner/i.test(lastOwnerBody.error ?? ''),
  'and the message NAMES the reason rather than failing blankly',
  JSON.stringify(lastOwnerBody),
);
assert(await roleOf('u-a', 't3') === 'owner', 'the owner row survived');

const promote = await call(tenantRoutes as unknown as Requestable, '/tenants/t3/members/u-b', 's-a', {
  method: 'PATCH', body: JSON.stringify({ role: 'owner' }),
});
assert(promote.status === 200, 'promoting a second owner works', `status ${promote.status}`);
assert(await roleOf('u-b', 't3') === 'owner', 'read back: bo is owner');
const nowRemovable = await call(tenantRoutes as unknown as Requestable, '/tenants/t3/members/u-a', 's-a', { method: 'DELETE' });
assert(nowRemovable.status === 200, 'NOW the first owner can be removed', `status ${nowRemovable.status}`);
assert(await roleOf('u-a', 't3') === null, 'and the row is gone (raw SQL)');

// ── The member list must carry REAL roles, not a hardcoded label ─────────
console.log('\n[list] roles are read, not invented');
const m2b = await call(tenantRoutes as unknown as Requestable, '/tenants/t2/members', 's-cb');
const b2 = (await m2b.json()) as { members: Array<{ email: string; role: string; locked: boolean }> };
const lene = b2.members.find((m) => m.email === 'lene@fdaalborg.dk');
const cb = b2.members.find((m) => m.email === 'cb@webhouse.dk');
// She was seeded as admin and PROMOTED to owner in AC3, so this asserts the
// list follows the data rather than echoing whatever the seed put there —
// a stronger claim than reading back an unchanged value would be.
assert(lene?.role === 'owner', 'lene reads back as owner after the promotion', `got ${lene?.role}`);
assert(cb?.role === 'owner' && cb?.locked === true, 'the owner row is flagged locked for the UI', JSON.stringify(cb));
// She is an OWNER now and still not locked — proving `locked` tracks the
// owner IDENTITY list, not the role string. A guard keyed on role would
// have locked her here and let a real owner identity through elsewhere.
assert(lene?.locked === false, 'NEGATIVE CONTROL: an owner who is not an owner IDENTITY is not locked', JSON.stringify(lene));

// ── A non-member cannot even READ the list ───────────────────────────────
const peek = await call(tenantRoutes as unknown as Requestable, '/tenants/t2/members', 's-mal');
assert(peek.status === 403, 'a stranger cannot read the member list either', `status ${peek.status}`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
