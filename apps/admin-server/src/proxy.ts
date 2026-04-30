import type { Context, Next } from 'hono';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { db, schema } from './db.js';

/**
 * F33 Phase 1B.3 — reverse-proxy /api/v1/* from admin to the user's engine.
 *
 * The admin SPA was originally written against the engine directly
 * (apps/server). On prod it's served from app.trailmem.com and makes
 * relative-URL fetches like /api/v1/knowledge-bases. This middleware
 * resolves the request's session cookie to the right engine and
 * forwards the request there with a Bearer key so the engine accepts
 * it.
 *
 * Phase 1B caveat: we inject a single per-tenant Bearer key (configured
 * via TRAIL_ADMIN_PROXY_BEARER_<SLUG> env). Phase 1C should mint
 * per-session ephemeral Bearers from sessions table so individual
 * curator activity is auditable. For now Sanne is the only tenant and
 * the Bearer is the same key Sanne's website uses.
 */

const COOKIE_NAME = 'trail-session';

interface ResolvedRoute {
  userId: string;
  tenantSlug: string;
  engineUrl: string;
  bearer: string;
}

async function resolveSession(c: Context): Promise<ResolvedRoute | null> {
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

  // Phase 1B: pick the user's first tenant (one tenant per org). Phase 2
  // will support tenant-switcher; for now pick first non-archived.
  const tenant = await db.query.controlTenants.findFirst({
    where: eq(schema.controlTenants.organizationId, user.organizationId),
  });
  if (!tenant) return null;

  const eng = await db.query.tenantEngines.findFirst({
    where: and(
      eq(schema.tenantEngines.tenantId, tenant.id),
      isNull(schema.tenantEngines.retiredAt),
    ),
  });
  if (!eng) return null;

  // Bearer key — env-configured per slug. Set on Fly with:
  //   fly secrets set TRAIL_ADMIN_PROXY_BEARER_SANNE_ANDERSEN=trail_...
  const envKey = `TRAIL_ADMIN_PROXY_BEARER_${tenant.slug.toUpperCase().replace(/-/g, '_')}`;
  const bearer = process.env[envKey];
  if (!bearer) {
    console.warn(`[proxy] missing ${envKey} — /api/v1 calls for ${tenant.slug} will 401`);
    return null;
  }

  return {
    userId: user.id,
    tenantSlug: tenant.slug,
    engineUrl: eng.engineUrl,
    bearer,
  };
}

/**
 * Forwards `/api/v1/*` to the engine for the user's tenant. Streams
 * request + response bodies (handles upload of large files, SSE
 * streams, etc.). Drops admin's session cookie from the outbound
 * request — engine doesn't speak cookies, only Bearer.
 */
export async function proxyToEngine(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path;
  // Match anything under /api/v1/. /api/auth/* is handled by authRoutes
  // and short-circuits before this middleware.
  if (!path.startsWith('/api/v1/') && path !== '/api/v1') {
    return next();
  }

  const route = await resolveSession(c);
  if (!route) {
    return c.json({ error: 'not signed in or no tenant route' }, 401);
  }

  const url = new URL(path + (c.req.url.includes('?') ? '?' + c.req.url.split('?')[1] : ''), route.engineUrl);

  // Build forwarded headers: copy most, drop hop-by-hop and
  // cookie/auth (engine uses Bearer, not session).
  const fwdHeaders = new Headers();
  c.req.raw.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk === 'cookie' || lk === 'authorization' || lk === 'host' || lk === 'connection') return;
    fwdHeaders.set(k, v);
  });
  fwdHeaders.set('Authorization', `Bearer ${route.bearer}`);
  fwdHeaders.set('X-Trail-Admin-User', route.userId);

  // Stream body if present (POST/PUT)
  const method = c.req.method;
  const init: RequestInit = {
    method,
    headers: fwdHeaders,
    redirect: 'manual',
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = c.req.raw.body;
    // duplex required for streaming bodies in Bun/undici fetch.
    (init as RequestInit & { duplex: string }).duplex = 'half';
  }

  const upstream = await fetch(url.toString(), init);

  // Forward response — preserve status + headers + body stream.
  // Strip hop-by-hop headers + cookies set by engine (engine doesn't
  // set cookies meaningfully; if it does we ignore — admin owns auth).
  const respHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk === 'set-cookie' || lk === 'connection' || lk === 'transfer-encoding') return;
    respHeaders.set(k, v);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
