/**
 * F187 verification — exercises the invitation lifecycle end-to-end
 * through the REAL Hono route handlers (invite.ts + auth.ts) against a
 * throwaway control.db, asserting observable DB effects at each step.
 *
 * Per CLAUDE.md "Verification before 'this works'": this proves runtime
 * behaviour (create → list → accept → revoke → re-invite), not just that
 * the code typechecks.
 *
 * Run:  bun run apps/admin-server/scripts/verify-f187.ts
 *
 * No RESEND_API_KEY is needed — sendMagicLink() no-ops (console.warn) when
 * the key is unset, so /invite completes without sending real mail.
 */

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// MUST set the DB path before importing db.ts — it opens the libsql client
// at module-eval time from this env var.
const DB_PATH = join(tmpdir(), `verify-f187-${process.pid}-${Date.now()}.db`);
process.env.TRAIL_ADMIN_CONTROL_DB = DB_PATH;
delete process.env.RESEND_API_KEY; // force the no-op email path

const { db, schema, client } = await import('../src/db.js');
const { runMigrations } = await import('../src/migrations.js');
const { inviteRoutes } = await import('../src/invite.js');
const { authRoutes } = await import('../src/auth.js');
const { Hono } = await import('hono');

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

// Test app mounts the routes exactly as index.ts does.
const app = new Hono();
app.route('/api/control', inviteRoutes);
app.route('/auth', authRoutes);

const ORG = 'org-verify';
const INVITER = 'u-inviter';
const SESSION = 'sess-verify-123';
const COOKIE = `trail-session=${SESSION}`;

async function seed() {
  await db.insert(schema.organizations).values({ id: ORG, slug: 'verify-org', name: 'Verify Org' });
  await db.insert(schema.controlTenants).values({
    id: 't-verify', organizationId: ORG, slug: 'verify-org', name: 'Verify Org', language: 'en',
  });
  await db.insert(schema.controlUsers).values({
    id: INVITER, organizationId: ORG, email: 'inviter@verify.test', name: 'Inviter', onboarded: true,
  });
  await db.insert(schema.sessions).values({
    id: SESSION, userId: INVITER,
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
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
function del(path: string) {
  return app.request(path, { method: 'DELETE', headers: { Cookie: COOKIE } });
}

async function run() {
  console.log(`[verify-f187] temp db: ${DB_PATH}`);
  await runMigrations();
  await seed();

  // 1) Migration landed the table.
  const cols = await client.execute("PRAGMA table_info('invitations')");
  const colNames = cols.rows.map((r) => (r as { name?: string }).name);
  console.log('\n1. invitations table');
  assert(colNames.includes('status') && colNames.includes('expires_at'), 'table has status + expires_at columns');

  // 2) POST /invite creates a pending invitation.
  console.log('\n2. POST /invite (new email)');
  const r2 = await post('/api/control/invite', { email: 'alice@verify.test', role: 'member' });
  const b2 = (await r2.json()) as { ok?: boolean; action?: string; invitationId?: string };
  assert(r2.status === 200 && b2.ok === true, 'returns 200 ok');
  assert(b2.action === 'created', `action=created (got ${b2.action})`);
  const aliceInvite = await db.query.invitations.findFirst({
    where: (i, { eq }) => eq(i.email, 'alice@verify.test'),
  });
  assert(!!aliceInvite && aliceInvite.status === 'pending', 'row exists, status=pending');
  const ttlDays = aliceInvite ? (new Date(aliceInvite.expiresAt).getTime() - Date.now()) / 86400_000 : 0;
  assert(ttlDays > 6.9 && ttlDays < 7.1, `expires_at ≈ now+7d (got ${ttlDays.toFixed(2)}d)`);

  // 3) GET /invitations lists it.
  console.log('\n3. GET /invitations');
  const r3 = await get('/api/control/invitations');
  const b3 = (await r3.json()) as { invitations: Array<{ email: string; status: string; invitedBy: string | null }> };
  assert(b3.invitations.length === 1, `1 invitation listed (got ${b3.invitations.length})`);
  assert(b3.invitations[0]?.invitedBy === 'Inviter', 'invitedBy resolves to inviter name');

  // 4) Consuming the invite magic-link accepts the invitation.
  console.log('\n4. accept via /auth/verify (magic-link consumed)');
  const aliceUser = await db.query.controlUsers.findFirst({
    where: (u, { eq }) => eq(u.email, 'alice@verify.test'),
  });
  assert(!!aliceUser && aliceUser.organizationId === ORG, 'invitee auto-created in inviter org');
  const link = await db.query.magicLinks.findFirst({
    where: (m, { eq, and }) => and(eq(m.userId, aliceUser!.id), eq(m.intent, 'invite')),
  });
  assert(!!link, 'invite magic-link exists for invitee');
  const r4 = await get(`/auth/verify?token=${link!.token}`);
  assert(r4.status === 302, `verify redirects (got ${r4.status})`);
  const acceptedInvite = await db.query.invitations.findFirst({
    where: (i, { eq }) => eq(i.email, 'alice@verify.test'),
  });
  assert(acceptedInvite?.status === 'accepted', 'invitation status → accepted');
  assert(acceptedInvite?.acceptedUserId === aliceUser!.id, 'accepted_user_id set to invitee');

  // 5) Revoke a pending invitation.
  console.log('\n5. DELETE /invitations/:id (revoke)');
  await post('/api/control/invite', { email: 'bob@verify.test', role: 'admin' });
  const bobInvite = await db.query.invitations.findFirst({
    where: (i, { eq }) => eq(i.email, 'bob@verify.test'),
  });
  const r5 = await del(`/api/control/invitations/${bobInvite!.id}`);
  assert(r5.status === 200, `revoke returns 200 (got ${r5.status})`);
  const revoked = await db.query.invitations.findFirst({
    where: (i, { eq }) => eq(i.id, bobInvite!.id),
  });
  assert(revoked?.status === 'revoked', 'status → revoked');
  // Cannot revoke a non-pending invite.
  const r5b = await del(`/api/control/invitations/${bobInvite!.id}`);
  assert(r5b.status === 409, `re-revoke rejected with 409 (got ${r5b.status})`);

  // 6) Re-invite refreshes the existing row back to pending.
  console.log('\n6. re-invite refreshes existing row');
  const r6 = await post('/api/control/invite', { email: 'bob@verify.test', role: 'member' });
  const b6 = (await r6.json()) as { action?: string; invitationId?: string };
  assert(b6.action === 'reinvited', `action=reinvited (got ${b6.action})`);
  assert(b6.invitationId === bobInvite!.id, 'same invitation row reused (no duplicate)');
  const refreshed = await db.query.invitations.findFirst({
    where: (i, { eq }) => eq(i.id, bobInvite!.id),
  });
  assert(refreshed?.status === 'pending', 'status back to pending');
  assert(refreshed?.role === 'member', 'role updated to member');

  // 7) Auth guard — no cookie → 401.
  console.log('\n7. auth guard');
  const r7 = await app.request('/api/control/invitations');
  assert(r7.status === 401, `unauthenticated list → 401 (got ${r7.status})`);
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
