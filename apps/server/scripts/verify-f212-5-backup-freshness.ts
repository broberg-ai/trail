/**
 * F212.5 — read the REAL backup store back and compare it to what the
 * production code path says about it.
 *
 * The unit tests and the e2e gate both drive a fake or a stub. This
 * script is the one that touches the actual bucket the DB machine writes
 * to, because the claim on the card is about the real artefact: "there
 * is a restorable file for every customer, and it is fresh".
 *
 * TWO INDEPENDENT READINGS, compared with strict equality:
 *
 *   A. a direct ListObjectsV2 against the bucket, newest per slug
 *      computed here, in this file, by hand
 *   B. `runBackupFreshnessPass` — the exact function the engine's watch
 *      calls in production
 *
 * If A and B disagree on a single ISO string the script fails. Comparing
 * two readings is the point: a single reading proves the code ran, not
 * that it read the right thing.
 *
 * RUN:
 *   set -a; source .env.f212-5; set +a
 *   bun run apps/server/scripts/verify-f212-5-backup-freshness.ts
 *
 * ENV (all four required, plus the tenant list):
 *   TRAIL_DB_BACKUP_S3_ENDPOINT     https://fly.storage.tigris.dev
 *   TRAIL_DB_BACKUP_S3_BUCKET       trail-db-backups
 *   TRAIL_DB_BACKUP_S3_ACCESS_KEY_ID
 *   TRAIL_DB_BACKUP_S3_SECRET_ACCESS_KEY
 *   TRAIL_DB_BACKUP_S3_PREFIX       (optional, default _db-backups/)
 *   TRAIL_DB_REMOTE                 the engine's own per-tenant map, or
 *   TRAIL_DB_BACKUP_VERIFY_SLUGS    comma-separated slugs when running
 *                                   outside the engine's environment
 */
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  createS3BackupLister,
  readDbBackupStoreConfigFromEnv,
  readMaxAgeHoursFromEnv,
} from '../src/services/backup/freshness.js';
import { runBackupFreshnessPass } from '../src/services/backup/freshness-watch.js';

let failures = 0;
function assert(ok: boolean, label: string, detail = ''): void {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function expectedSlugs(): string[] {
  const explicit = process.env.TRAIL_DB_BACKUP_VERIFY_SLUGS;
  if (explicit) return explicit.split(',').map((s) => s.trim()).filter(Boolean);
  const raw = process.env.TRAIL_DB_REMOTE;
  if (!raw) return [];
  return Object.keys(JSON.parse(raw) as Record<string, string>);
}

const store = readDbBackupStoreConfigFromEnv();
if (!store) {
  console.error(
    'TRAIL_DB_BACKUP_S3_* is not set. The store is what this script verifies, so there is\n' +
      'nothing to check — this is a MISSING CREDENTIAL, not a passing run.',
  );
  process.exit(2);
}

const slugs = expectedSlugs();
if (slugs.length === 0) {
  console.error('No tenants to check: set TRAIL_DB_REMOTE or TRAIL_DB_BACKUP_VERIFY_SLUGS.');
  process.exit(2);
}

const maxAgeHours = readMaxAgeHoursFromEnv();
console.log(`F212.5 — ${store.bucket}/${store.prefix} · ${slugs.length} tenant(s) · limit ${maxAgeHours}h\n`);

// ── Reading A: by hand, straight from the store ──────────────────────
console.log('A. direct ListObjectsV2, newest per tenant computed in this file');
const direct = new Map<string, { at: string; count: number }>();
{
  const client = new S3Client({
    endpoint: store.endpoint,
    region: 'auto',
    credentials: { accessKeyId: store.accessKeyId, secretAccessKey: store.secretAccessKey },
  });
  try {
    let token: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: store.bucket, Prefix: store.prefix, ContinuationToken: token }),
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key || !obj.LastModified || !obj.Key.endsWith('.db.gz')) continue;
        const rest = obj.Key.slice(store.prefix.length);
        const slash = rest.indexOf('/');
        if (slash <= 0) continue;
        const slug = rest.slice(0, slash);
        const at = obj.LastModified.toISOString();
        const cur = direct.get(slug);
        direct.set(slug, { at: !cur || cur.at < at ? at : cur.at, count: (cur?.count ?? 0) + 1 });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  } finally {
    client.destroy();
  }
}
for (const slug of slugs) {
  const row = direct.get(slug);
  console.log(`   ${slug.padEnd(18)} ${row ? `${row.at}  (${row.count} objects)` : 'NO OBJECTS'}`);
}

// ── Reading B: the production path ───────────────────────────────────
console.log('\nB. runBackupFreshnessPass — the function the engine calls');
const alarms: string[] = [];
const rows = await runBackupFreshnessPass({
  slugs,
  lister: createS3BackupLister(store),
  prefix: store.prefix,
  maxAgeHours,
  onAlarm: (_row, message) => alarms.push(message),
});
for (const row of rows) {
  console.log(
    `   ${row.slug.padEnd(18)} ${row.newestSnapshotAt ?? 'null'}  age=${row.ageHours ?? 'n/a'}h  ` +
      `count=${row.snapshotCount}  healthy=${row.healthy}  reason=${row.reason}`,
  );
}

// ── The comparison ───────────────────────────────────────────────────
console.log('\nA vs B — strict equality on every ISO string');
assert(rows.length === slugs.length, `one row per expected tenant (${rows.length}/${slugs.length})`);
for (const slug of slugs) {
  const a = direct.get(slug);
  const b = rows.find((r) => r.slug === slug);
  assert(b !== undefined, `${slug}: present in the reading (a missing tenant reads as "fine")`);
  if (!b) continue;
  assert(
    b.newestSnapshotAt === (a?.at ?? null),
    `${slug}: newestSnapshotAt`,
    `A=${a?.at ?? 'null'} B=${b.newestSnapshotAt ?? 'null'}`,
  );
  assert(b.snapshotCount === (a?.count ?? 0), `${slug}: snapshotCount`, `A=${a?.count ?? 0} B=${b.snapshotCount}`);
  if (a) {
    const ageHours = (Date.now() - Date.parse(a.at)) / 3_600_000;
    assert(
      b.healthy === ageHours <= maxAgeHours,
      `${slug}: healthy agrees with the age computed here`,
      `age=${Math.round(ageHours * 100) / 100}h healthy=${b.healthy}`,
    );
  } else {
    assert(b.healthy === false && b.reason === 'no_snapshot', `${slug}: no object ⇒ unhealthy, reason no_snapshot`);
  }
}

// ── The alarm fires, and only when it should ──────────────────────────
console.log('\nThe alarm');
const unhealthy = rows.filter((r) => !r.healthy);
assert(
  alarms.length === unhealthy.length,
  `one alarm per unhealthy tenant (${alarms.length} alarms, ${unhealthy.length} unhealthy)`,
);
for (const row of unhealthy) {
  assert(
    alarms.some((m) => m.includes(row.slug)),
    `the alarm names the tenant: ${row.slug}`,
  );
}

// A negative control: force a limit nothing can satisfy and the SAME
// code must go red. Without it, a green run could mean "everything is
// fresh" OR "the check cannot fail".
console.log('\nNegative control — limit 0h, so every tenant must go red');
const forced: string[] = [];
const forcedRows = await runBackupFreshnessPass({
  slugs,
  lister: createS3BackupLister(store),
  prefix: store.prefix,
  maxAgeHours: 0,
  onAlarm: (_row, message) => forced.push(message),
});
assert(forcedRows.every((r) => !r.healthy), 'every tenant is unhealthy at limit 0h');
assert(forced.length === forcedRows.length, `one alarm per tenant (${forced.length}/${forcedRows.length})`);

console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} assertion(s)`}`);
process.exit(failures === 0 ? 0 : 1);
