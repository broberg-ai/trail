import { Hono } from 'hono';
import { setCookie, getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db, schema } from './db.js';

/**
 * F35-precursor — GitHub + Google OAuth login on trail-admin.
 *
 * Flow:
 *   GET /api/auth/{provider}                → 302 to provider authorize URL
 *   GET /api/auth/{provider}/callback?code=… → exchange code → fetch profile
 *                                              → ensure user in control.db
 *                                              → create session + cookie
 *                                              → redirect to /
 *
 * State protection: we generate a random state token, stash it in a
 * short-lived HttpOnly cookie, verify it matches on callback. Prevents
 * CSRF on the OAuth handshake.
 *
 * User-onboarding behaviour: if the OAuth profile's email doesn't match
 * an existing control_users row, we DO NOT auto-create yet — the F172
 * onboarding wizard owns that flow. For Phase 1B users must already
 * exist (Christian + Sanne, seeded via SQL). When F172 lands, /signup
 * will accept the OAuth profile and create org+user+tenant in one shot.
 */

const COOKIE_NAME = 'trail-session';
const STATE_COOKIE = 'trail-oauth-state';
const SESSION_TTL_DAYS = 30;
const STATE_TTL_SEC = 600;

interface OAuthProvider {
  name: 'github' | 'google';
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  scope: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Maps provider profile JSON → { email, name }. */
  parseProfile: (raw: Record<string, unknown>, headers: Record<string, string>) => Promise<{ email: string; name: string | null }>;
}

const PROVIDERS: Record<string, OAuthProvider> = {
  github: {
    name: 'github',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    profileUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
    clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
    async parseProfile(raw, headers) {
      const name = (raw.name as string | undefined) ?? (raw.login as string | undefined) ?? null;
      let email = (raw.email as string | undefined) ?? null;
      // GitHub may return null email if user has private email; fetch
      // the verified primary from /user/emails.
      if (!email && headers.authorization) {
        const r = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: headers.authorization, Accept: 'application/json', 'User-Agent': 'trail-admin' },
        });
        if (r.ok) {
          const list = (await r.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
          email = list.find((e) => e.primary && e.verified)?.email
            ?? list.find((e) => e.verified)?.email
            ?? null;
        }
      }
      if (!email) throw new Error('GitHub did not provide a verified email');
      return { email: email.toLowerCase(), name };
    },
  },
  google: {
    name: 'google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    async parseProfile(raw) {
      const email = raw.email as string | undefined;
      const name = (raw.name as string | undefined) ?? null;
      if (!email || !raw.email_verified) {
        throw new Error('Google did not provide a verified email');
      }
      return { email: email.toLowerCase(), name };
    },
  },
};

const BASE_URL = process.env.MAGIC_LINK_BASE_URL ?? 'https://app.trailmem.com';

function newToken(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export const oauthRoutes = new Hono();

// GET /api/auth/{provider} — kick off the OAuth dance
oauthRoutes.get('/:provider', (c) => {
  const provider = PROVIDERS[c.req.param('provider')];
  if (!provider) return c.text('unknown provider', 404);

  const clientId = process.env[provider.clientIdEnv];
  if (!clientId) {
    return c.text(`${provider.name} OAuth not configured (${provider.clientIdEnv} missing)`, 503);
  }

  const state = newToken(16);
  setCookie(c, STATE_COOKIE, `${provider.name}:${state}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: STATE_TTL_SEC,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${BASE_URL}/api/auth/${provider.name}/callback`,
    scope: provider.scope,
    state,
    response_type: 'code',
  });
  if (provider.name === 'google') params.set('access_type', 'online');
  return c.redirect(`${provider.authorizeUrl}?${params.toString()}`, 302);
});

// GET /api/auth/{provider}/callback?code=...&state=...
oauthRoutes.get('/:provider/callback', async (c) => {
  const provider = PROVIDERS[c.req.param('provider')];
  if (!provider) return c.text('unknown provider', 404);

  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  if (!clientId || !clientSecret) {
    return c.text(`${provider.name} OAuth not configured`, 503);
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.text('missing code or state', 400);

  // Verify state matches the value we stashed in the cookie. Use Hono's
  // getCookie which handles URL-decoding of cookie values consistently
  // with how setCookie wrote them — manual `Cookie:` header parsing
  // misses Hono's percent-encoding of `:` inside values.
  const stateCookie = getCookie(c, STATE_COOKIE);
  if (!stateCookie || stateCookie !== `${provider.name}:${state}`) {
    console.warn(
      `[oauth] state mismatch — provider=${provider.name} cookie=${stateCookie} expected=${provider.name}:${state}`,
    );
    return c.text('invalid state — possible CSRF', 400);
  }

  // Exchange code for access_token
  const tokenRes = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${BASE_URL}/api/auth/${provider.name}/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return c.text(`token exchange failed: ${err}`, 502);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) {
    return c.text(`token exchange failed: ${tokenJson.error ?? 'no token'}`, 502);
  }

  // Fetch user profile
  const profileRes = await fetch(provider.profileUrl, {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: 'application/json',
      'User-Agent': 'trail-admin',
    },
  });
  if (!profileRes.ok) {
    return c.text(`profile fetch failed: ${profileRes.status}`, 502);
  }
  const rawProfile = (await profileRes.json()) as Record<string, unknown>;
  const { email, name } = await provider.parseProfile(rawProfile, {
    authorization: `Bearer ${tokenJson.access_token}`,
  });

  // Resolve user. Phase 1B: user MUST already exist (seeded via SQL).
  // F172 will replace this branch with onboarding-redirect.
  const user = await db.query.controlUsers.findFirst({
    where: eq(schema.controlUsers.email, email),
  });
  if (!user) {
    // Friendly redirect to /login with reason — F172 will replace with
    // /onboarding/welcome that lets the user create an org+tenant.
    return c.redirect(`/login?error=email_not_registered&email=${encodeURIComponent(email)}`, 302);
  }

  // Stamp display-name from OAuth if we don't have one yet
  if (name && !user.name) {
    await db.update(schema.controlUsers).set({ name }).where(eq(schema.controlUsers.id, user.id)).run();
  }

  // Mark onboarded (first OAuth login is equivalent to first magic-link login)
  if (!user.onboarded) {
    await db.update(schema.controlUsers).set({ onboarded: true }).where(eq(schema.controlUsers.id, user.id)).run();
  }

  // Create session + cookie
  const sessionId = newToken(32);
  await db.insert(schema.sessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    lastSeenAt: new Date().toISOString(),
    userAgent: c.req.header('User-Agent') ?? null,
  });

  setCookie(c, COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
  // Clear the state cookie
  setCookie(c, STATE_COOKIE, '', { path: '/', maxAge: 0 });

  return c.redirect('/', 302);
});
