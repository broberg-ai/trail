import { Hono } from 'hono';
import { eq, and, gt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { getCookie } from 'hono/cookie';
import { db, schema } from './db.js';
import { sendMagicLink } from './email.js';

/**
 * F33-precursor of F172 — operator-driven invite.
 *
 * Logged-in user (Christian, or any future admin) types an email +
 * optional display name + role. Endpoint:
 *   - resolves inviter's tenant (Phase 1B: one tenant per org)
 *   - if email exists in same org → re-send magic-link with intent='invite'
 *   - if email exists in OTHER org → 400 (no cross-org poaching)
 *   - if email new → INSERT user in inviter's org with given role + send invite-link
 *
 * Email template stamps inviter name + tenant so the recipient knows
 * what's going on instead of getting an opaque "log in to Trail" mail.
 */

const COOKIE_NAME = 'trail-session';
const MAGIC_LINK_TTL_MIN = 15;
const VALID_ROLES = new Set(['owner', 'admin', 'member', 'service']);

function isoFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
function newToken(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export const inviteRoutes = new Hono();

inviteRoutes.post('/invite', async (c) => {
  // Auth — must be logged in
  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) return c.json({ error: 'not signed in' }, 401);

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(schema.sessions.id, sessionId),
      gt(schema.sessions.expiresAt, new Date().toISOString()),
    ),
  });
  if (!session) return c.json({ error: 'session expired' }, 401);

  const inviter = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.id, session.userId),
  });
  if (!inviter) return c.json({ error: 'inviter user not found' }, 401);

  // Get inviter's tenant — Phase 1B: one tenant per org, pick first
  const tenant = await db.query.controlTenants.findFirst({
    where: eq(schema.controlTenants.organizationId, inviter.organizationId),
  });
  if (!tenant) return c.json({ error: 'inviter has no tenant' }, 400);

  // Parse + validate input
  let body: { email?: string; name?: string; role?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* ignore */
  }
  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim() || null;
  const role = (body.role ?? 'admin').trim();

  if (!email || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return c.json({ error: 'valid email required' }, 400);
  }
  if (!VALID_ROLES.has(role)) {
    return c.json({ error: `role must be one of ${[...VALID_ROLES].join(', ')}` }, 400);
  }

  // Resolve target user
  const existing = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.email, email),
  });

  let targetUserId: string;
  let targetUserName: string | null;
  let action: 'created' | 'reinvited';

  if (existing) {
    if (existing.organizationId !== inviter.organizationId) {
      return c.json(
        { error: 'this email is already a member of another organization' },
        400,
      );
    }
    targetUserId = existing.id;
    targetUserName = existing.name;
    action = 'reinvited';
  } else {
    // INSERT new user in same org
    const newId = `u-${newToken(8)}`;
    await db.insert(schema.controlUsers).values({
      id: newId,
      organizationId: inviter.organizationId,
      email,
      name,
      onboarded: false,
    });
    targetUserId = newId;
    targetUserName = name;
    action = 'created';
  }

  // Generate magic-link with intent='invite'
  const token = newToken(32);
  await db.insert(schema.magicLinks).values({
    token,
    userId: targetUserId,
    intent: 'invite',
    expiresAt: isoFromNow(MAGIC_LINK_TTL_MIN * 60),
  });

  try {
    await sendMagicLink({
      email,
      token,
      intent: 'invite',
      userName: targetUserName ?? undefined,
      inviterName: inviter.name ?? inviter.email,
      tenantName: tenant.name,
    });
  } catch (err) {
    console.error(`[invite] sendMagicLink failed for ${email}:`, err);
    return c.json({ error: 'failed to send invite email' }, 500);
  }

  console.log(
    `[invite] ${inviter.email} ${action} ${email} (role=${role}) → magic-link sent`,
  );
  return c.json({
    ok: true,
    action,
    email,
    targetUserId,
    role,
  });
});
