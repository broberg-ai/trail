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
 *
 * F215.3 — the membership query itself now lives in `tenant-selection.ts`,
 * shared with `/api/control/my-tenants`. This route only projects it onto the
 * wire shape the Web Clipper parses.
 */

import { Hono } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { db, schema } from './db.js';
import { hashApiKey } from './keys.js';
import { selectableTenants, type SelectableTenant } from './tenant-selection.js';

export const meTenantRoutes = new Hono();

const COOKIE_NAME = 'trail-session';

/** What the Web Clipper parses. `role` is deliberately not on this shape. */
const onTheWire = (t: SelectableTenant) => ({ slug: t.slug, name: t.name, home: t.home });

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
    const tenants = await selectableTenants(key.userId, key.tenantId, key.scope === 'all');
    return c.json({ tenants: tenants.map(onTheWire) });
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

  const tenants = await selectableTenants(session.userId, first?.tenantId ?? null, true);
  return c.json({ tenants: tenants.map(onTheWire) });
});
