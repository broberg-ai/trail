import { Hono, type Context } from 'hono';
import { eq, and, gt, isNull, desc } from 'drizzle-orm';
import { randomBytes, createHash } from 'node:crypto';
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
function generateRawKey(): string {
  return `trail_${newToken(32)}`;
}
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Resolve the signed-in user + their active tenant from the session
 *  cookie. Active tenant comes from the `trail-active-tenant` cookie
 *  (validated against the user's org), else the first tenant in the org. */
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

  const activeSlug = getCookie(c, 'trail-active-tenant');
  let tenant = activeSlug
    ? await db.query.controlTenants.findFirst({
        where: and(
          eq(schema.controlTenants.slug, activeSlug),
          eq(schema.controlTenants.organizationId, user.organizationId),
        ),
      })
    : null;
  if (!tenant) {
    tenant = await db.query.controlTenants.findFirst({
      where: eq(schema.controlTenants.organizationId, user.organizationId),
    });
  }
  if (!tenant) return null;
  return { user, tenant };
}

export const apiKeyRoutes = new Hono();

/** Create a personal API key — raw value returned ONCE. */
apiKeyRoutes.post('/api-keys', async (c) => {
  const ctx = await resolveContext(c);
  if (!ctx) return c.json({ error: 'not signed in' }, 401);

  let body: { name?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* ignore */
  }
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const raw = generateRawKey();
  const id = `key-${newToken(8)}`;
  await db.insert(schema.controlApiKeys).values({
    id,
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    prefix: raw.slice(0, KEY_PREFIX_LEN),
    keyHash: hashApiKey(raw),
    scope: 'full',
    name,
  });

  console.log(`[api-keys] ${ctx.user.email} created key "${name}" (${id})`);
  // raw key is returned ONCE — never retrievable again.
  return c.json({ id, name, prefix: raw.slice(0, KEY_PREFIX_LEN), key: raw }, 201);
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
