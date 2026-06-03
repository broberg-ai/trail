import type { Context, Next } from 'hono';
import { stream } from 'hono/streaming';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { db, schema } from './db.js';
import { hashApiKey } from './keys.js';

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

  // F186 — read active-tenant cookie set by POST /api/auth/switch-tenant.
  // Falls back to first tenant in the org if unset (first-login default).
  // Validates the cookie's slug belongs to the user's org so a tampered
  // cookie value can't escape the user's tenant set.
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

  const eng = await db.query.tenantEngines.findFirst({
    where: and(
      eq(schema.tenantEngines.tenantId, tenant.id),
      isNull(schema.tenantEngines.retiredAt),
    ),
  });
  if (!eng) return null;

  // F186 follow-up — bearer comes from tenant_engines.bearer (DB).
  // Provisioning persists it; migrations.ts backfills from any legacy
  // TRAIL_ADMIN_PROXY_BEARER_<SLUG> env-var the first boot after
  // upgrade. We keep an env-var fallback for the *current* boot in
  // case migrations haven't run yet or the column is null in dev.
  let bearer: string | null = eng.bearer ?? null;
  if (!bearer) {
    const envKey = `TRAIL_ADMIN_PROXY_BEARER_${tenant.slug.toUpperCase().replace(/-/g, '_')}`;
    bearer = process.env[envKey] ?? null;
    if (!bearer) {
      console.warn(
        `[proxy] no bearer for ${tenant.slug} (tenant_engines.bearer null, ${envKey} unset) — /api/v1 calls will 401`,
      );
      return null;
    }
  }

  return {
    userId: user.id,
    tenantSlug: tenant.slug,
    engineUrl: eng.engineUrl,
    bearer,
  };
}

/**
 * F188 — resolve a personal API key bearer (`Authorization: Bearer
 * trail_<key>`) the same way `resolveSession` resolves a cookie. The key
 * is bound to a specific tenant at creation, so we route to THAT tenant's
 * engine. Stamps last_used_at best-effort. Returns null when no/invalid
 * key — the caller then falls back to the cookie path.
 */
async function resolveApiKey(c: Context): Promise<ResolvedRoute | null> {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.toLowerCase().startsWith('bearer ')) return null;
  const presented = authHeader.slice(7).trim();
  if (!presented.startsWith('trail_')) return null;

  const keyHash = hashApiKey(presented);
  const key = await db.query.controlApiKeys.findFirst({
    where: and(
      eq(schema.controlApiKeys.keyHash, keyHash),
      isNull(schema.controlApiKeys.revokedAt),
    ),
  });
  if (!key) return null;

  const tenant = await db.query.controlTenants.findFirst({
    where: eq(schema.controlTenants.id, key.tenantId),
  });
  if (!tenant) return null;

  const eng = await db.query.tenantEngines.findFirst({
    where: and(
      eq(schema.tenantEngines.tenantId, tenant.id),
      isNull(schema.tenantEngines.retiredAt),
    ),
  });
  const bearer = eng?.bearer ?? null;
  if (!eng || !bearer) return null;

  // Best-effort last_used_at — never block the request on it.
  void db
    .update(schema.controlApiKeys)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(schema.controlApiKeys.id, key.id))
    .run()
    .catch(() => {});

  return {
    userId: key.userId,
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

  // Session cookie (admin UI) OR personal API key (F188, headless callers).
  const route = (await resolveSession(c)) ?? (await resolveApiKey(c));
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

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), init);
  } catch (err) {
    // Engine unreachable (DNS, connection refused, or a connection reset
    // mid-flight during a rolling engine deploy). A gateway translates an
    // upstream failure into a 502 — it does NOT crash with a 500 +
    // error-level captureException. This is what produced the proxyToEngine
    // incident noise.
    console.warn(`[proxy] upstream fetch failed for ${path}:`, err instanceof Error ? err.message : err);
    return c.json({ error: 'engine unreachable' }, 502);
  }

  // SSE / event-stream responses (the engine's /api/v1/stream + /jobs/:id/stream)
  // MUST be forwarded as a live stream, never buffered. `arrayBuffer()` on an SSE
  // body never resolves — the stream has no EOF, so it hangs until the connection
  // is torn down (tab close, EventSource reconnect, engine restart) and THEN
  // rejects with "The socket connection was closed unexpectedly". That was the
  // root cause of the proxyToEngine incident, and it also meant live events never
  // reached the browser through the proxy. Pass the body straight through with
  // transfer-encoding intact and no Content-Length so chunked SSE flows in real
  // time. (SSE is read by EventSource, not response.json(), so it's immune to the
  // truncated-chunk login-loop bug the buffering path below guards against.)
  const upstreamCt = upstream.headers.get('content-type') ?? '';
  if (upstreamCt.includes('text/event-stream') && upstream.body) {
    // Set the streaming headers EXPLICITLY. `fetch` strips the hop-by-hop
    // `Transfer-Encoding` from upstream.headers, so copying upstream headers
    // loses it — and without `Transfer-Encoding: chunked` Bun buffers a
    // ReadableStream response (waiting to compute Content-Length) and only the
    // first chunk (`hello`) escaped; every later `candidate_*`/`ping` sat in the
    // buffer (EventStream tab looked dead). These four headers are exactly what
    // hono's streamSSE sets — replicating them makes Bun stream chunk-by-chunk.
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('Transfer-Encoding', 'chunked');
    const reader = upstream.body.getReader();
    return stream(c, async (s) => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await s.write(value);
        }
      } catch {
        // client disconnect or upstream end — fall through to release the lock.
      } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
      }
    });
  }

  // Non-stream (JSON / file download) — buffer the full body so we don't have to
  // forward the upstream's transfer-encoding. (Streaming through with stripped
  // transfer-encoding caused the SPA's response.json() to throw on what the
  // browser interpreted as truncated chunks; SPA catch → redirect to
  // /api/auth/google → infinite login loop.)
  let buf: ArrayBuffer;
  try {
    buf = await upstream.arrayBuffer();
  } catch (err) {
    // Body read interrupted (engine restarted mid-response, network blip).
    // 502 rather than an unhandled reject → no error-level incident.
    console.warn(`[proxy] upstream body read failed for ${path}:`, err instanceof Error ? err.message : err);
    return c.json({ error: 'engine connection closed' }, 502);
  }
  const respHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk === 'set-cookie' || lk === 'connection' || lk === 'transfer-encoding' || lk === 'content-length' || lk === 'content-encoding') return;
    respHeaders.set(k, v);
  });
  respHeaders.set('Content-Length', String(buf.byteLength));

  return new Response(buf, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
