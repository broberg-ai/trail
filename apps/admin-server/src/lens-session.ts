import type { Context, Next } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { randomBytes } from 'node:crypto';
import { lensSessionHandler } from '@broberg/lens/hono';
import type { LensSessionContext, LensCookie } from '@broberg/lens';
import { db, schema } from './db.js';

/**
 * F198 — Lens mint endpoint. Built on the fleet package `@broberg/lens`
 * (components-owned): the package owns the universal, security-sensitive 80% —
 * ship-dark 503, per-request constant-time bearer check, TTL clamp, Playwright
 * storageState assembly, cookie-domain (incl. the 0.0.0.0-guard), rate-limit,
 * and the never-cb@ principal guard. We supply only the auth-specific 20%: the
 * `createSession` minter below + Trail's read-only write-guard.
 *
 * `POST /api/lens-session` (Bearer LENS_MINT_SECRET) → a 10-min read-only session
 * for a dedicated `lens@trailmem.com` principal, so Lens captures the real authed
 * admin surface instead of the login wall.
 */

/** The dedicated synthetic principal. NEVER cb@webhouse.dk. */
export const LENS_EMAIL = 'lens@trailmem.com';
const COOKIE_NAME = 'trail-session';

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * App-supplied minter (the auth-specific 20%): find-or-create the dedicated
 * read-only lens principal + a `member` membership in broberg-ai ONLY (our own
 * KB — never a customer tenant), insert a session row clamped to the package's
 * `expiresAt`, and return the `trail-session` cookie. Trail sessions are NOT
 * signed — the cookie value IS the random `sessions.id` — so we return it raw;
 * the package fills domain/path/secure/expires.
 */
export async function mintLensCookie(ctx: LensSessionContext): Promise<LensCookie> {
  const slug = process.env.LENS_TENANT_SLUG ?? 'broberg-ai';
  const tenant = await db.query.controlTenants.findFirst({
    where: eq(schema.controlTenants.slug, slug),
  });
  if (!tenant) throw new Error(`lens target tenant not found: ${slug}`);

  let user = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.email, ctx.principal),
  });
  if (!user) {
    const id = `usr_lens_${hex(8)}`;
    await db
      .insert(schema.controlUsers)
      .values({
        id,
        organizationId: tenant.organizationId,
        email: ctx.principal,
        name: 'Lens (read-only)',
        onboarded: true,
      })
      .run();
    user = await db.query.controlUsers.findFirst({ where: eq(schema.controlUsers.id, id) });
  }
  if (!user) throw new Error('lens user create failed');

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

  const sessionId = hex(32);
  await db
    .insert(schema.sessions)
    .values({
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(ctx.expiresAt).toISOString(), // clamp row to the package's TTL
      lastSeenAt: new Date().toISOString(),
      userAgent: 'lens-mint',
    })
    .run();

  return { name: COOKIE_NAME, value: sessionId };
}

/** The configured `POST /api/lens-session` handler (package + Trail's minter). */
export const lensSessionRoute = lensSessionHandler({
  principal: LENS_EMAIL,
  createSession: mintLensCookie,
});

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
 * carries NO lens cookie, so it is never blocked. (Trail-specific — the package
 * mints the read-only principal; enforcing read-only on OUR routes is ours.)
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
