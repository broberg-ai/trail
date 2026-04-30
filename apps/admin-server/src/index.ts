import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { sql } from 'drizzle-orm';
import { db } from './db.js';
import { runMigrations } from './migrations.js';
import { authRoutes } from './auth.js';

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

console.log(`[admin-server] listening on :${PORT}`);
export default { port: PORT, fetch: app.fetch };
