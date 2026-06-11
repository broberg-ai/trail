import type { Context, Next } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db, schema } from './db.js';

/**
 * F198 — Lens mint endpoint (cardmem F098.1/F074.13 fleet standard).
 *
 * `POST /api/lens-session` (`Authorization: Bearer LENS_MINT_SECRET`) mints a
 * 10-minute READ-ONLY session for a dedicated synthetic "lens" principal (NEVER
 * cb@) and returns a Playwright `storageState`, so Lens can log in and screenshot
 * the REAL authed admin surface instead of the login wall.
 *
 * Trail's admin-server does NOT sign session tokens — the `trail-session` cookie
 * value IS the random `sessions.id`, looked up server-side. So minting is just:
 * create the principal + a session row, hand back the cookie.
 *
 * Read-only is enforced two ways: (1) the principal is a plain `member` in ONE
 * tenant (broberg-ai only — never a customer tenant), and (2) `lensReadOnlyGuard`
 * hard-403s ANY mutating method carrying the lens cookie, across every route.
 *
 * Ships DARK: 503 until LENS_MINT_SECRET is provisioned, so deploying is inert.
 */

/** The dedicated synthetic principal. NEVER cb@webhouse.dk. */
export const LENS_EMAIL = 'lens@trailmem.com';
const LENS_SESSION_TTL_SEC = 10 * 60;
const COOKIE_NAME = 'trail-session';

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}
function isoFromNow(sec: number): string {
  return new Date(Date.now() + sec * 1000).toISOString();
}
/** Constant-time string compare (length-safe). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface LensStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Lax';
    expires: number;
  }>;
  origins: never[];
}

/**
 * Find-or-create the lens principal + a membership in the target tenant, then
 * mint a 10-min session. Returns the Playwright storageState. `tenantSlug`
 * defaults to broberg-ai (our own KB — never a customer tenant, so Lens
 * baselines never capture customer data). Throws if the tenant doesn't exist.
 */
export async function mintLensSession(opts: {
  tenantSlug?: string;
  cookieDomain: string;
}): Promise<LensStorageState> {
  const slug = opts.tenantSlug ?? 'broberg-ai';
  const tenant = await db.query.controlTenants.findFirst({
    where: eq(schema.controlTenants.slug, slug),
  });
  if (!tenant) throw new Error(`lens target tenant not found: ${slug}`);

  // find-or-create the dedicated lens user (home org = the target tenant's org)
  let user = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.email, LENS_EMAIL),
  });
  if (!user) {
    const id = `usr_lens_${hex(8)}`;
    await db
      .insert(schema.controlUsers)
      .values({
        id,
        organizationId: tenant.organizationId,
        email: LENS_EMAIL,
        name: 'Lens (read-only)',
        onboarded: true,
      })
      .run();
    user = await db.query.controlUsers.findFirst({ where: eq(schema.controlUsers.id, id) });
  }
  if (!user) throw new Error('lens user create failed');

  // find-or-create a membership in the target tenant (lowest role; the
  // read-only guard does the real enforcement)
  const membership = await db.query.controlMemberships.findFirst({
    where: and(
      eq(schema.controlMemberships.userId, user.id),
      eq(schema.controlMemberships.tenantId, tenant.id),
    ),
  });
  if (!membership) {
    await db
      .insert(schema.controlMemberships)
      .values({ userId: user.id, tenantId: tenant.id, role: 'member' })
      .run();
  }

  // mint a short-lived session (same shape as a magic-link login)
  const sessionId = hex(32);
  const expiresAtIso = isoFromNow(LENS_SESSION_TTL_SEC);
  await db
    .insert(schema.sessions)
    .values({
      id: sessionId,
      userId: user.id,
      expiresAt: expiresAtIso,
      lastSeenAt: new Date().toISOString(),
      userAgent: 'lens-mint',
    })
    .run();

  return {
    cookies: [
      {
        name: COOKIE_NAME,
        value: sessionId,
        domain: opts.cookieDomain,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        expires: Math.floor(new Date(expiresAtIso).getTime() / 1000),
      },
    ],
    origins: [],
  };
}

/** True if `sessionId` belongs to the lens principal (used by the guard). */
export async function isLensPrincipalSession(sessionId: string): Promise<boolean> {
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.id, sessionId),
  });
  if (!session) return false;
  const user = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.id, session.userId),
  });
  return user?.email === LENS_EMAIL;
}

/**
 * Global middleware: hard-403 ANY mutating method (POST/PUT/PATCH/DELETE)
 * carrying the lens session cookie — engine proxy AND admin-local routes alike.
 * GET/HEAD/OPTIONS pass through (read-only). The mint POST is bearer-authed and
 * carries NO lens cookie, so it is never blocked.
 */
export async function lensReadOnlyGuard(c: Context, next: Next): Promise<Response | void> {
  const m = c.req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  const sessionId = getCookie(c, COOKIE_NAME);
  if (sessionId && (await isLensPrincipalSession(sessionId))) {
    return c.json({ error: 'lens principal is read-only' }, 403);
  }
  return next();
}

/** `POST /api/lens-session` — the mint endpoint. */
export async function lensSessionHandler(c: Context): Promise<Response> {
  const secret = process.env.LENS_MINT_SECRET;
  if (!secret) return c.json({ error: 'lens minting not configured' }, 503); // ship dark

  const authHeader = c.req.header('authorization') ?? '';
  const presented = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!presented || !safeEqual(presented, secret)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const cookieDomain = process.env.LENS_COOKIE_DOMAIN ?? '.trailmem.com';
  const tenantSlug = process.env.LENS_TENANT_SLUG ?? 'broberg-ai';
  try {
    const storageState = await mintLensSession({ tenantSlug, cookieDomain });
    return c.json(storageState);
  } catch (err) {
    console.error('[lens-session] mint failed:', err);
    return c.json({ error: 'lens mint failed' }, 500);
  }
}
