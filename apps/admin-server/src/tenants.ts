/**
 * F210.1 — create a tenant for a customer.
 *
 * Until this shipped, a Trail account could only come into existence as a
 * side-effect of a human signing in with an unknown email. That meant a
 * customer (FDAA first) could not be given their own isolated Trail at all:
 * building it under the owner's account would have exposed everything in it
 * the moment they were invited, and there is no route that moves a knowledge
 * base between accounts afterwards.
 *
 * Two rules this file exists to keep:
 *
 *  1. The tenant row and the creator's OWNER membership are written together.
 *     A tenant whose creator is not its owner is an orphan nobody can
 *     administer.
 *  2. EVERY owner identity gets owner on the new tenant, not just whoever
 *     happened to click. See @trail/shared's owner-identities.ts — the owner
 *     signs in under three addresses and must reach every tenant under all of
 *     them, including tenants in other organisations.
 */
import { Hono, type Context } from 'hono';
import { eq, and, gt, inArray } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';
import { getCookie } from 'hono/cookie';
import { db, schema } from './db.js';
import { slugify, OWNER_IDENTITIES, isOwnerIdentity } from '@trail/shared';
import { generateKey } from '@broberg/apikey';

const COOKIE_NAME = 'trail-session';

export const tenantRoutes = new Hono();

/** Resolve the signed-in user from the session cookie, or null. */
async function resolveUser(c: Context) {
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

/**
 * Grant `owner` on `tenantId` to every owner identity that has a user row,
 * plus `creatorUserId`. Additive: never demotes, never deletes.
 *
 * Returns the number of rows written, for the caller to log.
 */
export async function grantOwnerMemberships(
  tenantId: string,
  creatorUserId: string,
): Promise<number> {
  const ownerUsers = await db.query.controlUsers.findMany({
    where: inArray(schema.controlUsers.email, [...OWNER_IDENTITIES]),
  });

  const userIds = new Set<string>([creatorUserId, ...ownerUsers.map((u) => u.id)]);
  let written = 0;

  for (const userId of userIds) {
    // INSERT-or-raise, one row at a time: the composite PK makes a plain
    // insert throw on a row that already exists, and "already there" is a
    // normal outcome here (the boot backfill may have written it first).
    const existing = await db.query.controlMemberships.findFirst({
      where: and(
        eq(schema.controlMemberships.userId, userId),
        eq(schema.controlMemberships.tenantId, tenantId),
      ),
    });
    if (!existing) {
      await db.insert(schema.controlMemberships).values({ userId, tenantId, role: 'owner' });
      written++;
    } else if (existing.role !== 'owner') {
      await db
        .update(schema.controlMemberships)
        .set({ role: 'owner' })
        .where(
          and(
            eq(schema.controlMemberships.userId, userId),
            eq(schema.controlMemberships.tenantId, tenantId),
          ),
        );
      written++;
    }
  }
  return written;
}

/**
 * POST /api/control/tenants — create a tenant.
 *
 * Body: { name: string, language?: string, slug?: string }
 * 201 → { id, slug, name, organizationId, ownerRowsWritten }
 * 409 → the slug is taken (and NOTHING was written)
 */
tenantRoutes.post('/tenants', async (c) => {
  const user = await resolveUser(c);
  if (!user) return c.json({ error: 'not signed in' }, 401);

  let body: { name?: string; slug?: string; language?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* ignore — validated below */
  }

  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name required' }, 400);

  // An explicit slug wins, so the caller can see and correct it before
  // submitting — the engine's data directory is named after it and cannot be
  // renamed later.
  const slug = slugify(body.slug?.trim() || name);
  if (!slug) {
    return c.json({ error: 'name must contain at least one letter or digit' }, 400);
  }

  const clash = await db.query.controlTenants.findFirst({
    where: eq(schema.controlTenants.slug, slug),
  });
  if (clash) {
    return c.json({ error: `slug already taken: ${slug}`, slug }, 409);
  }

  const id = randomUUID();
  await db.insert(schema.controlTenants).values({
    id,
    organizationId: user.organizationId,
    slug,
    name,
    language: body.language?.trim() || 'da',
  });

  const ownerRowsWritten = await grantOwnerMemberships(id, user.id);

  // F210.2 — provision the engine side. Control row first, engine second: a
  // tenant that exists here but not on disk is a retryable "provisioning"
  // state, whereas a database on disk with no control row is an orphan nobody
  // can see or clean up.
  //
  // Ships dark. With TRAIL_ENGINE_URL / TRAIL_PROVISION_SECRET unset, the
  // tenant is created and the response says engine: 'not-configured' — it does
  // NOT pretend the tenant is usable. Reporting success for a tenant that will
  // 401 on every request is the exact failure this whole epic exists to stop.
  const engineUrl = process.env.TRAIL_ENGINE_URL;
  const provisionSecret = process.env.TRAIL_PROVISION_SECRET;
  let engine: 'provisioned' | 'not-configured' | string = 'not-configured';

  if (engineUrl && provisionSecret) {
    try {
      /**
       * F210.5 — mint the bearer BEFORE the call and send its hash with it.
       *
       * It used to be minted AFTER a successful provision and stored only
       * here, so the engine had never heard of the key the proxy would then
       * forward: every request answered "Invalid or revoked API key" against
       * a database that had been created and migrated perfectly. The tenant
       * existed and was unreachable, which is the worse of the two failures
       * because it surfaces later and somewhere else.
       *
       * Only the SHA-256 crosses the wire. The engine stores hashes and
       * nothing else, so the raw key has no reason to travel.
       */
      const bearer = generateKey('trail');
      const keyHash = createHash('sha256').update(bearer).digest('hex');

      const res = await fetch(`${engineUrl.replace(/\/$/, '')}/api/admin/tenants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provisionSecret}`,
        },
        body: JSON.stringify({ slug, name, ownerEmail: user.email, keyHash }),
      });
      if (res.ok) {
        engine = 'provisioned';
        await db.insert(schema.tenantEngines).values({
          tenantId: id,
          engineId: new URL(engineUrl).host,
          engineUrl,
          provisionedAt: new Date().toISOString(),
          bearer,
        });
      } else {
        engine = `engine-${res.status}: ${(await res.text()).slice(0, 200)}`;
        console.error(`[tenants] ${slug}: engine provisioning failed — ${engine}`);
      }
    } catch (err) {
      engine = `engine-unreachable: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[tenants] ${slug}: ${engine}`);
    }
  }

  console.log(
    `[tenants] created ${slug} (${id}) for org ${user.organizationId} by ${user.email}; ` +
      `${ownerRowsWritten} owner membership row(s)`,
  );

  return c.json(
    { id, slug, name, organizationId: user.organizationId, ownerRowsWritten, engine },
    201,
  );
});

/** GET /api/control/tenants — the tenants the caller is a member of. */
tenantRoutes.get('/tenants', async (c) => {
  const user = await resolveUser(c);
  if (!user) return c.json({ error: 'not signed in' }, 401);

  const rows = await db
    .select({
      id: schema.controlTenants.id,
      slug: schema.controlTenants.slug,
      name: schema.controlTenants.name,
      language: schema.controlTenants.language,
      organizationId: schema.controlTenants.organizationId,
      role: schema.controlMemberships.role,
    })
    .from(schema.controlMemberships)
    .innerJoin(
      schema.controlTenants,
      eq(schema.controlTenants.id, schema.controlMemberships.tenantId),
    )
    .where(eq(schema.controlMemberships.userId, user.id));

  return c.json({ tenants: rows, isOwner: isOwnerIdentity(user.email) });
});

/* ────────────────────────────────────────────────────────────────────────
 * F210.3 — Members of a tenant.
 *
 * The "Members" item in the per-tenant … menu fired a Coming-soon toast
 * naming F186, which was a dead end: F186 deliberately stubbed it and
 * pointed at F187, and F187 shipped invitations that always land in the
 * INVITER's own account. This is the surface that was missing.
 *
 * The one permission actually enforced here is: you must be owner or admin
 * OF THE TARGET TENANT. Wider RBAC is explicitly out of scope (F210), but
 * without this single gate any signed-in user could write themselves into a
 * customer's account — so it is not optional even in a "roles are display
 * only" world.
 * ──────────────────────────────────────────────────────────────────────── */

export const MEMBER_ROLES = ['owner', 'admin', 'member'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * May `user` administer `tenantId`?
 *
 * An owner identity always may — including in an organisation they do not
 * belong to, which is the deliberate exception the owner rule buys (see
 * owner-identities.ts). Everyone else needs an owner/admin membership row
 * on THIS tenant; belonging to the same organisation is not enough.
 */
async function canAdministerTenant(
  user: { id: string; email: string },
  tenantId: string,
): Promise<boolean> {
  if (isOwnerIdentity(user.email)) return true;
  const m = await db.query.controlMemberships.findFirst({
    where: and(
      eq(schema.controlMemberships.userId, user.id),
      eq(schema.controlMemberships.tenantId, tenantId),
    ),
  });
  return m?.role === 'owner' || m?.role === 'admin';
}

/** How many owner rows does this tenant have? Used to refuse the last one. */
async function ownerCount(tenantId: string): Promise<number> {
  const rows = await db.query.controlMemberships.findMany({
    where: and(
      eq(schema.controlMemberships.tenantId, tenantId),
      eq(schema.controlMemberships.role, 'owner'),
    ),
  });
  return rows.length;
}

/**
 * GET /api/control/tenants/:id/members
 *
 * Returns the real membership rows joined to their user, plus any invitation
 * that has not been accepted yet as a `pending` entry — the mockup shows a
 * pending invite as a row in the same list rather than a separate screen a
 * curator has to remember to open.
 */
tenantRoutes.get('/tenants/:id/members', async (c) => {
  const user = await resolveUser(c);
  if (!user) return c.json({ error: 'not signed in' }, 401);

  const tenantId = c.req.param('id');
  const tenant = await db.query.controlTenants.findFirst({
    where: eq(schema.controlTenants.id, tenantId),
  });
  if (!tenant) return c.json({ error: 'no such tenant' }, 404);
  if (!(await canAdministerTenant(user, tenantId))) {
    return c.json({ error: 'not an owner or admin of this tenant' }, 403);
  }

  const memberships = await db.query.controlMemberships.findMany({
    where: eq(schema.controlMemberships.tenantId, tenantId),
  });
  const users = memberships.length
    ? await db.query.controlUsers.findMany({
        where: inArray(
          schema.controlUsers.id,
          memberships.map((m) => m.userId),
        ),
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const members = memberships
    .map((m) => {
      const u = byId.get(m.userId);
      if (!u) return null;
      return {
        userId: u.id,
        email: u.email,
        name: u.name,
        role: m.role,
        joinedAt: m.createdAt,
        /** Locked rows render their control disabled, with the reason. */
        locked: isOwnerIdentity(u.email),
        isSelf: u.id === user.id,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => a.email.localeCompare(b.email));

  const memberEmails = new Set(members.map((m) => m.email));
  const invites = await db.query.invitations.findMany({
    where: and(
      eq(schema.invitations.organizationId, tenant.organizationId),
      eq(schema.invitations.status, 'pending'),
    ),
  });
  const pending = invites
    .filter((i) => !memberEmails.has(i.email))
    .map((i) => ({ email: i.email, role: i.role, invitedAt: i.createdAt, expiresAt: i.expiresAt }));

  return c.json({ tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, members, pending });
});

/**
 * PATCH /api/control/tenants/:id/members/:userId — change a role.
 *
 * Refuses on an owner identity (any of them — read from the shared list, never
 * a literal address) and on demoting the last owner.
 */
tenantRoutes.patch('/tenants/:id/members/:userId', async (c) => {
  const user = await resolveUser(c);
  if (!user) return c.json({ error: 'not signed in' }, 401);

  const tenantId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  if (!(await canAdministerTenant(user, tenantId))) {
    return c.json({ error: 'not an owner or admin of this tenant' }, 403);
  }

  let body: { role?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* validated below */
  }
  const role = body.role?.trim();
  if (!role || !(MEMBER_ROLES as readonly string[]).includes(role)) {
    return c.json({ error: `role must be one of ${MEMBER_ROLES.join(', ')}` }, 400);
  }

  const target = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.id, targetUserId),
  });
  if (!target) return c.json({ error: 'no such user' }, 404);

  const membership = await db.query.controlMemberships.findFirst({
    where: and(
      eq(schema.controlMemberships.userId, targetUserId),
      eq(schema.controlMemberships.tenantId, tenantId),
    ),
  });
  if (!membership) return c.json({ error: 'not a member of this tenant' }, 404);

  if (isOwnerIdentity(target.email) && role !== 'owner') {
    return c.json({ error: 'the owner cannot be demoted' }, 409);
  }
  if (membership.role === 'owner' && role !== 'owner' && (await ownerCount(tenantId)) <= 1) {
    return c.json(
      { error: 'this is the last owner — promote someone else to owner first' },
      409,
    );
  }

  await db
    .update(schema.controlMemberships)
    .set({ role })
    .where(
      and(
        eq(schema.controlMemberships.userId, targetUserId),
        eq(schema.controlMemberships.tenantId, tenantId),
      ),
    );
  return c.json({ ok: true, userId: targetUserId, role });
});

/**
 * DELETE /api/control/tenants/:id/members/:userId — remove a member.
 *
 * Same two refusals as PATCH. Losing the last owner would leave a tenant
 * nobody can administer, and the customer would need us to repair it by hand.
 */
tenantRoutes.delete('/tenants/:id/members/:userId', async (c) => {
  const user = await resolveUser(c);
  if (!user) return c.json({ error: 'not signed in' }, 401);

  const tenantId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  if (!(await canAdministerTenant(user, tenantId))) {
    return c.json({ error: 'not an owner or admin of this tenant' }, 403);
  }

  const target = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.id, targetUserId),
  });
  if (!target) return c.json({ error: 'no such user' }, 404);

  const membership = await db.query.controlMemberships.findFirst({
    where: and(
      eq(schema.controlMemberships.userId, targetUserId),
      eq(schema.controlMemberships.tenantId, tenantId),
    ),
  });
  if (!membership) return c.json({ error: 'not a member of this tenant' }, 404);

  if (isOwnerIdentity(target.email)) {
    return c.json({ error: 'the owner cannot be removed' }, 409);
  }
  if (membership.role === 'owner' && (await ownerCount(tenantId)) <= 1) {
    return c.json(
      { error: 'this is the last owner — promote someone else to owner first' },
      409,
    );
  }

  await db
    .delete(schema.controlMemberships)
    .where(
      and(
        eq(schema.controlMemberships.userId, targetUserId),
        eq(schema.controlMemberships.tenantId, tenantId),
      ),
    );
  return c.json({ ok: true, removed: targetUserId });
});
