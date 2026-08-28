import { Hono, type Context } from 'hono';
import { eq, and, gt, isNull, desc } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { generateKey, hashKey, makeKeyPreview } from '@broberg/apikey';
import { getCookie } from 'hono/cookie';
import { db, schema } from './db.js';

/**
 * F188 — personal API keys, admin-level.
 *
 * A personal key is a `trail_<64hex>` bearer bound to the logged-in
 * control.db user + their active tenant. It authenticates at the admin
 * proxy (see proxy.ts::resolveApiKey) as a drop-in alternative to the
 * session cookie — the proxy then forwards to the engine with the same
 * per-tenant bearer a cookie request would use. We persist only the
 * sha256 hash + a short display prefix; the raw key is shown once.
 *
 * Why admin-level and not the engine's existing /api/v1/api-keys: the
 * proxy collapses every admin user onto one shared per-tenant bearer, so
 * engine-side keys can't be attributed to the actual logged-in user. See
 * F188 plan-doc "Option B".
 */

const COOKIE_NAME = 'trail-session';
const KEY_PREFIX_LEN = 14; // "trail_" + 8 hex chars

function newToken(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}
// F010 — mint + hash now delegate to @broberg/apikey (the fleet primitive that
// owns prefixed minting + constant-time verify). Byte-identical to the prior
// hand-rolled form (`trail_`+randomBytes(32).hex; sha256 hex), so every key
// already stored keeps verifying — only the source of the primitive changed.
function generateRawKey(): string {
  return generateKey('trail');
}
export function hashApiKey(raw: string): string {
  return hashKey(raw);
}

/** Resolve the signed-in user + their active tenant from the session
 *  cookie. Active tenant comes from the `trail-active-tenant` cookie;
 *  F193 — gated on control_memberships (NOT org), so a minted key can
 *  only target a tenant the user actually belongs to. Falls back to the
 *  user's first membership tenant. */
async function resolveContext(c: Context) {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) return null;
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(schema.sessions.id, sessionId),
      gt(schema.sessions.expiresAt, new Date().toISOString()),
    ),
  });
  if (!session) return null;
  const user = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.id, session.userId),
  });
  if (!user) return null;

  const memberships = await db
    .select({ tenantId: schema.controlMemberships.tenantId })
    .from(schema.controlMemberships)
    .where(eq(schema.controlMemberships.userId, user.id))
    .all();
  const memberTenantIds = new Set(memberships.map((m) => m.tenantId));
  if (memberTenantIds.size === 0) return null;

  type CT = typeof schema.controlTenants.$inferSelect;
  const activeSlug = getCookie(c, 'trail-active-tenant');
  let tenant: CT | null = activeSlug
    ? ((await db.query.controlTenants.findFirst({
        where: eq(schema.controlTenants.slug, activeSlug),
      })) ?? null)
    : null;
  if (tenant && !memberTenantIds.has(tenant.id)) tenant = null;
  if (!tenant) {
    const firstId = memberships[0]?.tenantId;
    tenant = firstId
      ? ((await db.query.controlTenants.findFirst({
          where: eq(schema.controlTenants.id, firstId),
        })) ?? null)
      : null;
  }
  if (!tenant) return null;
  return { user, tenant };
}

export const apiKeyRoutes = new Hono();

/** Create a personal API key — raw value returned ONCE. */
apiKeyRoutes.post('/api-keys', async (c) => {
  const ctx = await resolveContext(c);
  if (!ctx) return c.json({ error: 'not signed in' }, 401);

  let body: { name?: string; scope?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* ignore */
  }
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name is required' }, 400);

  // F215.2 — the caller may ask for a key that spans the tenants they are
  // ALREADY a member of. Until today this was hardcoded to 'full', so the only
  // 'all' key in existence was one minted before the route was written and
  // impossible to reproduce — which made F215.1's tenant picker correct and
  // unreachable, since it renders only when the caller can see more than one.
  //
  // SELECTOR, NOT GRANT. 'all' confers no access: every request still resolves
  // the tenant against control_memberships (proxy.ts resolveApiKey, and
  // /my-tenants below). Revoke the membership and this key narrows on the next
  // request, untouched. So the choice widens what a key may ASK for, never what
  // its user may reach.
  //
  // The default stays 'full'. A caller that omits the field must get exactly
  // the key it got yesterday — silently widening every script written before
  // this change is the failure worth engineering against. And an unrecognised
  // value is a 400, never a coerce-to-default: handing back a NARROWER key than
  // was asked for produces a failure later, somewhere else, looking like an
  // access problem (the shape of F210.5 and F214.1, both this week).
  const scope = body.scope ?? 'full';
  if (scope !== 'full' && scope !== 'all') {
    return c.json(
      { error: `scope: must be 'full' (this tenant only) or 'all' (every tenant you are a member of)` },
      400,
    );
  }

  const raw = generateRawKey();
  const id = `key-${newToken(8)}`;
  await db.insert(schema.controlApiKeys).values({
    id,
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    prefix: makeKeyPreview(raw, KEY_PREFIX_LEN),
    keyHash: hashApiKey(raw),
    scope,
    name,
  });

  console.log(`[api-keys] ${ctx.user.email} created key "${name}" (${id}, scope=${scope})`);
  // raw key is returned ONCE — never retrievable again.
  return c.json({ id, name, scope, prefix: makeKeyPreview(raw, KEY_PREFIX_LEN), key: raw }, 201);
});

/** List the user's non-revoked keys. Never returns the hash or raw key. */
apiKeyRoutes.get('/api-keys', async (c) => {
  const ctx = await resolveContext(c);
  if (!ctx) return c.json({ error: 'not signed in' }, 401);

  const rows = await db
    .select({
      id: schema.controlApiKeys.id,
      name: schema.controlApiKeys.name,
      prefix: schema.controlApiKeys.prefix,
      // F215.2 — without this the list cannot distinguish a key that spans
      // tenants from one that does not, which is why the only such key in the
      // product carried its scope in its NAME ("local-ingest (all tenants)").
      scope: schema.controlApiKeys.scope,
      createdAt: schema.controlApiKeys.createdAt,
      lastUsedAt: schema.controlApiKeys.lastUsedAt,
    })
    .from(schema.controlApiKeys)
    .where(
      and(
        eq(schema.controlApiKeys.userId, ctx.user.id),
        isNull(schema.controlApiKeys.revokedAt),
      ),
    )
    .orderBy(desc(schema.controlApiKeys.createdAt))
    .all();

  return c.json({ keys: rows });
});

/**
 * F191.6 — list the tenants the KEY's user can drop into, for the Ingest
 * Station's tenant picker. Key-authed (the Station has no session cookie), and
 * NOT proxied to an engine — it answers from control.db directly. A
 * `scope='all'` key returns every tenant the user has a `control_memberships`
 * row for; any other (single-tenant) key returns ONLY its home tenant, so a
 * legacy key can't enumerate the user's whole tenant set.
 */
apiKeyRoutes.get('/my-tenants', async (c) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.toLowerCase().startsWith('bearer ')) {
    return c.json({ error: 'no key' }, 401);
  }
  const presented = authHeader.slice(7).trim();
  if (!presented.startsWith('trail_')) return c.json({ error: 'no key' }, 401);

  const key = await db.query.controlApiKeys.findFirst({
    where: and(
      eq(schema.controlApiKeys.keyHash, hashApiKey(presented)),
      isNull(schema.controlApiKeys.revokedAt),
    ),
  });
  if (!key) return c.json({ error: 'invalid key' }, 401);

  if (key.scope !== 'all') {
    const home = await db.query.controlTenants.findFirst({
      where: eq(schema.controlTenants.id, key.tenantId),
    });
    return c.json({
      scope: key.scope,
      tenants: home ? [{ slug: home.slug, name: home.name, role: 'member' }] : [],
    });
  }

  const rows = await db
    .select({
      slug: schema.controlTenants.slug,
      name: schema.controlTenants.name,
      role: schema.controlMemberships.role,
    })
    .from(schema.controlMemberships)
    .innerJoin(
      schema.controlTenants,
      eq(schema.controlTenants.id, schema.controlMemberships.tenantId),
    )
    .where(eq(schema.controlMemberships.userId, key.userId))
    .all();

  return c.json({ scope: 'all', tenants: rows });
});

/** Soft-revoke a key the caller owns. */
apiKeyRoutes.delete('/api-keys/:id', async (c) => {
  const ctx = await resolveContext(c);
  if (!ctx) return c.json({ error: 'not signed in' }, 401);

  const id = c.req.param('id');
  const result = await db
    .update(schema.controlApiKeys)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(schema.controlApiKeys.id, id),
        eq(schema.controlApiKeys.userId, ctx.user.id),
        isNull(schema.controlApiKeys.revokedAt),
      ),
    )
    .run();
  if (result.rowsAffected === 0) {
    return c.json({ error: 'not found or already revoked' }, 404);
  }

  console.log(`[api-keys] ${ctx.user.email} revoked key ${id}`);
  return c.json({ ok: true, id });
});
