/**
 * F153 — Admin backup routes.
 *
 * Phase 2/3 scope: manual trigger + list + test-connection (owner-only),
 * plus a read-only health endpoint (any-auth) that powers the F153
 * Phase 4 status card on apps/admin.
 *
 * Auth split:
 *   - `/admin/backups*`             — owner-only (mutating + full data)
 *   - `/backups/health`             — any authenticated user (read-only,
 *                                     non-sensitive aggregates)
 *
 * The split exists because backups are an OPERATOR-LEVEL feature for the
 * whole SaaS DB, not per-tenant. Tenants shouldn't be able to trigger
 * snapshots, but they CAN see "the operator's backup system is alive"
 * for peace-of-mind. The 2026-04-24 Phase 4 drop ruling explicitly
 * rejected per-tenant control; F153 Phase 4 (read-only) revisits with
 * the narrower scope.
 */

import { Hono } from 'hono';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getTrail, getUser, requireAuth } from '../middleware/auth.js';
import { createBackupProvider, readBackupConfigFromEnv } from '../services/backup/providers/index.js';
import { readManifest } from '../services/backup/manifest.js';
import { runBackupPass } from '../services/backup/pass.js';

export const backupRoutes = new Hono();

// All-auth surface (read-only health). Auth-gate is path-scoped so
// it doesn't accidentally widen to the owner-gated /admin/* routes.
backupRoutes.use('/backups/*', requireAuth);
backupRoutes.use('/admin/backups', requireAuth);
backupRoutes.use('/admin/backups/*', requireAuth);

/**
 * GET /backups/health — read-only aggregate for the F153 Phase 4
 * status card. Exposes nothing tenant-sensitive: just whether the
 * backup pipeline is configured + last-success timestamp + count
 * over the last 30 days + a derived `healthy` boolean.
 *
 * `healthy` = `configured AND lastSuccess within 25h` (24h cadence
 * + 1h grace). Non-configured returns `healthy=null` so the UI can
 * render "not configured" without making it look like an outage.
 */
backupRoutes.get('/backups/health', async (c) => {
  const dataDir = resolveDataDir();
  const manifest = await readManifest(dataDir);
  const config = readBackupConfigFromEnv();
  const configured = config.type !== 'off';

  const uploaded = manifest.snapshots.filter((s) => s.status === 'uploaded');
  const lastSuccess = uploaded[0]?.snappedAt ?? null;

  const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const last30Days = uploaded.filter((s) => Date.parse(s.snappedAt) >= cutoff30d).length;

  let healthy: boolean | null = null;
  if (configured) {
    if (!lastSuccess) {
      healthy = false;
    } else {
      const ageMs = Date.now() - Date.parse(lastSuccess);
      healthy = ageMs <= 25 * 60 * 60 * 1000;
    }
  }

  return c.json({
    configured,
    providerType: config.type,
    lastSuccess,
    last30Days,
    healthy,
  });
});

// Owner-role gate scoped to /admin/* only — keeps /backups/health open
// to all authenticated users (the read-only F153 Phase 4 surface).
const ownerOnly = async (c: Parameters<Parameters<typeof backupRoutes.use>[1]>[0], next: () => Promise<void>) => {
  const user = getUser(c);
  if (user.role !== 'owner') {
    return c.json({ error: 'forbidden', message: 'backup admin requires owner role' }, 403);
  }
  await next();
};
backupRoutes.use('/admin/backups', ownerOnly);
backupRoutes.use('/admin/backups/*', ownerOnly);

/**
 * GET /admin/backups — return the manifest + a few derived totals so the
 * Settings panel can render without a second round-trip.
 */
backupRoutes.get('/admin/backups', async (c) => {
  const dataDir = resolveDataDir();
  const manifest = await readManifest(dataDir);
  const uploaded = manifest.snapshots.filter((s) => s.status === 'uploaded');
  const lastSuccess = uploaded[0]?.snappedAt ?? null;
  const totalRemoteBytes = uploaded.reduce((n, s) => n + s.compressedBytes, 0);
  const config = readBackupConfigFromEnv();
  return c.json({
    configured: config.type !== 'off',
    providerType: config.type,
    snapshots: manifest.snapshots,
    totals: {
      count: uploaded.length,
      totalRemoteBytes,
      lastSuccess,
    },
  });
});

/**
 * POST /admin/backups — run a manual snapshot + upload end-to-end. Blocks
 * until the upload finishes. 60s is an aggressive timeout for a small DB;
 * real deployments may want this backgrounded with SSE, but synchronous
 * is fine for MVP single-tenant.
 */
backupRoutes.post('/admin/backups', async (c) => {
  const config = readBackupConfigFromEnv();
  if (config.type === 'off') {
    return c.json(
      { error: 'not_configured', message: 'TRAIL_BACKUP_R2_* env vars are not populated' },
      503,
    );
  }

  const trail = getTrail(c);
  const dataDir = resolveDataDir();
  const { stagingDir, localDir } = ensureBackupDirs(dataDir);
  const provider = await createBackupProvider(config);

  const result = await runBackupPass({
    dbPath: trail.path,
    dataDir,
    stagingDir,
    localDir,
    provider,
    trigger: 'manual',
  });

  if (!result.ok) {
    return c.json({ error: 'backup_failed', snapshot: result.snapshot, message: result.error }, 500);
  }
  return c.json({ snapshot: result.snapshot });
});

/**
 * POST /admin/backups/test — verify R2 connectivity + permissions. No
 * side effects. Used by the Settings panel.
 */
backupRoutes.post('/admin/backups/test', async (c) => {
  const config = readBackupConfigFromEnv();
  if (config.type === 'off') {
    return c.json({ ok: false, message: 'TRAIL_BACKUP_R2_* env vars are not populated' });
  }
  const provider = await createBackupProvider(config);
  const result = await provider.test();
  return c.json(result);
});

function resolveDataDir(): string {
  return process.env.TRAIL_DATA_DIR ?? join(process.cwd(), 'data');
}

function ensureBackupDirs(dataDir: string): { stagingDir: string; localDir: string } {
  const root = join(dataDir, 'backups');
  const stagingDir = join(root, 'staging');
  const localDir = join(root, 'local');
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(localDir, { recursive: true });
  // Also create the parent of manifest.json — readManifest tolerates
  // missing file but writeManifest needs the directory.
  mkdirSync(dirname(join(root, 'manifest.json')), { recursive: true });
  return { stagingDir, localDir };
}
