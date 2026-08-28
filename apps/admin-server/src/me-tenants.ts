/**
 * F215.1 — `GET /api/v1/me/tenants`: which tenants may this caller select?
 *
 * The Web Clipper had no concept of a tenant. Both of its calls sent only a
 * bearer, so the proxy fell back to the key's HOME tenant and the extension
 * could only ever see one customer's Trails — measured on the owner's screen:
 * ten knowledge bases, all broberg-ai, with sanne-andersen and fd-aalborg
 * unreachable from a key that can already reach them.
 *
 * `X-Trail-Tenant` has selected the tenant per request since F191.6. What was
 * missing is a way to ASK which slugs are legal. The local-ingest skill hard-
 * codes them, which is fine in a script and wrong in a picker: a revoked
 * membership would keep appearing until someone shipped a new extension.
 *
 * THIS ANSWERS FROM THE SAME MEMBERSHIP SET THE PROXY ENFORCES. It is a
 * mirror of the JOIN in proxy.ts's resolveApiKey, deliberately — a picker
 * offering a slug the proxy would refuse is worse than no picker, because the
 * refusal arrives at clip time, after the user has chosen.
 *
 * Selector, never grant: listing a tenant here creates no access. A caller
 * whose key does not span tenants gets exactly one row — its home — so a
 * single-tenant key cannot be talked into showing a picker.
 *
 * MUST be mounted BEFORE `app.use('/api/v1/*', proxyToEngine)`, or the proxy
 * forwards it to an engine that knows nothing about memberships.
 */

import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { db, schema } from './db.js';
import { hashApiKey } from './keys.js';

export const meTenantRoutes = new Hono();

const COOKIE_NAME = 'trail-session';

export interface SelectableTenant {
  slug: string;
  name: string;
  /** True for the tenant used when no X-Trail-Tenant header is sent. */
  home: boolean;
}

/**
 * The tenants `userId` may select, home first, then alphabetical so a picker
 * has a stable order across reloads.
 *
 * `homeTenantId` is the tenant used when no header is sent. For an API key
 * that is the key's own tenant. For a browser session there is no such column
 * — control_users belongs to an ORGANISATION, not a tenant — so the caller
 * passes the tenant the proxy would fall back to, and null means "no home,
 * just list the memberships".
 */
export async function selectableTenants(
  userId: string,
  homeTenantId: string | null,
  spansAll: boolean,
): Promise<SelectableTenant[]> {
  const home = homeTenantId
    ? ((await db
        .select({ slug: schema.controlTenants.slug, name: schema.controlTenants.name })
        .from(schema.controlTenants)
        .where(eq(schema.controlTenants.id, homeTenantId))
        .get()) ?? null)
    : null;

  // A key that does not span tenants can only ever reach its home, so listing
  // the user's other memberships would offer choices the proxy refuses.
  if (!spansAll) return home ? [{ slug: home.slug, name: home.name, home: true }] : [];

  const rows = await db
    .select({ slug: schema.controlTenants.slug, name: schema.controlTenants.name })
    .from(schema.controlTenants)
    .innerJoin(
      schema.controlMemberships,
      eq(schema.controlMemberships.tenantId, schema.controlTenants.id),
    )
    .where(eq(schema.controlMemberships.userId, userId))
    .all();

  const seen = new Set<string>();
  const unique = rows.filter((r) => !seen.has(r.slug) && seen.add(r.slug));
  const others = unique
    .filter((r) => r.slug !== home?.slug)
    .sort((a, b) => a.name.localeCompare(b.name));

  return [
    ...(home ? [{ slug: home.slug, name: home.name, home: true }] : []),
    ...others.map((r) => ({ slug: r.slug, name: r.name, home: false })),
  ];
}

meTenantRoutes.get('/v1/me/tenants', async (c) => {
  const authHeader = c.req.header('authorization');
  const presented = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null;

  if (presented?.startsWith('trail_')) {
    const key = await db.query.controlApiKeys.findFirst({
      where: and(
        eq(schema.controlApiKeys.keyHash, hashApiKey(presented)),
        isNull(schema.controlApiKeys.revokedAt),
      ),
    });
    if (!key) return c.json({ error: 'Invalid or revoked API key' }, 401);
    return c.json({
      tenants: await selectableTenants(key.userId, key.tenantId, key.scope === 'all'),
    });
  }

  // Cookie path, so the Admin SPA can use the same endpoint. A browser session
  // is not scoped to one tenant, so every membership is selectable.
  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) return c.json({ error: 'not signed in' }, 401);
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
  });
  if (!session) return c.json({ error: 'session expired' }, 401);
  // The proxy's cookie path falls back to the FIRST membership when the
  // trail-active-tenant cookie is absent or names a tenant the user left, so
  // mirror that as "home" rather than inventing a different default.
  const first = await db
    .select({ tenantId: schema.controlMemberships.tenantId })
    .from(schema.controlMemberships)
    .where(eq(schema.controlMemberships.userId, session.userId))
    .get();

  return c.json({
    tenants: await selectableTenants(session.userId, first?.tenantId ?? null, true),
  });
});
