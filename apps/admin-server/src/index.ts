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

// OAuth — GET /api/auth/{github,google} starts the dance, /callback
// finishes. Falls through to the legacy redirect below if the env
// secrets aren't configured (returns 503 with a clear "OAuth not
// configured" message rather than a confusing 404).
app.route('/api/auth', oauthRoutes);

// Legacy stub: SPA's dev-only path (apps/admin/src/app.tsx redirects
// here in import.meta.env.DEV mode). On prod admin we don't run that
// path, but redirect to /login as a safety net.
app.get('/api/auth/dev-login', (c) => c.redirect('/login', 302));

// Standalone /login HTML page — pure magic-link UI, no SPA bundle.
// Reachable from the legacy redirects above OR direct URL after session
// expiry. After magic-link verify, /auth/verify redirects back to /
// where the SPA picks up the new session.
app.get('/login', (c) =>
  c.html(`<!doctype html>
<html lang="en"><head><title>Sign in to Trail</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 420px; margin: 4rem auto; padding: 1rem; color: #222; background: #faf9f5; min-height: 80vh; }
  @media (prefers-color-scheme: dark) { body { color: #eee; background: #17140f; } input { background: #2a261d; color: #eee; border-color: #443c2a; } }
  h1 { font-weight: 600; margin: 0 0 0.5rem; }
  .sub { color: #888; margin: 0 0 2rem; }
  input { width: 100%; padding: 0.7rem 0.85rem; font: inherit; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  button { padding: 0.7rem 1rem; font: inherit; background: #d97706; color: #fff; border: 0; border-radius: 4px; cursor: pointer; font-weight: 500; }
  button:hover { background: #b45309; }
  .row { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  .ok { color: #047857; margin-top: 1rem; }
  .err { color: #dc2626; margin-top: 1rem; }
</style></head>
<body>
<h1>Trail</h1>
<p class="sub">Sign in</p>
<div id="banner" style="display:none;padding:0.7rem 0.85rem;background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;color:#78350f;margin-bottom:1.25rem;font-size:0.9rem;"></div>
<script>
(function(){
  const params = new URLSearchParams(location.search);
  const err = params.get('error');
  const email = params.get('email');
  if (err === 'email_not_registered') {
    const b = document.getElementById('banner');
    b.style.display = 'block';
    b.innerHTML = 'Din OAuth-email <code>' + (email ?? '?') + '</code> er ikke registreret som bruger på denne Trail. Bed administratoren om at tilføje dig (eller log ind med en anden konto).';
  }
})();
</script>
<div style="display:flex;gap:0.5rem;margin-bottom:1.5rem;">
  <a href="/api/auth/google" style="flex:1;padding:0.7rem 1rem;background:#fff;color:#222;border:1px solid #ccc;border-radius:4px;text-decoration:none;text-align:center;font-weight:500;">Continue with Google</a>
  <a href="/api/auth/github" style="flex:1;padding:0.7rem 1rem;background:#222;color:#fff;border-radius:4px;text-decoration:none;text-align:center;font-weight:500;">Continue with GitHub</a>
</div>
<p class="sub" style="font-size:0.85rem;text-align:center;margin:1rem 0;">— or —</p>
<form id="f">
  <input id="email" type="email" placeholder="you@example.com" required autocomplete="email" autofocus />
  <div class="row"><button type="submit">Send magic-link</button></div>
</form>
<p id="msg"></p>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const msg = document.getElementById('msg');
  msg.className = ''; msg.textContent = 'Sending…';
  try {
    const r = await fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (r.ok) { msg.className = 'ok'; msg.textContent = 'Check your inbox for a link from trail@webhouse.dk.'; }
    else { msg.className = 'err'; msg.textContent = (await r.json()).error ?? 'Failed'; }
  } catch (err) { msg.className = 'err'; msg.textContent = String(err); }
});
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
