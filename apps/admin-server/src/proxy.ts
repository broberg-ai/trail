import type { Context, Next } from 'hono';
import { stream } from 'hono/streaming';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { db, schema } from './db.js';
import { selectTenant, TenantAccessError } from '@broberg/apikey/authorize';
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

  // F193 — tenant access is MEMBERSHIP-gated, not org-gated: a user reaches
  // ONLY the tenants they have a control_memberships row for. This is what
  // lets cb co-own sanne-andersen (a different org) while Sanne — a member of
  // only her own tenant — can never reach broberg-ai. A tampered
  // active-tenant cookie cannot escape the membership set.
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
  // Cookie slug must resolve to a tenant the user actually belongs to.
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

  // F010 — tenant resolution via @broberg/apikey's selectTenant, which models
  // trail's "selector-not-grant" rule (now the fleet primitive): a scope='all'
  // key lets the owning USER pick any tenant they're a member of via the
  // X-Trail-Tenant header (the Ingest Station's picker sets it); a non-member
  // slug is a HARD refuse (TenantAccessError → 401), never a silent fall-back to
  // home that would mask an access error. No header (or a legacy scope='full'
  // key) → the key's home tenant, so single-tenant keys behave exactly as
  // before. The package owns the decision; we own the membership lookup +
  // slug→engine routing.
  const home =
    (await db
      .select({ id: schema.controlTenants.id, slug: schema.controlTenants.slug })
      .from(schema.controlTenants)
      .where(eq(schema.controlTenants.id, key.tenantId))
      .get()) ?? null;
  if (!home) return null;

  const spansAll = key.scope === 'all';
  const requestedSlug = c.req.header('x-trail-tenant') ?? undefined;
  // Only the membership set the selector can choose from — fetched solely when
  // a scope='all' key actually presents a slug (the JOIN restricts to tenants
  // the key's user belongs to, so a forged slug can't escape that set).
  let memberSlugs = new Set<string>();
  if (spansAll && requestedSlug) {
    const rows = await db
      .select({ slug: schema.controlTenants.slug })
      .from(schema.controlTenants)
      .innerJoin(
        schema.controlMemberships,
        eq(schema.controlMemberships.tenantId, schema.controlTenants.id),
      )
      .where(eq(schema.controlMemberships.userId, key.userId))
      .all();
    memberSlugs = new Set(rows.map((r) => r.slug));
  }

  let chosenSlug: string;
  try {
    chosenSlug = selectTenant({
      requestedSlug,
      homeTenant: home.slug,
      spansAll,
      isMember: (slug) => memberSlugs.has(slug),
    });
  } catch (e) {
    if (e instanceof TenantAccessError) return null; // non-member slug → caller 401
    throw e;
  }

  const tenant =
    chosenSlug === home.slug
      ? home
      : (await db
          .select({ id: schema.controlTenants.id, slug: schema.controlTenants.slug })
          .from(schema.controlTenants)
          .where(eq(schema.controlTenants.slug, chosenSlug))
          .get()) ?? null;
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

  // F215.4 — an explicitly presented key WINS over an ambient session cookie.
  //
  // The old order was `resolveSession(c) ?? resolveApiKey(c)`, and it cost the
  // Web Clipper's whole tenant picker. A Chrome extension holding
  // host_permissions for app.trailmem.com sends the signed-in user's cookies,
  // so every Clipper call arrived with BOTH credentials and the cookie won —
  // and resolveSession takes its tenant from `trail-active-tenant`, never from
  // X-Trail-Tenant. The picker therefore set a header nobody on the winning
  // path read: it named Broberg.ai and the request went to Sanne Andersen.
  // Measured on prod: the key the owner had just minted showed
  // last_used_at = null while the popup was listing Trails.
  //
  // Presenting a bearer is an instruction to act AS that key, so it is not a
  // fallback: a `trail_` bearer that fails to resolve is a 401, never a quiet
  // demotion to the cookie's identity. That demotion is what let a REVOKED key
  // keep listing Trails — the owner's first web-clipper key was revoked at
  // 14:38 and the popup never noticed.
  const presentsKey = /^bearer\s+trail_/i.test(c.req.header('authorization') ?? '');
  const route = presentsKey ? await resolveApiKey(c) : await resolveSession(c);
  if (!route) {
    return c.json(
      presentsKey
        ? { error: 'Invalid or revoked API key' }
        : { error: 'not signed in or no tenant route' },
      401,
    );
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
  // Connection-leak fix: an AbortController tied to the upstream fetch so that
  // when the browser disconnects an SSE stream we can ACTIVELY close the
  // proxy→engine socket. Without it the engine never sees the client leave, its
  // /api/v1/stream handler stays alive holding a connection slot, and orphaned
  // streams accumulate until the engine hits its concurrency hard_limit (100)
  // → Fly "no healthy instances" → total saturation. (Each tab close, EventSource
  // reconnect, or rolling deploy spawned a fresh stream and leaked the old one.)
  const ac = new AbortController();
  const init: RequestInit = {
    method,
    headers: fwdHeaders,
    redirect: 'manual',
    signal: ac.signal,
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
      // When the browser disconnects, ABORT the upstream fetch so the engine's
      // stream handler sees the close and frees its connection slot. Without
      // this the engine-side stream leaks (the saturation root cause).
      s.onAbort(() => { try { ac.abort(); } catch { /* already aborted */ } });
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
        try { ac.abort(); } catch { /* already aborted */ } // close proxy→engine socket
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
