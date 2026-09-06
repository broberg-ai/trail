import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { createHash, timingSafeEqual } from 'node:crypto';
import { sessions, users, tenants, apiKeys, type TrailDatabase } from '@trail/db';
import { PARTNER_SCOPE, partnerAllows } from './partner-scope.js';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { INGEST_USER_ID } from '../bootstrap/ingest-user.js';
import { resolveBearer, resolveSession } from '../lib/key-index.js';
import type { TenantPool } from '../lib/tenant-pool.js';

const MULTI_TENANT = process.env.TRAIL_MULTI_TENANT === '1';

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'owner' | 'curator' | 'reader';
  onboarded: boolean;
}

export interface AuthTenant {
  id: string;
  slug: string;
  name: string;
  plan: 'hobby' | 'pro' | 'business' | 'enterprise';
}

const USER_COLUMNS = {
  id: users.id,
  tenantId: users.tenantId,
  email: users.email,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  role: users.role,
  onboarded: users.onboarded,
} as const;

const TENANT_COLUMNS = {
  id: tenants.id,
  slug: tenants.slug,
  name: tenants.name,
  plan: tenants.plan,
} as const;

/**
 * F40.2a-D — pool-driven tenant DB selection when TRAIL_MULTI_TENANT=1.
 *
 * Given a tenant_slug from the key-index, look up the pre-opened DB
 * handle in the pool. Returns null on miss (slug exists in index but
 * pool doesn't have it — boot-state mismatch, treated as auth failure
 * rather than 500 so we don't leak which slugs the engine knows about).
 */
/**
 * F259.6 — «Invalid or revoked API key» var en LØGN når kunden var ude af drift.
 *
 * MÅLT 6/9, på ejerens egen telefon: broberg-ai var udeladt af puljen fordi
 * dens base var i baglås, og skærmen sagde «Something went wrong — Invalid or
 * revoked API key». Nøglen fejlede ingenting. Beskeden sendte ham efter et
 * nøgleproblem der ikke fandtes, mens den ægte årsag stod i motorens log.
 *
 * Den gamle begrundelse — «401 keeps us from leaking which slugs we know
 * about» — gælder ikke her: vi er kun nået hertil fordi opkalderens EGEN
 * legitimation slog op i indekset og navngav netop denne kunde. Der er intet
 * at lække; de ved det allerede. Det eneste 401 opnåede var at skjule årsagen
 * for den ene person der havde brug for den.
 *
 * 503, ikke 401, fordi det er en midlertidig tilstand på VORES side — og
 * klienten skal prøve igen, ikke skifte nøgle.
 */
function tenantUdeAfDrift(c: Context, slug: string) {
  return c.json(
    {
      error: 'Tenant temporarily unavailable',
      tenant: slug,
      detail:
        'The engine could not open this tenant database at boot and is retrying. ' +
        'Your credential is valid — nothing to change on your side.',
    },
    503,
  );
}

function resolveTenantDb(c: Context, tenantSlug: string): TrailDatabase | null {
  const pool = c.get('tenantPool') as TenantPool | undefined;
  if (!pool) return null;
  return pool.get(tenantSlug) ?? null;
}

/**
 * F201.2 — endpoint allowlist for 'ambient'-scoped API keys (minted by the
 * device-auth approval). An ambient capture device may ONLY write queue
 * candidates and read search/chat — never keys, settings, sources, or any
 * admin surface. 'full' (the column default) and any unknown value keep
 * the historical unrestricted behaviour, so existing keys are unaffected.
 */
const AMBIENT_ALLOWED: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/api\/v1\/queue\/candidates$/ },
  // F201.13 — the source-first ambient path. Kept alongside /queue/candidates
  // (no naked cutover) so the app can migrate while the old path still works.
  { method: 'POST', pattern: /^\/api\/v1\/knowledge-bases\/[^/]+\/ambient-source$/ },
  { method: 'GET', pattern: /^\/api\/v1\/knowledge-bases\/[^/]+\/search$/ },
  { method: 'POST', pattern: /^\/api\/v1\/chat$/ },
  // F201.13 — read the KB's own name/slug so the menubar app can refresh its
  // "writing to" label after a rename (name + slug only — NOT the full-row
  // GET /knowledge-bases/:id, which would expose settings the device shouldn't read).
  { method: 'GET', pattern: /^\/api\/v1\/knowledge-bases\/[^/]+\/name$/ },
];

/**
 * F205.1 — returns a DECISION rather than a boolean so a refusal can say why.
 * An opaque 403 leaves an external partner integrator guessing; they cannot
 * read our source to work it out.
 *
 * `kbId` is the knowledge base a 'partner' key is bound to (NULL for every
 * other scope). Unknown scopes still fall through to unrestricted, which is
 * what keeps every pre-existing key behaving exactly as before.
 */
function scopeAllows(
  scope: string,
  kbId: string | null,
  method: string,
  path: string,
): { allowed: boolean; reason?: string } {
  if (scope === PARTNER_SCOPE) return partnerAllows(kbId, method, path);
  if (scope !== 'ambient') return { allowed: true };
  const ok = AMBIENT_ALLOWED.some((r) => r.method === method && r.pattern.test(path));
  return ok ? { allowed: true } : { allowed: false, reason: 'ambient key scope' };
}

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  // `trail` is the primary DB at request-entry. The multi-tenant branch
  // below may override it via `c.set('trail', tenantDb)` once the caller
  // is resolved to a specific tenant.
  let trail = c.get('trail') as TrailDatabase;

  // Bearer token path — two sub-variants:
  //   (a) trail_<64hex>  → DB-backed API key (F111, per-user, revocable)
  //   (b) anything else  → legacy TRAIL_INGEST_TOKEN env-var comparison
  const authHeader = c.req.header('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const presented = authHeader.slice(7).trim();

    // (a) DB-backed API key
    if (presented.startsWith('trail_')) {
      const hash = createHash('sha256').update(presented).digest('hex');

      // F40.2a-D — flag-gated multi-tenant path. Look up the bearer in
      // the global key-index FIRST to learn which tenant DB to open,
      // then load user/tenant rows from THAT DB. No iteration across
      // tenant DBs, no fallback to another tenant on miss.
      if (MULTI_TENANT) {
        const indexed = resolveBearer(hash);
        if (!indexed) {
          return c.json({ error: 'Invalid or revoked API key' }, 401);
        }
        const tenantDb = resolveTenantDb(c, indexed.tenantSlug);
        if (!tenantDb) return tenantUdeAfDrift(c, indexed.tenantSlug);
        const row = await tenantDb.db
          .select({ user: USER_COLUMNS, tenant: TENANT_COLUMNS, keyId: apiKeys.id, scope: apiKeys.scope, kbId: apiKeys.kbId })
          .from(apiKeys)
          .innerJoin(users, eq(users.id, apiKeys.userId))
          .innerJoin(tenants, eq(tenants.id, users.tenantId))
          .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
          .get();
        if (!row) {
          // Indexed but the per-tenant row went missing — treat as 401.
          return c.json({ error: 'Invalid or revoked API key' }, 401);
        }
        const decision = scopeAllows(row.scope, row.kbId, c.req.method, c.req.path);
        if (!decision.allowed) {
          return c.json({ error: `API key scope does not allow this endpoint${decision.reason ? `: ${decision.reason}` : ''}` }, 403);
        }
        // F205.1 — the KB a partner key is confined to. Read from the KEY, so
        // the upload endpoint never takes a kbId the caller could tamper with.
        c.set('partnerKbId', row.kbId);
        c.set('trail', tenantDb);
        trail = tenantDb;
        c.set('user', row.user);
        c.set('tenant', row.tenant);
        c.set('authType', 'bearer');
        tenantDb.db
          .update(apiKeys)
          .set({ lastUsedAt: new Date().toISOString() })
          .where(eq(apiKeys.id, row.keyId))
          .run()
          .catch(() => {});
        return next();
      }

      // Single-tenant path (TRAIL_MULTI_TENANT unset): historical
      // F40.1 behaviour, query the primary DB directly.
      const row = await trail.db
        .select({ user: USER_COLUMNS, tenant: TENANT_COLUMNS, keyId: apiKeys.id, scope: apiKeys.scope, kbId: apiKeys.kbId })
        .from(apiKeys)
        .innerJoin(users, eq(users.id, apiKeys.userId))
        .innerJoin(tenants, eq(tenants.id, users.tenantId))
        .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
        .get();
      if (!row) {
        return c.json({ error: 'Invalid or revoked API key' }, 401);
      }
      const decision = scopeAllows(row.scope, row.kbId, c.req.method, c.req.path);
      if (!decision.allowed) {
        return c.json({ error: `API key scope does not allow this endpoint${decision.reason ? `: ${decision.reason}` : ''}` }, 403);
      }
      c.set('partnerKbId', row.kbId);
      c.set('user', row.user);
      c.set('tenant', row.tenant);
      c.set('authType', 'bearer');
      // last_used_at is best-effort — don't block the request on it
      trail.db
        .update(apiKeys)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(apiKeys.id, row.keyId))
        .run()
        .catch(() => {});
      return next();
    }

    // (b) Legacy service-to-service env-var token
    const expected = process.env.TRAIL_INGEST_TOKEN;
    if (!expected) {
      return c.json({ error: 'Bearer auth not configured on this engine' }, 401);
    }
    // Constant-time compare — plain `!==` leaks per-byte timing that a
    // patient attacker could aggregate across many requests to recover
    // the token. Length check first: timingSafeEqual throws on mismatched
    // lengths, and that throw itself is a (tiny) timing side channel, so
    // we gate with a plain length check and only compare equal-length
    // buffers. Presenting a wrong-length token lands in the same 403
    // bucket as a wrong-byte token.
    const presentedBuf = Buffer.from(presented);
    const expectedBuf = Buffer.from(expected);
    const ok =
      presentedBuf.length === expectedBuf.length &&
      timingSafeEqual(presentedBuf, expectedBuf);
    if (!ok) {
      return c.json({ error: 'Invalid ingest token' }, 403);
    }
    const service = await trail.db
      .select({ user: USER_COLUMNS, tenant: TENANT_COLUMNS })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(eq(users.id, INGEST_USER_ID))
      .get();
    if (!service) {
      return c.json({ error: 'Ingest user not provisioned' }, 503);
    }
    c.set('user', service.user);
    c.set('tenant', service.tenant);
    c.set('authType', 'bearer');
    return next();
  }

  // Session-cookie path — how the admin UI and cc/MCP sessions auth.
  const sessionId = getCookie(c, 'session');
  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const now = new Date().toISOString();

  // F40.2a-D — multi-tenant: index resolves session → tenant first,
  // then we read the user/tenant row from THAT tenant's DB.
  if (MULTI_TENANT) {
    const indexed = resolveSession(sessionId);
    if (!indexed) {
      return c.json({ error: 'Session expired' }, 401);
    }
    const tenantDb = resolveTenantDb(c, indexed.tenantSlug);
    if (!tenantDb) return tenantUdeAfDrift(c, indexed.tenantSlug);
    const result = await tenantDb.db
      .select({ user: USER_COLUMNS, tenant: TENANT_COLUMNS })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
      .get();
    if (!result) {
      return c.json({ error: 'Session expired' }, 401);
    }
    c.set('trail', tenantDb);
    c.set('user', result.user);
    c.set('tenant', result.tenant);
    c.set('authType', 'session');
    return next();
  }

  // Single-tenant path (flag off): query the primary DB directly.
  const result = await trail.db
    .select({ user: USER_COLUMNS, tenant: TENANT_COLUMNS })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .get();

  if (!result) {
    return c.json({ error: 'Session expired' }, 401);
  }

  c.set('user', result.user);
  c.set('tenant', result.tenant);
  c.set('authType', 'session');
  return next();
}

export function getUser(c: Context): AuthUser {
  return c.get('user') as AuthUser;
}

export function getTenant(c: Context): AuthTenant {
  return c.get('tenant') as AuthTenant;
}

/** Resolve the per-request TrailDatabase. Always set by createApp. */
export function getTrail(c: Context): TrailDatabase {
  return c.get('trail') as TrailDatabase;
}
