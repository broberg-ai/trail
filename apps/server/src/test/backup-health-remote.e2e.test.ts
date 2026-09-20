/**
 * F212.5 — PORTEN: `/backups/health` må ikke længere svare på det
 * manifest der er frosset.
 *
 * `scripts/verify-f212-5-backup-freshness.ts` læser den ÆGTE bøtte og
 * er den stærkeste kontrol vi har, men et script ingen kører er teater
 * (CLAUDE.md, Harness-kontrakten). Denne fil er hvad `pnpm test` kører.
 *
 * Prøven rejser en rigtig S3-attrap over HTTP i stedet for at injicere
 * en falsk liste-funktion i ruten. Det er bevidst: så kører prøven den
 * FAKTISKE `createS3BackupLister` — S3-klienten, pagineringen,
 * nøgle-parsningen — og der findes ikke en test-søm i produktionskoden
 * som en fremtidig ændring kan snyde sig igennem.
 *
 * DEN AFGØRENDE PÅSTAND er den fjerde prøve: manifestet på disken bærer
 * en 15 dage gammel «uploaded»-post (præcis som prod gjorde 20/9 2026,
 * frosset 2026-09-04T23:22:07.065Z), og endpointet svarer alligevel
 * healthy:true. Læste ruten stadig manifestet, ville den svare false.
 *
 * DEN ANDEN HALVDEL AF FILEN ER EN SIKKERHEDSPRØVE, og den kom af kortets
 * egen review-runde: første udgave svarede med ÉN RÆKKE PR. KUNDE PÅ
 * MASKINEN. Ruten er åben for enhver indlogget bruger, og `owner` er en
 * rolle INDE I en kunde — så Sannes egen admin ville have kunnet læse
 * broberg-ai's og fd-aalborgs slug, filstørrelse og fejltilstand. Rutens
 * egen docstring lovede «nothing tenant-sensitive» mens koden brød det.
 * Nu er svaret afgrænset til kalderens egen kunde.
 *
 * MUTATIONS-TJEK, kørt 20. september 2026. Baseline 7/7 grønne:
 *   - `if (remoteSlugs.length > 0)` → `if (false)`                    0/7
 *       Hele filen falder, altså er det denne gren prøverne måler.
 *   - `[callerSlug]` → `Object.keys(remoteMap)` (den LÆKKENDE udgave)  2/5
 *       rød: «ÉN KUNDE KAN IKKE SE EN ANDENS». Det er mutationen der
 *       gendanner netop den fejl review-runden fandt.
 *   - `last30Days` tæller hele bøtten igen                            6/1
 *       rød: «tællingen er KALDERENS egne filer». Et totaltal lækker
 *       også — det afslører at der ER andre kunder og hvor mange filer
 *       de har, selv når rækkerne er væk.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLibsqlDatabase, tenants, users, sessions } from '@trail/db';
import { createApp } from '../app.js';

// Two real tenants, because the load-bearing question is no longer only
// "is the number right" but "can one customer see another's".
const T_BRO = 't-bro', U_BRO = 'u-bro';
const T_SAN = 't-san', U_SAN = 'u-san';
const PREFIX = '_db-backups/';
// 15 dage før "nu" i prøven — samme afstand som prod-manifestets frysning.
const STALE_MANIFEST_AT = new Date(Date.now() - 15 * 24 * 3_600_000).toISOString();
const FRESH = new Date(Date.now() - 2 * 3_600_000);
const OLD = new Date(Date.now() - 40 * 3_600_000);

let app: ReturnType<typeof createApp>;
let dataDir: string;
let stub: ReturnType<typeof Bun.serve>;
let dbPath: string;

/** Objects the stub serves, keyed by full object key. */
const OBJECTS: Array<{ key: string; at: Date; size: number }> = [
  { key: `${PREFIX}broberg-ai/2026-09-19T221531Z.db.gz`, at: FRESH, size: 124_223_660 },
  { key: `${PREFIX}broberg-ai/2026-09-18T221531Z.db.gz`, at: OLD, size: 124_000_000 },
  { key: `${PREFIX}fd-aalborg/2026-09-19T221528Z.db.gz`, at: FRESH, size: 1_463_100 },
  // sanne-andersen deliberately absent — a tenant with no backup at all.
  { key: `${PREFIX}stray/README.txt`, at: FRESH, size: 10 },
];

function listXml(): string {
  const contents = OBJECTS.map(
    (o) =>
      `<Contents><Key>${o.key}</Key><LastModified>${o.at.toISOString()}</LastModified>` +
      `<Size>${o.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
  ).join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    `<Name>trail-db-backups</Name><Prefix>${PREFIX}</Prefix>` +
    `<KeyCount>${OBJECTS.length}</KeyCount><MaxKeys>1000</MaxKeys>` +
    `<IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`
  );
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'trail-f212-5-'));
  mkdirSync(join(dataDir, 'backups'), { recursive: true });
  // The frozen manifest, exactly as prod carried it: the newest entry is
  // an `uploaded` from 15 days ago, and nothing since.
  writeFileSync(
    join(dataDir, 'backups', 'manifest.json'),
    JSON.stringify({
      snapshots: [
        {
          id: 'trail_2026-09-04_2322_53b028',
          snappedAt: STALE_MANIFEST_AT,
          trigger: 'scheduled',
          uncompressedBytes: 1,
          compressedBytes: 1,
          sha256: 'x',
          localPath: null,
          remoteUrl: 'r2://trail-backups/trail-db/prod/trail_2026-09-04_2322_53b028.db.gz',
          status: 'uploaded',
        },
      ],
    }),
  );

  stub = Bun.serve({ port: 0, fetch: () => new Response(listXml(), { headers: { 'content-type': 'application/xml' } }) });

  process.env.TRAIL_DATA_DIR = dataDir;
  process.env.TRAIL_DB_REMOTE = JSON.stringify({
    'broberg-ai': 'http://trail-db-001.internal:6002',
    'sanne-andersen': 'http://trail-db-001.internal:6003',
    'fd-aalborg': 'http://trail-db-001.internal:6001',
  });
  // The engine's OWN R2 config stays set — the point is that it is no
  // longer what `healthy` is derived from for a remote tenant.
  process.env.TRAIL_BACKUP_R2_ENDPOINT = 'https://example.invalid';
  process.env.TRAIL_BACKUP_R2_BUCKET = 'trail-backups';
  process.env.TRAIL_BACKUP_R2_ACCESS_KEY_ID = 'id';
  process.env.TRAIL_BACKUP_R2_SECRET_ACCESS_KEY = 'secret';

  dbPath = join(process.env.TMPDIR ?? '/tmp', `bh-${process.env.USER ?? 'x'}-${process.pid}.db`);
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* fresh */ }
  }
  const trail = await createLibsqlDatabase({ path: dbPath });
  await trail.runMigrations();
  await trail.initFTS();
  await trail.db.insert(tenants).values([
    { id: T_BRO, slug: 'broberg-ai', name: 'broberg.ai', plan: 'business' },
    { id: T_SAN, slug: 'sanne-andersen', name: 'Sanne Andersen', plan: 'pro' },
  ]).run();
  await trail.db.insert(users).values([
    { id: U_BRO, tenantId: T_BRO, email: 'bro@local.trail', displayName: 'B', role: 'owner', onboarded: true },
    // Also `owner` — deliberately. `owner` is a role WITHIN a tenant, so a
    // customer's own admin carries it, and a test that gave them a lesser
    // role would prove nothing about the leak.
    { id: U_SAN, tenantId: T_SAN, email: 'san@local.trail', displayName: 'S', role: 'owner', onboarded: true },
  ]).run();
  await trail.db.insert(sessions).values([
    { id: 'sess-bro', userId: U_BRO, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    { id: 'sess-san', userId: U_SAN, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  ]).run();
  app = createApp(trail, new Map([['broberg-ai', trail], ['sanne-andersen', trail]]));
});

afterAll(() => {
  stub?.stop(true);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* best effort */ }
  }
});

type Health = {
  configured: boolean;
  providerType: string;
  healthy: boolean | null;
  lastSuccess: string | null;
  last30Days: number;
  maxAgeHours?: number;
  reason?: string;
  tenants: Array<{
    slug: string;
    newestSnapshotAt: string | null;
    ageHours: number | null;
    snapshotCount: number;
    healthy: boolean | null;
    reason: string;
  }>;
};

function configureStore() {
  process.env.TRAIL_DB_BACKUP_S3_ENDPOINT = `http://127.0.0.1:${stub.port}`;
  process.env.TRAIL_DB_BACKUP_S3_BUCKET = 'trail-db-backups';
  process.env.TRAIL_DB_BACKUP_S3_ACCESS_KEY_ID = 'test-id';
  process.env.TRAIL_DB_BACKUP_S3_SECRET_ACCESS_KEY = 'test-secret';
  process.env.TRAIL_DB_BACKUP_S3_PREFIX = PREFIX;
}

function unconfigureStore() {
  delete process.env.TRAIL_DB_BACKUP_S3_ENDPOINT;
  delete process.env.TRAIL_DB_BACKUP_S3_BUCKET;
  delete process.env.TRAIL_DB_BACKUP_S3_ACCESS_KEY_ID;
  delete process.env.TRAIL_DB_BACKUP_S3_SECRET_ACCESS_KEY;
  delete process.env.TRAIL_DB_BACKUP_S3_PREFIX;
}

async function health(session = 'sess-bro'): Promise<{ status: number; body: Health }> {
  const res = await app.request('http://engine.local/api/v1/backups/health', {
    headers: { Cookie: `session=${session}` },
  });
  return { status: res.status, body: (await res.json()) as Health };
}

test('en fjern-kunde måles på OBJEKTERNE, ikke på manifestet', async () => {
  configureStore();
  const { status, body } = await health();
  expect(status).toBe(200);
  expect(body.configured).toBe(true);
  expect(body.providerType).toBe('db-machine-sidecar');
  // Manifestet på disken siger 15 dage. Svaret gør ikke.
  expect(body.healthy).toBe(true);
  expect(body.lastSuccess).toBe(FRESH.toISOString());
  expect(body.lastSuccess).not.toBe(STALE_MANIFEST_AT);
});

test('svaret bærer kun KALDERENS egen kunde — og alle fire felter', async () => {
  configureStore();
  const { body } = await health();
  expect(body.tenants.map((t) => t.slug)).toEqual(['broberg-ai']);
  const bro = at(body.tenants, 0);
  // Streng lighed på tidsstemplet — aldrig «indeholder».
  expect(bro.newestSnapshotAt).toBe(FRESH.toISOString());
  expect(bro.ageHours).toBeGreaterThan(1.9);
  expect(bro.ageHours).toBeLessThan(2.1);
  expect(bro.snapshotCount).toBe(2);
  expect(bro.healthy).toBe(true);
  expect(bro.reason).toBe('ok');
  expect(body.maxAgeHours).toBe(25);
});

test('ÉN KUNDE KAN IKKE SE EN ANDENS — hverken slug, alder eller fejltilstand', async () => {
  configureStore();
  const bro = (await health('sess-bro')).body;
  const san = (await health('sess-san')).body;

  // Sanne har intet objekt i attrappen. Havde hun kunnet se broberg-ai's
  // række, ville hun kende en anden kundes slug, filstørrelse og status.
  expect(bro.tenants.map((t) => t.slug)).toEqual(['broberg-ai']);
  expect(san.tenants.map((t) => t.slug)).toEqual(['sanne-andersen']);

  const broJson = JSON.stringify(bro);
  expect(broJson).not.toContain('sanne-andersen');
  expect(broJson).not.toContain('fd-aalborg');
  const sanJson = JSON.stringify(san);
  expect(sanJson).not.toContain('broberg-ai');
  expect(sanJson).not.toContain('fd-aalborg');

  // Og hendes eget svar er ÆRLIGT rødt — ikke skjult, kun afgrænset.
  expect(at(san.tenants, 0).healthy).toBe(false);
  expect(at(san.tenants, 0).reason).toBe('no_snapshot');
  expect(san.healthy).toBe(false);
});

test('tællingen «sidste 30 dage» er KALDERENS egne filer, ikke hele bøttens', async () => {
  configureStore();
  const bro = (await health('sess-bro')).body;
  const san = (await health('sess-san')).body;
  // Attrappen har 2 broberg-ai-objekter, 1 fd-aalborg og 1 fremmed fil.
  // Et utilsigtet totaltal ville give 3 til begge.
  expect(bro.last30Days).toBe(2);
  expect(san.last30Days).toBe(0);
});

test('en kunde uden ét objekt er TIL STEDE og rød — aldrig udeladt', async () => {
  configureStore();
  const { body } = await health('sess-san');
  const san = at(body.tenants, 0);
  expect(san.slug).toBe('sanne-andersen');
  expect(san.healthy).toBe(false);
  expect(san.reason).toBe('no_snapshot');
  expect(san.newestSnapshotAt).toBe(null);
  expect(san.snapshotCount).toBe(0);
});

test('en fremmed fil under præfikset tælles ikke som en kundes backup', async () => {
  configureStore();
  const { body } = await health();
  expect(JSON.stringify(body)).not.toContain('stray');
  expect(at(body.tenants, 0).snapshotCount).toBe(2);
});

test('uden butiks-nøglen er svaret IKKE-KONFIGURERET og healthy:null — ikke rødt', async () => {
  unconfigureStore();
  const { body } = await health();
  expect(body.configured).toBe(false);
  expect(body.healthy).toBe(null);
  expect(body.reason).toBe('db_backup_store_not_configured');
  expect(body.tenants).toHaveLength(1);
  expect(at(body.tenants, 0).slug).toBe('broberg-ai');
  expect(at(body.tenants, 0).healthy).toBe(null);
  expect(at(body.tenants, 0).reason).toBe('not_measured');
  configureStore();
});

/** Indexed access with an explicit failure — never a silent undefined. */
function at<T>(rows: readonly T[], i: number): T {
  const row = rows[i];
  if (row === undefined) throw new Error(`expected a row at index ${i}, got ${rows.length} rows`);
  return row;
}
