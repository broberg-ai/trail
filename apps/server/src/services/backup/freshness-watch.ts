/**
 * F212.5 — the alarm on the backup rung that actually runs.
 *
 * Started ONCE for the whole engine, not per tenant. That is the point:
 * the F153 backup step in lint-scheduler runs inside `startTenantServices`
 * and therefore fires once per tenant per tick, so an alarm placed there
 * would multiply by the number of tenants. This watch takes ONE object
 * listing and reports at most one error per stale tenant per pass.
 *
 * Why an alarm on the OBJECT age, and not a failure report from the
 * sidecar: a report cannot fire when the reporter is dead. `backup.sh`
 * logs its failures to stderr and nothing reads that, and if the machine
 * or the loop stops there is no failure to report at all — just an
 * absence, which is exactly what went unnoticed for 15 days. Age catches
 * every one of those, including the ones nobody thought of.
 *
 * Ships dark: no store credential ⇒ the watch logs once and does not
 * start, rather than alarming about something it cannot see.
 */
import { captureException } from '@upmetrics/sdk';
import { remoteTenantConfig } from '../../lib/tenant-pool.js';
import {
  assessBackupFreshness,
  createS3BackupLister,
  readDbBackupStoreConfigFromEnv,
  readMaxAgeHoursFromEnv,
  type BackupObjectLister,
  type TenantBackupFreshness,
} from './freshness.js';

const TICK_INTERVAL_MS = Number(process.env.TRAIL_DB_BACKUP_WATCH_INTERVAL_SECONDS ?? 3600) * 1000;
const INITIAL_DELAY_MS = Number(process.env.TRAIL_DB_BACKUP_WATCH_INITIAL_DELAY_SECONDS ?? 120) * 1000;

/**
 * Run one pass: list, assess, alarm on anything unhealthy. Exported so
 * the verify script can exercise the exact production path with an
 * injected lister instead of re-implementing the check beside it.
 */
export async function runBackupFreshnessPass(opts: {
  slugs: readonly string[];
  lister: BackupObjectLister;
  prefix: string;
  maxAgeHours: number;
  onAlarm?: (row: TenantBackupFreshness, message: string) => void;
}): Promise<TenantBackupFreshness[]> {
  const objects = await opts.lister();
  const rows = assessBackupFreshness(opts.slugs, objects, {
    maxAgeHours: opts.maxAgeHours,
    prefix: opts.prefix,
  });

  for (const row of rows) {
    if (row.healthy) continue;
    const message =
      row.reason === 'no_snapshot'
        ? `[F212.5] no database backup exists for tenant "${row.slug}" under ${opts.prefix}${row.slug}/`
        : `[F212.5] database backup for tenant "${row.slug}" is ${row.ageHours}h old ` +
          `(limit ${opts.maxAgeHours}h, newest ${row.newestSnapshotAt})`;
    console.error(`[backup-freshness] ${message}`);
    opts.onAlarm?.(row, message);
    // One error per stale tenant per pass. Upmetrics groups repeats, so
    // an ongoing outage stays one issue that keeps counting up.
    captureException(new Error(message), {
      tags: { feature: 'F212.5', tenant: row.slug, reason: row.reason },
    });
  }

  return rows;
}

export function startBackupFreshnessWatch(): () => void {
  const slugs = Object.keys(remoteTenantConfig());
  if (slugs.length === 0) {
    console.log('  backup-freshness: disabled (no remote tenants — the engine owns its own backups)');
    return () => {};
  }

  const store = readDbBackupStoreConfigFromEnv();
  if (!store) {
    console.log(
      '  backup-freshness: INERT — TRAIL_DB_BACKUP_S3_* not set, so the DB machine\'s ' +
        'backups cannot be read. /backups/health reports "not configured" rather than healthy.',
    );
    return () => {};
  }

  const maxAgeHours = readMaxAgeHoursFromEnv();
  const lister = createS3BackupLister(store);
  let stopped = false;

  const pass = async () => {
    if (stopped) return;
    try {
      const rows = await runBackupFreshnessPass({
        slugs,
        lister,
        prefix: store.prefix,
        maxAgeHours,
      });
      const bad = rows.filter((r) => !r.healthy).length;
      if (bad === 0) {
        console.log(
          `[backup-freshness] ${rows.length} tenant(s) OK — newest ` +
            rows.map((r) => `${r.slug}:${r.ageHours}h`).join(' '),
        );
      }
    } catch (err) {
      // An unreachable store is itself worth an alarm: it means we have
      // stopped being able to tell whether backups exist.
      const message = `[F212.5] cannot list the database-backup store: ${
        err instanceof Error ? err.message : String(err)
      }`;
      console.error(`[backup-freshness] ${message}`);
      captureException(new Error(message), { tags: { feature: 'F212.5', reason: 'store_unreachable' } });
    }
  };

  const first = setTimeout(() => void pass(), INITIAL_DELAY_MS);
  const interval = setInterval(() => void pass(), TICK_INTERVAL_MS);

  console.log(
    `  backup-freshness: ${slugs.length} tenant(s) watched in ${store.bucket}/${store.prefix}, ` +
      `limit ${maxAgeHours}h, tick every ${Math.round(TICK_INTERVAL_MS / 60_000)}min`,
  );

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(interval);
  };
}
