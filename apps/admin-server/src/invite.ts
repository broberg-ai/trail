import { Hono, type Context } from 'hono';
import { eq, and, gt, desc, lt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { getCookie } from 'hono/cookie';
import { db, schema } from './db.js';
import { sendMagicLink } from './email.js';
import { isOwnerIdentity } from '@trail/shared';

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
const INVITATION_TTL_DAYS = 7; // F187 §Q4 — pending invitation record lifetime
const VALID_ROLES = new Set(['owner', 'admin', 'member', 'service']);

function isoFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
function newToken(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Resolve the signed-in user from the session cookie. Returns the
 * control_users row (carries organizationId) or null when not
 * authenticated / session expired.
 */
async function resolveInviter(c: Context) {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) return null;
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(schema.sessions.id, sessionId),
      gt(schema.sessions.expiresAt, new Date().toISOString()),
    ),
  });
  if (!session) return null;
  return (
    (await db.query.controlUsers.findFirst({
      where: eq(schema.controlUsers.id, session.userId),
    })) ?? null
  );
}

export const inviteRoutes = new Hono();

inviteRoutes.post('/invite', async (c) => {
  // Auth — must be logged in
  const inviter = await resolveInviter(c);
  if (!inviter) return c.json({ error: 'not signed in' }, 401);

  // Parse + validate input
  let body: { email?: string; name?: string; role?: string; tenantId?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* ignore */
  }
  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim() || null;
  const role = (body.role ?? 'admin').trim();
  const wantedTenantId = body.tenantId?.trim() || null;

  /**
   * F210.3 — the invitation is AIMED, not defaulted.
   *
   * Without `tenantId` this keeps the pre-F210.3 behaviour exactly: the
   * inviter's own first tenant. That matters because the standalone /invite
   * form still posts without one, and a route that started refusing it would
   * break a working page to add a feature.
   *
   * WITH `tenantId`, the caller must be able to administer THAT tenant. This
   * is the one permission gate in an epic that otherwise ships no RBAC — and
   * it is not optional: without it any signed-in user could post the id of a
   * customer's tenant and write a person of their choosing into it.
   */
  let tenant;
  if (wantedTenantId) {
    tenant = await db.query.controlTenants.findFirst({
      where: eq(schema.controlTenants.id, wantedTenantId),
    });
    if (!tenant) return c.json({ error: 'no such tenant' }, 404);

    let allowed = isOwnerIdentity(inviter.email);
    if (!allowed) {
      const m = await db.query.controlMemberships.findFirst({
        where: and(
          eq(schema.controlMemberships.userId, inviter.id),
          eq(schema.controlMemberships.tenantId, wantedTenantId),
        ),
      });
      allowed = m?.role === 'owner' || m?.role === 'admin';
    }
    // Refuse BEFORE anything is written — AC2 measures the invitations row
    // count either side of this call and it must not move.
    if (!allowed) {
      return c.json({ error: 'not an owner or admin of this tenant' }, 403);
    }
  } else {
    tenant = await db.query.controlTenants.findFirst({
      where: eq(schema.controlTenants.organizationId, inviter.organizationId),
    });
    if (!tenant) return c.json({ error: 'inviter has no tenant' }, 400);
  }
  // Everything below writes into the TENANT's organisation, not the
  // inviter's. When no tenantId was given the two are the same, so the old
  // behaviour is unchanged.
  const targetOrgId = tenant.organizationId;

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
    // One email still belongs to one organisation — except the owner's own
    // identities, which are deliberately allowed everywhere (F210.4).
    if (existing.organizationId !== targetOrgId && !isOwnerIdentity(email)) {
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
      organizationId: targetOrgId,
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

  // F187 — record/refresh the pending invitation row so it is listable
  // and revocable. Upsert by (org, email): re-inviting refreshes the
  // existing row's role + expiry and flips it back to pending.
  const expiresAt = isoFromNow(INVITATION_TTL_DAYS * 24 * 60 * 60);
  const existingInvite = await db.query.invitations.findFirst({
    where: and(
      eq(schema.invitations.organizationId, targetOrgId),
      eq(schema.invitations.email, email),
    ),
  });
  let invitationId: string;
  if (existingInvite) {
    invitationId = existingInvite.id;
    await db
      .update(schema.invitations)
      .set({
        role,
        status: 'pending',
        invitedByUserId: inviter.id,
        expiresAt,
        acceptedAt: null,
        acceptedUserId: null,
      })
      .where(eq(schema.invitations.id, invitationId))
      .run();
  } else {
    invitationId = `inv-${newToken(8)}`;
    await db.insert(schema.invitations).values({
      id: invitationId,
      organizationId: targetOrgId,
      email,
      role,
      invitedByUserId: inviter.id,
      status: 'pending',
      expiresAt,
    });
  }

  /**
   * F210.3 — write the membership on the TENANT now, not on accept.
   *
   * The member list has to show the invitee immediately: the surface a
   * curator looks at after inviting someone is the member list, and an
   * invite that leaves no trace there reads as an invite that failed. The
   * pending state comes from the invitation row, which the list joins.
   *
   * An owner identity is never demoted by this: their row stays `owner`.
   */
  const already = await db.query.controlMemberships.findFirst({
    where: and(
      eq(schema.controlMemberships.userId, targetUserId),
      eq(schema.controlMemberships.tenantId, tenant.id),
    ),
  });
  if (!already) {
    await db.insert(schema.controlMemberships).values({
      userId: targetUserId,
      tenantId: tenant.id,
      role: isOwnerIdentity(email) ? 'owner' : role,
    });
  }

  console.log(
    `[invite] ${inviter.email} ${action} ${email} (role=${role}) → tenant ${tenant.slug}, magic-link sent, invitation ${invitationId} pending`,
  );
  return c.json({
    ok: true,
    action,
    email,
    targetUserId,
    role,
    invitationId,
    tenantId: tenant.id,
  });
});

/**
 * F187 — list the org's invitations (pending first, then most recent).
 * Lazily expires stale pending rows so the "Pending" count stays honest.
 */
inviteRoutes.get('/invitations', async (c) => {
  const inviter = await resolveInviter(c);
  if (!inviter) return c.json({ error: 'not signed in' }, 401);

  // Lazy-expire: flip pending rows past their window to 'expired'.
  await db
    .update(schema.invitations)
    .set({ status: 'expired' })
    .where(
      and(
        eq(schema.invitations.organizationId, inviter.organizationId),
        eq(schema.invitations.status, 'pending'),
        lt(schema.invitations.expiresAt, new Date().toISOString()),
      ),
    )
    .run();

  const rows = await db
    .select()
    .from(schema.invitations)
    .where(eq(schema.invitations.organizationId, inviter.organizationId))
    .orderBy(desc(schema.invitations.createdAt))
    .all();

  // Inviter display-name lookup (small org → cheap to map in memory).
  const inviterIds = [...new Set(rows.map((r) => r.invitedByUserId))];
  const inviters = inviterIds.length
    ? await db.query.controlUsers.findMany({
        where: (u, { inArray }) => inArray(u.id, inviterIds),
      })
    : [];
  const nameById = new Map(inviters.map((u) => [u.id, u.name ?? u.email]));

  return c.json({
    invitations: rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      status: r.status,
      invitedBy: nameById.get(r.invitedByUserId) ?? null,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      acceptedAt: r.acceptedAt,
    })),
  });
});

/**
 * F187 — revoke a pending invitation. Any signed-in member of the
 * owning org may revoke (no role-gate yet — RBAC is Phase 2+). The
 * magic-link's 15-min TTL means an unused link is harmless regardless.
 */
inviteRoutes.delete('/invitations/:id', async (c) => {
  const inviter = await resolveInviter(c);
  if (!inviter) return c.json({ error: 'not signed in' }, 401);

  const id = c.req.param('id');
  const invite = await db.query.invitations.findFirst({
    where: eq(schema.invitations.id, id),
  });
  if (!invite || invite.organizationId !== inviter.organizationId) {
    return c.json({ error: 'invitation not found' }, 404);
  }
  if (invite.status !== 'pending') {
    return c.json({ error: `cannot revoke a ${invite.status} invitation` }, 409);
  }

  await db
    .update(schema.invitations)
    .set({ status: 'revoked' })
    .where(eq(schema.invitations.id, id))
    .run();

  console.log(`[invite] ${inviter.email} revoked invitation ${id} (${invite.email})`);
  return c.json({ ok: true, id, status: 'revoked' });
});
