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

// Phase 1B.2 minimal landing — replaced by SPA static-serve in 1B.3.
// Provides a usable login form so we can test magic-link e2e via UI.
app.get('/', (c) =>
  c.html(`<!doctype html>
<html><head><title>Trail Admin</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 420px; margin: 4rem auto; padding: 1rem; color: #222; }
  h1 { font-weight: 600; margin: 0 0 0.5rem; }
  .sub { color: #555; margin: 0 0 2rem; }
  input { width: 100%; padding: 0.6rem 0.75rem; font: inherit; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  button { padding: 0.6rem 1rem; font: inherit; background: #0a7c4a; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  .row { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  .ok { color: #0a7c4a; margin-top: 1rem; }
  .err { color: #b00020; margin-top: 1rem; }
</style></head>
<body>
<h1>Trail Admin</h1>
<p class="sub">Sign in with a magic-link to your email.</p>
<form id="f">
  <input id="email" type="email" placeholder="you@example.com" required autocomplete="email" />
  <div class="row"><button type="submit">Send link</button></div>
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
    if (r.ok) {
      msg.className = 'ok';
      msg.textContent = 'Check your inbox for a link from trail@webhouse.dk.';
    } else {
      msg.className = 'err';
      msg.textContent = (await r.json()).error ?? 'Failed';
    }
  } catch (err) {
    msg.className = 'err'; msg.textContent = String(err);
  }
});
</script>
</body></html>`),
);

console.log(`[admin-server] listening on :${PORT}`);
export default { port: PORT, fetch: app.fetch };
