import { Hono, type Context } from 'hono';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { eq, sql } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, schema } from './db.js';
import { runMigrations } from './migrations.js';
import { authRoutes } from './auth.js';
import { oauthRoutes } from './oauth.js';
import { inviteRoutes } from './invite.js';
import { apiKeyRoutes } from './keys.js';
import { proxyToEngine } from './proxy.js';

async function logoutHandler(c: Context): Promise<Response> {
  const sessionId = (c.req.header('Cookie') ?? '').match(/(?:^|; )trail-session=([^;]+)/)?.[1];
  if (sessionId) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
  }
  c.header('Set-Cookie', 'trail-session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  return c.redirect('/login', 302);
}

/**
 * F33 Phase 1B — trail-admin server.
 *
 * Owns app.trailmem.com. Hosts:
 *   - control.db at /data/control.db (orgs, users, tenants, magic-links, sessions)
 *   - /api/auth/* — magic-link login + session management (Phase 1B.2)
 *   - /api/v1/*   — reverse-proxy to engine for tenant-scoped data (Phase 1B.3)
 *   - /         — built admin SPA static files (Phase 1B.3)
 *
 * Phase 1B.1 (this commit): skeleton + control.db migrations + health.
 */

const PORT = Number(process.env.PORT ?? 8081);
const VERSION = process.env.FLY_MACHINE_VERSION ?? process.env.TRAIL_VERSION ?? 'dev';

await runMigrations();
console.log(`[admin-server] control.db migrations applied`);

const app = new Hono();
app.use('*', logger());

app.get('/api/health', async (c) => {
  let dbStatus: 'ok' | 'error' = 'ok';
  try {
    await db.run(sql`SELECT 1`);
  } catch {
    dbStatus = 'error';
  }
  return c.json(
    {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      service: 'trail-admin',
      db: dbStatus,
      version: VERSION,
    },
    dbStatus === 'ok' ? 200 : 503,
  );
});

app.route('/api/auth', authRoutes);
// Magic-link emails embed `/auth/verify?token=...` (clean URL, no /api/
// prefix because the user clicks it from email). Mount the SAME router
// at /auth so verify works at both paths — POST /api/auth/magic-link
// stays the API, GET /auth/verify is the human-facing magic-link target.
app.route('/auth', authRoutes);

// /logout — human-friendly URL: deletes session + clears cookie + 302
// to /login. SPA's logout button can simply navigate to /logout, no
// fetch+redirect dance needed.
app.get('/logout', logoutHandler);

// Invite — operator UI for adding teammates. POST endpoint mounted at
// /api/control/invite + HTML form at /invite. Both auth-gated.
app.route('/api/control', inviteRoutes);

// F188 — personal API keys. /api/control/api-keys (GET/POST/DELETE).
app.route('/api/control', apiKeyRoutes);

app.get('/invite', (c) => {
  const sessionId = (c.req.header('Cookie') ?? '').match(/(?:^|; )trail-session=([^;]+)/)?.[1];
  if (!sessionId) return c.redirect('/login', 302);
  return c.html(`<!doctype html>
<html lang="en"><head><title>Invite to Trail</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 4rem auto; padding: 1rem; color: #222; background: #faf9f5; min-height: 80vh; }
  @media (prefers-color-scheme: dark) { body { color: #eee; background: #17140f; } input, select { background: #2a261d; color: #eee; border-color: #443c2a; } }
  h1 { font-weight: 600; margin: 0 0 0.5rem; }
  .sub { color: #888; margin: 0 0 2rem; }
  label { display: block; font-size: 0.85rem; color: #888; margin-top: 1rem; margin-bottom: 0.25rem; }
  input, select { width: 100%; padding: 0.65rem 0.85rem; font: inherit; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  button { padding: 0.7rem 1rem; font: inherit; background: #d97706; color: #fff; border: 0; border-radius: 4px; cursor: pointer; font-weight: 500; margin-top: 1.25rem; }
  button:hover { background: #b45309; }
  .nav { color: #888; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .nav a { color: #888; text-decoration: underline; }
  .ok { color: #047857; margin-top: 1rem; padding: 0.65rem 0.85rem; background: rgba(4,120,87,0.1); border-radius: 4px; }
  .err { color: #dc2626; margin-top: 1rem; padding: 0.65rem 0.85rem; background: rgba(220,38,38,0.1); border-radius: 4px; }
</style></head>
<body>
<p class="nav"><a href="/">← Back to admin</a></p>
<h1>Invite to Trail</h1>
<p class="sub">Send a magic-link invite to a teammate. They'll be added to your tenant.</p>
<form id="f">
  <label for="email">Email</label>
  <input id="email" type="email" placeholder="teammate@example.com" required autocomplete="email" autofocus />
  <label for="name">Display name (optional)</label>
  <input id="name" type="text" placeholder="Jane Doe" autocomplete="name" />
  <label for="role">Role</label>
  <select id="role">
    <option value="admin">Admin</option>
    <option value="owner">Owner</option>
    <option value="member">Member</option>
  </select>
  <button type="submit">Send invite</button>
</form>
<div id="msg"></div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const name = document.getElementById('name').value;
  const role = document.getElementById('role').value;
  const msg = document.getElementById('msg');
  msg.className = ''; msg.textContent = 'Sending…';
  try {
    const r = await fetch('/api/control/invite', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, role }),
    });
    const body = await r.json();
    if (r.ok) {
      msg.className = 'ok';
      msg.textContent = body.action === 'created'
        ? \`✓ Created user and sent invite to \${body.email}.\`
        : \`✓ Re-sent invite link to \${body.email} (already a member).\`;
      document.getElementById('email').value = '';
      document.getElementById('name').value = '';
    } else {
      msg.className = 'err';
      msg.textContent = body.error ?? 'Failed';
    }
  } catch (err) { msg.className = 'err'; msg.textContent = String(err); }
});
</script>
</body></html>`);
});

// OAuth — GET /api/auth/{github,google} starts the dance, /callback
// finishes. Falls through to the legacy redirect below if the env
// secrets aren't configured (returns 503 with a clear "OAuth not
// configured" message rather than a confusing 404).
app.route('/api/auth', oauthRoutes);

// Legacy stub: SPA's dev-only path (apps/admin/src/app.tsx redirects
// here in import.meta.env.DEV mode). On prod admin we don't run that
// path, but redirect to /login as a safety net.
app.get('/api/auth/dev-login', (c) => c.redirect('/login', 302));

// F186 — server-rendered login page, 1:1 with docs/design/trail_app/src/login.jsx.
// Three methods (Google, GitHub, Magic-link) per F186 plan-doc Q1.1.
// Magic-link field renders inline below the OAuth buttons (Q1.2).
// 4 states: cold / redirecting / splash / error.
app.get('/login', (c) =>
  c.html(`<!doctype html>
<html lang="en"><head><title>Sign in to Trail</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  :root {
    --color-bg: #FAF9F5; --color-bg-card: #FFFFFF; --color-bg-sunk: #F4F2EB;
    --color-fg: #1A1715; --color-fg-muted: rgba(26,23,21,.70); --color-fg-subtle: rgba(26,23,21,.40);
    --color-border: rgba(26,23,21,.10); --color-border-strong: rgba(26,23,21,.20);
    --color-accent: #E8A87C; --color-accent-soft: rgba(232,168,124,.16); --color-accent-fg: #1A1715;
    --color-danger: #C2410C; --color-success: #15803D;
    --color-hover: rgba(26,23,21,.04);
    --radius-sm: 6px; --radius: 8px; --radius-lg: 12px;
    --shadow-sm: 0 1px 2px rgba(26,23,21,.04), 0 1px 1px rgba(26,23,21,.03);
    --shadow-lg: 0 12px 32px rgba(26,23,21,.10), 0 4px 12px rgba(26,23,21,.06);
    --ease: cubic-bezier(.4,0,.2,1); --dur: 180ms;
    --font-sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
    --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", monospace;
    --font-serif: "Fraunces", "Source Serif 4", Georgia, serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --color-bg: #17140F; --color-bg-card: #1F1B16; --color-bg-sunk: #14110D;
      --color-fg: #F5F1EA; --color-fg-muted: rgba(245,241,234,.70); --color-fg-subtle: rgba(245,241,234,.40);
      --color-border: rgba(245,241,234,.10); --color-border-strong: rgba(245,241,234,.20);
      --color-accent-soft: rgba(232,168,124,.14); --color-accent-fg: #17140F;
      --color-hover: rgba(245,241,234,.05);
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--color-bg); color: var(--color-fg); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .card { width: 100%; max-width: 380px; }
  .logo-row { display: flex; align-items: center; gap: 10px; justify-content: center; margin-bottom: 28px; }
  .wordmark { font-family: var(--font-mono); font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: var(--color-fg); }
  h1 { font-family: var(--font-serif); font-weight: 400; font-size: 28px; letter-spacing: -0.015em; margin: 0 0 8px; text-align: center; }
  .sub { color: var(--color-fg-muted); text-align: center; font-size: 14px; margin: 0 0 28px; line-height: 1.5; }
  .btn-stack { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: var(--radius); border: 1px solid var(--color-border-strong); background: var(--color-bg-card); color: var(--color-fg); font-size: 14px; font-weight: 500; text-decoration: none; cursor: pointer; transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease); font-family: inherit; }
  .btn:hover { background: var(--color-hover); }
  .btn-primary { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
  .btn-primary:hover { background: #DC9869; }
  .btn svg { flex-shrink: 0; }
  .or-row { display: flex; align-items: center; gap: 12px; margin: 16px 0; color: var(--color-fg-subtle); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
  .or-line { flex: 1; height: 1px; background: var(--color-border); }
  .input { width: 100%; background: var(--color-bg-card); border: 1px solid var(--color-border-strong); border-radius: var(--radius); padding: 10px 12px; font: inherit; color: var(--color-fg); transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
  .input:focus { outline: none; border-color: var(--color-accent); box-shadow: 0 0 0 3px var(--color-accent-soft); }
  .input::placeholder { color: var(--color-fg-subtle); }
  .magic-row { display: flex; gap: 8px; }
  .magic-row .input { flex: 1; }
  .legal { text-align: center; margin-top: 32px; font-size: 12px; color: var(--color-fg-subtle); }
  .legal a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--color-border); margin: 0 6px; }
  .banner { padding: 10px 14px; background: var(--color-accent-soft); border: 1px solid var(--color-accent); border-radius: var(--radius); color: var(--color-fg); margin-bottom: 16px; font-size: 13px; line-height: 1.5; }
  .banner code { font-family: var(--font-mono); font-size: 11px; padding: 1px 5px; border-radius: 3px; background: rgba(0,0,0,.08); }
  .msg { margin-top: 12px; padding: 10px 12px; border-radius: var(--radius); font-size: 13px; display: none; }
  .msg.ok { background: rgba(21,128,61,.10); color: var(--color-success); border: 1px solid rgba(21,128,61,.20); display: block; }
  .msg.err { background: rgba(194,65,12,.10); color: var(--color-danger); border: 1px solid rgba(194,65,12,.20); display: block; }
  .spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid currentColor; border-top-color: transparent; animation: spin .8s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style></head>
<body>
<div class="card">
  <div class="logo-row">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="var(--color-accent)" stroke-width="0.9" opacity="0.55" />
      <circle cx="16" cy="16" r="3.5" fill="var(--color-accent)" />
    </svg>
    <span class="wordmark">trail</span>
  </div>

  <h1>Sign in to Trail</h1>
  <p class="sub">Curate your knowledge. Chat against your brain.</p>

  <div id="banner" class="banner" style="display:none;"></div>

  <div class="btn-stack">
    <a id="btn-google" href="/api/auth/google" class="btn">
      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
      <span>Continue with Google</span>
    </a>
    <a id="btn-github" href="/api/auth/github" class="btn">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.79 23.4c.6.11.82-.26.82-.58v-2c-3.34.72-4.04-1.61-4.04-1.61a3.18 3.18 0 0 0-1.34-1.76c-1.09-.74.08-.72.08-.72a2.52 2.52 0 0 1 1.84 1.24 2.56 2.56 0 0 0 3.5 1 2.56 2.56 0 0 1 .76-1.6c-2.66-.3-5.46-1.33-5.46-5.93a4.65 4.65 0 0 1 1.23-3.21 4.32 4.32 0 0 1 .12-3.17s1-.32 3.3 1.23a11.43 11.43 0 0 1 6 0c2.3-1.55 3.3-1.23 3.3-1.23a4.32 4.32 0 0 1 .12 3.17 4.64 4.64 0 0 1 1.23 3.21c0 4.6-2.81 5.62-5.48 5.92a2.88 2.88 0 0 1 .82 2.23v3.32c0 .32.22.7.83.58A12 12 0 0 0 12 .3z"/></svg>
      <span>Continue with GitHub</span>
    </a>
  </div>

  <div class="or-row"><span class="or-line"></span><span>or</span><span class="or-line"></span></div>

  <form id="f" class="magic-row">
    <input id="email" class="input" type="email" placeholder="you@example.com" required autocomplete="email" />
    <button type="submit" class="btn btn-primary" style="padding: 10px 14px;">Send link</button>
  </form>

  <p id="msg" class="msg"></p>

  <div class="legal">
    <a href="https://docs.trailmem.com" target="_blank">Docs</a>
  </div>
</div>

<script>
(function() {
  const params = new URLSearchParams(location.search);
  const err = params.get('error');
  const email = params.get('email');
  const banner = document.getElementById('banner');
  if (err === 'email_not_registered') {
    banner.style.display = 'block';
    banner.innerHTML = 'Din OAuth-email <code>' + (email ?? '?') + '</code> er ikke registreret som bruger på denne Trail. Bed administratoren om at tilføje dig (eller log ind med en anden konto).';
  } else if (err === 'oauth_error' || err === 'token_exchange' || err === 'userinfo' || err === 'invalid_state') {
    banner.style.display = 'block';
    banner.textContent = 'Sign-in failed. Try again or contact support.';
  }

  // Redirecting state — when user clicked an OAuth button, replace it
  // with a spinner so they know something is happening.
  ['btn-google', 'btn-github'].forEach((id) => {
    const a = document.getElementById(id);
    a.addEventListener('click', () => {
      a.innerHTML = '<span class="spinner"></span><span>Redirecting…</span>';
    });
  });

  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('email').value;
    const msg = document.getElementById('msg');
    msg.className = 'msg';
    msg.textContent = 'Sending…';
    msg.style.display = 'block';
    try {
      const r = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput }),
      });
      if (r.ok) {
        msg.className = 'msg ok';
        msg.textContent = 'Check your inbox for the sign-in link.';
      } else {
        msg.className = 'msg err';
        const body = await r.json().catch(() => ({}));
        msg.textContent = body.error ?? 'Failed to send sign-in link';
      }
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = String(err);
    }
  });
})();
</script>
</body></html>`),
);

// Reverse-proxy /api/v1/* to the user's engine. Resolves session cookie
// → tenant → engine URL → injects Bearer key. Engine doesn't speak
// cookies, only Bearer.
app.use('/api/v1/*', proxyToEngine);

// SPA static-serve. apps/admin/dist is built by `pnpm --filter @trail/admin build`
// and copied into the runtime image at /app/apps/admin/dist.
const SPA_DIR = process.env.TRAIL_ADMIN_SPA_DIR ?? '/app/apps/admin/dist';
const spaIndexPath = join(SPA_DIR, 'index.html');
const hasSpa = existsSync(spaIndexPath);
if (hasSpa) {
  console.log(`[admin-server] SPA found at ${SPA_DIR} — serving static files`);
  app.use('/assets/*', serveStatic({ root: SPA_DIR }));
  app.use('/favicon.svg', serveStatic({ root: SPA_DIR }));
  app.use('/uploads/*', serveStatic({ root: SPA_DIR }));
  app.use('/ambient/*', serveStatic({ root: SPA_DIR }));
  app.use('/thinking/*', serveStatic({ root: SPA_DIR }));

  // SPA fallback — any non-API path returns index.html so client-side
  // routing (preact-iso) can take over. UNAUTHENTICATED users get
  // redirected to /login first so they actually see the OAuth + magic-link
  // options instead of the SPA's auto-redirect-to-Google flow (the SPA
  // hits /api/v1/me on mount, gets 401, redirects to /api/auth/google —
  // that's why incognito previously bounced straight to Google login
  // before users could pick a provider).
  const indexHtml = readFileSync(spaIndexPath, 'utf-8');
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/auth/')) {
      return c.text('not found', 404);
    }
    // Cheap cookie sniff — full session validation happens later for
    // /api/v1/* via proxy. Here we just want "any session-shaped cookie
    // present" → let SPA boot. Browser flushes cookies on logout so
    // this stays correct.
    const cookieHeader = c.req.header('Cookie') ?? '';
    const hasSession = /(?:^|; )trail-session=/.test(cookieHeader);
    if (!hasSession) {
      return c.redirect('/login', 302);
    }
    return c.html(indexHtml);
  });
} else {
  console.log(`[admin-server] no SPA at ${SPA_DIR} — serving inline login fallback`);

// Phase 1B.2 minimal landing — replaced by SPA static-serve in 1B.3.
// Auth-aware: shows login form OR signed-in view depending on /api/auth/me.
app.get('/', (c) =>
  c.html(`<!doctype html>
<html><head><title>Trail Admin</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 540px; margin: 4rem auto; padding: 1rem; color: #222; }
  h1 { font-weight: 600; margin: 0 0 0.5rem; }
  .sub { color: #555; margin: 0 0 2rem; }
  input { width: 100%; padding: 0.6rem 0.75rem; font: inherit; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  button { padding: 0.6rem 1rem; font: inherit; background: #0a7c4a; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  button.secondary { background: transparent; color: #555; border: 1px solid #ccc; }
  .row { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  .ok { color: #0a7c4a; margin-top: 1rem; }
  .err { color: #b00020; margin-top: 1rem; }
  .card { background: #f7f7f7; padding: 1rem 1.25rem; border-radius: 6px; margin: 1rem 0; }
  code { background: #eee; padding: 0.1rem 0.3rem; border-radius: 3px; }
</style></head>
<body>
<div id="root">Loading…</div>
<script>
const root = document.getElementById('root');

async function loadMe() {
  const r = await fetch('/api/auth/me', { credentials: 'include' });
  if (r.ok) return r.json();
  return null;
}

function renderSignedIn(me) {
  root.innerHTML = \`
    <h1>Trail Admin</h1>
    <p class="sub">You are signed in.</p>
    <div class="card">
      <div><strong>\${me.user.name ?? me.user.email}</strong></div>
      <div style="color:#666; font-size:0.9rem">\${me.user.email}</div>
      \${me.tenant ? \`<div style="margin-top:0.5rem">Tenant: <code>\${me.tenant.slug}</code> (\${me.tenant.language})</div>\` : ''}
      \${me.engineUrl ? \`<div>Engine: <code>\${me.engineUrl}</code></div>\` : ''}
    </div>
    <p class="sub">Phase 1B.2 deployed. Curator UI lands in 1B.3 (SPA static-serve + reverse-proxy /api/v1/* to engine).</p>
    <button class="secondary" onclick="logout()">Sign out</button>
  \`;
}

function renderLogin(initialMsg) {
  root.innerHTML = \`
    <h1>Trail Admin</h1>
    <p class="sub">Sign in with a magic-link to your email.</p>
    <form id="f">
      <input id="email" type="email" placeholder="you@example.com" required autocomplete="email" />
      <div class="row"><button type="submit">Send link</button></div>
    </form>
    <p id="msg">\${initialMsg ?? ''}</p>
  \`;
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const msg = document.getElementById('msg');
    msg.className = ''; msg.textContent = 'Sending…';
    try {
      const r = await fetch('/api/auth/magic-link', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (r.ok) {
        msg.className = 'ok';
        msg.textContent = 'Check your inbox for a link from trail@webhouse.dk.';
      } else {
        msg.className = 'err';
        msg.textContent = (await r.json()).error ?? 'Failed';
      }
    } catch (err) { msg.className = 'err'; msg.textContent = String(err); }
  });
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  location.reload();
}

(async () => {
  const me = await loadMe();
  if (me) renderSignedIn(me); else renderLogin();
})();
</script>
</body></html>`),
);
}

console.log(`[admin-server] listening on :${PORT}`);
export default { port: PORT, fetch: app.fetch };
