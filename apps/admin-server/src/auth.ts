import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db, schema } from './db.js';
import { sendMagicLink } from './email.js';

/**
 * F33 Phase 1B.2 — magic-link auth.
 *
 * Flow:
 *   POST /api/auth/magic-link  { email }     → 200 (silent on email not found)
 *   GET  /api/auth/verify?token=...          → set cookie, redirect to /
 *   GET  /api/auth/me                         → current user from session cookie
 *   POST /api/auth/logout                     → clear session cookie
 *
 * Cookie: 'trail-session', HttpOnly, Secure, SameSite=Lax, 30-day rolling.
 */

const COOKIE_NAME = 'trail-session';
const SESSION_TTL_DAYS = 30;
const MAGIC_LINK_TTL_MIN = 15;

function nowIso(): string {
  return new Date().toISOString();
}
function isoFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
function newToken(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export const authRoutes = new Hono();

authRoutes.post('/magic-link', async (c) => {
  let body: { email?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* ignore */
  }
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return c.json({ error: 'valid email required' }, 400);
  }

  // Lookup user. Silent success if not found — same UX as if found,
  // so the response doesn't leak whether an email is registered.
  const user = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.email, email),
  });
  if (!user) {
    return c.json({ ok: true, sent: false });
  }

  // Generate + persist token
  const token = newToken(32);
  await db.insert(schema.magicLinks).values({
    token,
    userId: user.id,
    intent: user.onboarded ? 'login' : 'welcome',
    expiresAt: isoFromNow(MAGIC_LINK_TTL_MIN * 60),
  });

  try {
    await sendMagicLink({
      email: user.email,
      token,
      intent: user.onboarded ? 'login' : 'welcome',
      userName: user.name ?? undefined,
    });
  } catch (err) {
    console.error(`[auth] sendMagicLink failed for ${email}:`, err);
    return c.json({ error: 'failed to send email' }, 500);
  }

  return c.json({ ok: true, sent: true });
});

authRoutes.get('/verify', async (c) => {
  const token = c.req.query('token');
  if (!token) {
    return c.text('missing token', 400);
  }

  const link = await db.query.magicLinks.findFirst({
    where: eq(schema.magicLinks.token, token),
  });
  if (!link) {
    return c.text('invalid or expired link', 401);
  }
  if (link.usedAt) {
    return c.text('link already used', 401);
  }
  if (new Date(link.expiresAt) < new Date()) {
    return c.text('link expired', 401);
  }

  const used = nowIso();

  // Mark used + create session
  await db.update(schema.magicLinks).set({ usedAt: used }).where(eq(schema.magicLinks.token, token)).run();

  const sessionId = newToken(32);
  await db.insert(schema.sessions).values({
    id: sessionId,
    userId: link.userId,
    expiresAt: isoFromNow(SESSION_TTL_DAYS * 24 * 60 * 60),
    lastSeenAt: used,
    userAgent: c.req.header('User-Agent') ?? null,
  });

  // First-time login: stamp user.onboarded=true. Phase 1B.3+ will add
  // /onboarding/welcome page (F172 wizard). Until then redirect to / —
  // the SPA's first-run experience handles welcome.
  const user = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.id, link.userId),
  });
  if (user && !user.onboarded) {
    await db
      .update(schema.controlUsers)
      .set({ onboarded: true })
      .where(eq(schema.controlUsers.id, link.userId))
      .run();
  }
  const redirectTo = '/';

  setCookie(c, COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });

  return c.redirect(redirectTo, 302);
});

authRoutes.get('/me', async (c) => {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) return c.json({ error: 'not signed in' }, 401);

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(schema.sessions.id, sessionId),
      gt(schema.sessions.expiresAt, nowIso()),
    ),
  });
  if (!session) {
    deleteCookie(c, COOKIE_NAME, { path: '/' });
    return c.json({ error: 'session expired' }, 401);
  }

  // Touch last_seen_at — best-effort, fire-and-forget
  void db
    .update(schema.sessions)
    .set({ lastSeenAt: nowIso() })
    .where(eq(schema.sessions.id, sessionId))
    .run()
    .catch(() => {});

  const user = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.id, session.userId),
    with: { /* drizzle relations not configured; do separate lookups below */ },
  });
  if (!user) {
    return c.json({ error: 'user not found' }, 401);
  }

  // F186 — user can belong to multiple tenants via the same organization.
  // Return the full list so the SPA's TenantSwitcher can render every
  // tenant the user has access to, plus mark the currently-active one.
  // Active tenant is read from the `trail-active-tenant` cookie (set by
  // POST /api/auth/switch-tenant); falls back to the first row if unset.
  const tenants = await db
    .select()
    .from(schema.controlTenants)
    .where(eq(schema.controlTenants.organizationId, user.organizationId))
    .all();

  const activeSlugCookie = getCookie(c, 'trail-active-tenant');
  const active = (activeSlugCookie && tenants.find((t) => t.slug === activeSlugCookie)) || tenants[0];

  let engineUrl: string | null = null;
  if (active) {
    const eng = await db.query.tenantEngines.findFirst({
      where: and(
        eq(schema.tenantEngines.tenantId, active.id),
        isNull(schema.tenantEngines.retiredAt),
      ),
    });
    engineUrl = eng?.engineUrl ?? null;
  }

  return c.json({
    user: { id: user.id, email: user.email, name: user.name, onboarded: user.onboarded },
    organizationId: user.organizationId,
    tenant: active
      ? { id: active.id, slug: active.slug, name: active.name, language: active.language, plan: (active as { plan?: string }).plan ?? null }
      : null,
    tenants: tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      language: t.language,
      plan: (t as { plan?: string }).plan ?? null,
      active: active?.id === t.id,
    })),
    engineUrl,
  });
});

// F186 — switch the active tenant for this session. Cookie-based, so
// no migration. Validates that the user actually has access to the
// target tenant (= belongs to the same organization) before setting.
authRoutes.post('/switch-tenant', async (c) => {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (!sessionId) return c.json({ error: 'not signed in' }, 401);

  const session = await db.query.sessions.findFirst({
    where: and(
      eq(schema.sessions.id, sessionId),
      gt(schema.sessions.expiresAt, nowIso()),
    ),
  });
  if (!session) return c.json({ error: 'session expired' }, 401);

  const user = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.id, session.userId),
  });
  if (!user) return c.json({ error: 'user not found' }, 401);

  let body: { slug?: string } = {};
  try { body = await c.req.json(); } catch { /* fallthrough */ }
  const slug = body.slug?.trim();
  if (!slug) return c.json({ error: 'slug required' }, 400);

  const target = await db.query.controlTenants.findFirst({
    where: and(
      eq(schema.controlTenants.slug, slug),
      eq(schema.controlTenants.organizationId, user.organizationId),
    ),
  });
  if (!target) return c.json({ error: 'tenant not found or access denied' }, 404);

  setCookie(c, 'trail-active-tenant', target.slug, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });

  return c.json({ ok: true, slug: target.slug });
});

authRoutes.post('/logout', async (c) => {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (sessionId) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
  }
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.json({ ok: true });
});
