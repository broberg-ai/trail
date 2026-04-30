import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { sql } from 'drizzle-orm';
import { db, client } from './db.js';
import { runMigrations } from './migrations.js';

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

// Catch-all stub during Phase 1B.1 — replaced by SPA static-serve in 1B.3.
app.get('/', (c) =>
  c.html(`<!doctype html>
<html><head><title>Trail Admin</title></head>
<body style="font-family:monospace;padding:2rem">
<h1>Trail Admin</h1>
<p>Phase 1B.1 deployed. Magic-link login lands in 1B.2.</p>
<p>Status: <a href="/api/health">/api/health</a></p>
</body></html>`),
);

console.log(`[admin-server] listening on :${PORT}`);
export default { port: PORT, fetch: app.fetch };
