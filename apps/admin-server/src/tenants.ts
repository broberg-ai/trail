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
import { randomUUID } from 'node:crypto';
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
      const res = await fetch(`${engineUrl.replace(/\/$/, '')}/api/admin/tenants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provisionSecret}`,
        },
        body: JSON.stringify({ slug }),
      });
      if (res.ok) {
        engine = 'provisioned';
        // The bearer the admin proxy will forward for this tenant's /api/v1
        // calls. Minted here because the tenant did not exist a moment ago,
        // so there was nothing to mint it against.
        await db.insert(schema.tenantEngines).values({
          tenantId: id,
          engineId: new URL(engineUrl).host,
          engineUrl,
          provisionedAt: new Date().toISOString(),
          bearer: generateKey('trail'),
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
