/**
 * F212.5 — EN MÅLER DER IKKE KAN SKIFTE FARVE, ER IKKE EN MÅLER.
 *
 * Det er hele grunden til kortet: motorens `/backups/health` stod på rød
 * i 15 døgn (5.–20. september) mens alle tre kunder blev backuppet hver
 * nat. Lampen kunne ikke blive grøn, fordi den læste et manifest der var
 * frosset. Så prøverne her skal bevise BEGGE retninger, ikke kun den ene.
 *
 * MUTATIONS-TJEK, kørt 20. september 2026 (dansk tid). Baseline 11/11
 * grønne; hver mutation gjorde netop den prøve der skulle fange den RØD:
 *
 *   1. `ageHours > maxAgeHours`  →  `ageHours < maxAgeHours`     6/5
 *        Fem prøver falder, altså diskriminerer suiten i BEGGE
 *        retninger — ikke kun på «rød når den er gammel».
 *   2. `expectedSlugs.map(...)`  →  `[...newest.keys()].map(...)` 10/1
 *        rød: «en kunde uden ét objekt er TIL STEDE med healthy:false».
 *        Det er den mutation der ville få en manglende kunde til at
 *        forsvinde ud af svaret og læses som «fin».
 *   3. `if (!current || ... < at)` → `if (!current)`             10/1
 *        rød: «nyeste vinder uanset rækkefølgen i listningen».
 *   4. `!filename.endsWith('.db.gz')` fjernet                    10/1
 *        rød: «en mappe-markør er ikke en backup».
 *   5. `Number.isFinite(at)`-værnet fjernet                      10/1
 *        rød: «et ulæseligt tidsstempel må ikke blive den nyeste».
 *
 * Streng lighed på tidsstemplet, aldrig «indeholder» — en delstreng-
 * kontrol går grøn på et afkortet eller sammenklistret tidsstempel.
 */
import { test, expect } from 'bun:test';
import {
  assessBackupFreshness,
  readDbBackupStoreConfigFromEnv,
  readMaxAgeHoursFromEnv,
  slugOfKey,
  DEFAULT_MAX_AGE_HOURS,
  type BackupObject,
} from './freshness';

const PREFIX = '_db-backups/';
const NOW = new Date('2026-09-20T10:00:00.000Z');

function obj(slug: string, iso: string, size = 1024): BackupObject {
  const stamp = iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return { key: `${PREFIX}${slug}/${stamp}.db.gz`, lastModified: iso, size };
}

/** Indexed access with an explicit failure — never a silent undefined. */
function at<T>(rows: readonly T[], i: number): T {
  const row = rows[i];
  if (row === undefined) throw new Error(`expected a row at index ${i}, got ${rows.length} rows`);
  return row;
}

test('2 timer gammel ⇒ grøn', () => {
  const row = at(
    assessBackupFreshness(['sanne-andersen'], [obj('sanne-andersen', '2026-09-20T08:00:00.000Z')], {
      now: NOW,
      prefix: PREFIX,
    }),
    0,
  );
  expect(row.healthy).toBe(true);
  expect(row.reason).toBe('ok');
  expect(row.ageHours).toBe(2);
  // Streng lighed — ikke «indeholder».
  expect(row.newestSnapshotAt).toBe('2026-09-20T08:00:00.000Z');
});

test('26 timer gammel ⇒ rød, og siger hvorfor', () => {
  const row = at(
    assessBackupFreshness(['sanne-andersen'], [obj('sanne-andersen', '2026-09-19T08:00:00.000Z')], {
      now: NOW,
      prefix: PREFIX,
    }),
    0,
  );
  expect(row.healthy).toBe(false);
  expect(row.reason).toBe('stale');
  expect(row.ageHours).toBe(26);
});

test('grænsen er inklusiv: præcis 25 timer er stadig grøn, 25,01 er rød', () => {
  const at25 = new Date(NOW.getTime() - DEFAULT_MAX_AGE_HOURS * 3_600_000).toISOString();
  const at25plus = new Date(NOW.getTime() - (DEFAULT_MAX_AGE_HOURS * 3_600_000 + 60_000)).toISOString();
  expect(at(assessBackupFreshness(['t'], [obj('t', at25)], { now: NOW, prefix: PREFIX }), 0).healthy).toBe(true);
  expect(at(assessBackupFreshness(['t'], [obj('t', at25plus)], { now: NOW, prefix: PREFIX }), 0).healthy).toBe(false);
});

test('en kunde UDEN ét objekt er TIL STEDE i svaret med healthy:false — aldrig udeladt', () => {
  const rows = assessBackupFreshness(
    ['broberg-ai', 'sanne-andersen', 'fd-aalborg'],
    [obj('broberg-ai', '2026-09-20T08:00:00.000Z')],
    { now: NOW, prefix: PREFIX },
  );
  expect(rows.map((r) => r.slug)).toEqual(['broberg-ai', 'sanne-andersen', 'fd-aalborg']);
  const sanne = rows.find((r) => r.slug === 'sanne-andersen')!;
  expect(sanne.healthy).toBe(false);
  expect(sanne.reason).toBe('no_snapshot');
  expect(sanne.newestSnapshotAt).toBe(null);
  expect(sanne.ageHours).toBe(null);
  expect(sanne.snapshotCount).toBe(0);
});

test('nyeste vinder uanset rækkefølgen i listningen', () => {
  const rows = assessBackupFreshness(
    ['t'],
    [
      obj('t', '2026-09-18T08:00:00.000Z'),
      obj('t', '2026-09-20T09:00:00.000Z'),
      obj('t', '2026-09-19T08:00:00.000Z'),
    ],
    { now: NOW, prefix: PREFIX },
  );
  expect(at(rows, 0).newestSnapshotAt).toBe('2026-09-20T09:00:00.000Z');
  expect(at(rows, 0).snapshotCount).toBe(3);
  expect(at(rows, 0).healthy).toBe(true);
});

test('en anden kundes objekter smitter ikke — tælling og alder er pr. kunde', () => {
  const rows = assessBackupFreshness(
    ['a', 'b'],
    [obj('a', '2026-09-20T09:00:00.000Z'), obj('b', '2026-09-01T09:00:00.000Z')],
    { now: NOW, prefix: PREFIX },
  );
  expect(at(rows, 0).healthy).toBe(true);
  expect(at(rows, 1).healthy).toBe(false);
  expect(at(rows, 0).snapshotCount).toBe(1);
  expect(at(rows, 1).snapshotCount).toBe(1);
});

test('en mappe-markør eller en fremmed fil er ikke en backup', () => {
  expect(slugOfKey(`${PREFIX}sanne-andersen/`, PREFIX)).toBe(null);
  expect(slugOfKey(`${PREFIX}sanne-andersen/README.txt`, PREFIX)).toBe(null);
  expect(slugOfKey(`${PREFIX}2026-09-20T00Z.db.gz`, PREFIX)).toBe(null); // ingen slug-segment
  expect(slugOfKey(`other-prefix/sanne/x.db.gz`, PREFIX)).toBe(null);
  expect(slugOfKey(`${PREFIX}sanne-andersen/2026-09-20T000000Z.db.gz`, PREFIX)).toBe('sanne-andersen');
});

test('et ulæseligt tidsstempel udelukkes — det må ikke blive den nyeste', () => {
  const rows = assessBackupFreshness(
    ['t'],
    [
      { key: `${PREFIX}t/broken.db.gz`, lastModified: 'not-a-date', size: 1 },
      obj('t', '2026-09-20T09:00:00.000Z'),
    ],
    { now: NOW, prefix: PREFIX },
  );
  expect(at(rows, 0).newestSnapshotAt).toBe('2026-09-20T09:00:00.000Z');
  expect(at(rows, 0).snapshotCount).toBe(1);
});

test('uden alle fire env-felter er butikken IKKE konfigureret (ship dark)', () => {
  const full = {
    TRAIL_DB_BACKUP_S3_ENDPOINT: 'https://fly.storage.tigris.dev',
    TRAIL_DB_BACKUP_S3_BUCKET: 'trail-db-backups',
    TRAIL_DB_BACKUP_S3_ACCESS_KEY_ID: 'id',
    TRAIL_DB_BACKUP_S3_SECRET_ACCESS_KEY: 'secret',
  } as NodeJS.ProcessEnv;
  expect(readDbBackupStoreConfigFromEnv(full)?.prefix).toBe('_db-backups/');
  for (const key of Object.keys(full)) {
    const partial = { ...full, [key]: '' };
    expect(readDbBackupStoreConfigFromEnv(partial)).toBe(null);
  }
});

test('præfikset får altid en afsluttende skråstreg', () => {
  const cfg = readDbBackupStoreConfigFromEnv({
    TRAIL_DB_BACKUP_S3_ENDPOINT: 'https://e',
    TRAIL_DB_BACKUP_S3_BUCKET: 'b',
    TRAIL_DB_BACKUP_S3_ACCESS_KEY_ID: 'id',
    TRAIL_DB_BACKUP_S3_SECRET_ACCESS_KEY: 's',
    TRAIL_DB_BACKUP_S3_PREFIX: 'custom',
  } as NodeJS.ProcessEnv);
  expect(cfg?.prefix).toBe('custom/');
});

test('en ugyldig maxAge falder tilbage på 25 timer i stedet for 0', () => {
  expect(readMaxAgeHoursFromEnv({ TRAIL_DB_BACKUP_MAX_AGE_HOURS: 'abc' } as NodeJS.ProcessEnv)).toBe(25);
  expect(readMaxAgeHoursFromEnv({ TRAIL_DB_BACKUP_MAX_AGE_HOURS: '0' } as NodeJS.ProcessEnv)).toBe(25);
  expect(readMaxAgeHoursFromEnv({ TRAIL_DB_BACKUP_MAX_AGE_HOURS: '-3' } as NodeJS.ProcessEnv)).toBe(25);
  expect(readMaxAgeHoursFromEnv({ TRAIL_DB_BACKUP_MAX_AGE_HOURS: '48' } as NodeJS.ProcessEnv)).toBe(48);
});
