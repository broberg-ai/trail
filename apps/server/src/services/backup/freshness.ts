/**
 * F212.5 — measure the backup rung that ACTUALLY runs.
 *
 * Since F222.3 every tenant DB lives on the dedicated DB machine
 * (sqld over HTTP), so the engine's own F153 pass refuses early with
 * `remote_tenant_backup_runs_on_db_machine` — correctly, because a
 * VACUUM INTO from here would land on a disk this process cannot
 * reach. The real backups are taken by `apps/db/backup.sh` on the DB
 * machine and uploaded to object storage as
 * `<prefix><slug>/<ISO-stamp>.db.gz`.
 *
 * Nothing measured that. `/backups/health` kept reading the engine's
 * own manifest, which has been frozen since 2026-09-04 (the refusal
 * returns BEFORE the first manifest write), so `healthy` was false for
 * 15 days while all three tenants were being backed up nightly. A red
 * lamp that cannot go green is ignored, and the day it is right nobody
 * believes it.
 *
 * So we measure the ARTEFACT — is there a restorable object, and how
 * old is it — not a claim that a pass believed it succeeded. That also
 * catches the failure modes a heartbeat cannot: a dead sidecar, a
 * silently failing upload, a machine that never came back.
 *
 * The listing is injected (`BackupObjectLister`) so the assessment is a
 * pure function the tests can drive in both directions.
 */

export interface DbBackupStoreConfig {
  /** S3-compatible endpoint, e.g. https://fly.storage.tigris.dev */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Key prefix the sidecar writes under. Always ends with '/'. */
  prefix: string;
}

export interface BackupObject {
  /** Full object key, including the prefix. */
  key: string;
  /** ISO timestamp, as reported by the store. */
  lastModified: string;
  size: number;
}

export type BackupObjectLister = () => Promise<BackupObject[]>;

export interface TenantBackupFreshness {
  slug: string;
  /** ISO timestamp of the newest object, or null when there is none. */
  newestSnapshotAt: string | null;
  /** Age of the newest object in hours, or null when there is none. */
  ageHours: number | null;
  /** Bytes of the newest object, or null when there is none. */
  newestBytes: number | null;
  /** How many objects the store holds for this tenant. */
  snapshotCount: number;
  /** false when missing or older than maxAgeHours. Never null. */
  healthy: boolean;
  /** Machine-readable reason when unhealthy. */
  reason: 'ok' | 'no_snapshot' | 'stale';
}

/** Default freshness window: a 24h cadence plus one hour of grace. */
export const DEFAULT_MAX_AGE_HOURS = 25;

/**
 * Read the db-backup store config. Returns null unless every field is
 * populated — the feature then ships dark (`configured: false`) rather
 * than half-wired, per house style.
 *
 * Deliberately a SEPARATE credential from TRAIL_BACKUP_R2_*: that one
 * writes the engine's own snapshots, this one only ever reads the DB
 * machine's bucket. Measured 2026-09-20: the engine's existing Tigris
 * key answers AccessDenied on `trail-db-backups` while listing its own
 * `trail-uploads` fine, so reusing it is not an option.
 */
export function readDbBackupStoreConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DbBackupStoreConfig | null {
  const endpoint = env.TRAIL_DB_BACKUP_S3_ENDPOINT;
  const bucket = env.TRAIL_DB_BACKUP_S3_BUCKET;
  const accessKeyId = env.TRAIL_DB_BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.TRAIL_DB_BACKUP_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  const rawPrefix = env.TRAIL_DB_BACKUP_S3_PREFIX || '_db-backups/';
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`,
  };
}

export function readMaxAgeHoursFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.TRAIL_DB_BACKUP_MAX_AGE_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_AGE_HOURS;
}

/**
 * Which slug does this object belong to? The sidecar writes
 * `<prefix><slug>/<stamp>.db.gz`, so the slug is the first path segment
 * after the prefix. Returns null for anything that does not match —
 * a stray object must not be attributed to a tenant.
 */
export function slugOfKey(key: string, prefix: string): string | null {
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const slug = rest.slice(0, slash);
  const filename = rest.slice(slash + 1);
  if (!filename.endsWith('.db.gz')) return null;
  return slug;
}

/**
 * Turn a flat object listing into one verdict per EXPECTED tenant.
 *
 * `expectedSlugs` drives the output, not the listing: a tenant with no
 * object at all must appear with `healthy: false`, never be omitted.
 * An omitted tenant reads as "fine" on every surface that renders the
 * array, which is the exact failure this card exists to remove.
 */
export function assessBackupFreshness(
  expectedSlugs: readonly string[],
  objects: readonly BackupObject[],
  opts: { now?: Date; maxAgeHours?: number; prefix?: string } = {},
): TenantBackupFreshness[] {
  const now = opts.now ?? new Date();
  const maxAgeHours = opts.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const prefix = opts.prefix ?? '_db-backups/';

  const newest = new Map<string, BackupObject>();
  const counts = new Map<string, number>();
  for (const obj of objects) {
    const slug = slugOfKey(obj.key, prefix);
    if (!slug) continue;
    const at = Date.parse(obj.lastModified);
    if (!Number.isFinite(at)) continue;
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
    const current = newest.get(slug);
    if (!current || Date.parse(current.lastModified) < at) newest.set(slug, obj);
  }

  return expectedSlugs.map((slug) => {
    const obj = newest.get(slug);
    if (!obj) {
      return {
        slug,
        newestSnapshotAt: null,
        ageHours: null,
        newestBytes: null,
        snapshotCount: 0,
        healthy: false,
        reason: 'no_snapshot' as const,
      };
    }
    const ageHours = (now.getTime() - Date.parse(obj.lastModified)) / 3_600_000;
    const stale = ageHours > maxAgeHours;
    return {
      slug,
      newestSnapshotAt: obj.lastModified,
      ageHours: Math.round(ageHours * 100) / 100,
      newestBytes: obj.size,
      snapshotCount: counts.get(slug) ?? 0,
      healthy: !stale,
      reason: stale ? ('stale' as const) : ('ok' as const),
    };
  });
}

/**
 * List every object under the configured prefix. Paginates, because a
 * 30-day retention across a growing fleet passes 1000 keys on its own.
 */
export function createS3BackupLister(config: DbBackupStoreConfig): BackupObjectLister {
  return async () => {
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      endpoint: config.endpoint,
      region: 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    try {
      const out: BackupObject[] = [];
      let continuationToken: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: config.prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const obj of res.Contents ?? []) {
          if (!obj.Key || !obj.LastModified) continue;
          out.push({
            key: obj.Key,
            lastModified: obj.LastModified.toISOString(),
            size: obj.Size ?? 0,
          });
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);
      return out;
    } finally {
      client.destroy();
    }
  };
}
