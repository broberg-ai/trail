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
 * MUTATIONS-TJEK, kørt 20. september 2026. Baseline 6/6 grønne:
 *   - `if (remoteSlugs.length > 0)` → `if (false)`                  0/6
 *       Hele filen falder, altså er det denne gren prøverne måler.
 *   - `tenants.every((t) => t.healthy)` → `tenants.some(...)`       5/1
 *       rød: «ÉN kunde uden backup gør det samlede svar rødt».
 *       Det er mutationen der ville lade to raske kunder dække over
 *       en tredje uden nogen backup — altså den farlige retning.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createLibsqlDatabase, tenants, users, sessions } from '@trail/db';
import { createApp } from '../app.js';

const T = 't-bh', U = 'u-bh';
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
  await trail.db.insert(tenants).values({ id: T, slug: 'bh', name: 'BH', plan: 'hobby' }).run();
  await trail.db
    .insert(users)
    .values({ id: U, tenantId: T, email: 'bh@local.trail', displayName: 'B', role: 'owner', onboarded: true })
    .run();
  await trail.db
    .insert(sessions)
    .values({ id: 'sess-bh', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
    .run();
  app = createApp(trail, new Map([['bh', trail]]));
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

async function health(): Promise<{ status: number; body: Health }> {
  const res = await app.request('http://engine.local/api/v1/backups/health', {
    headers: { Cookie: 'session=sess-bh' },
  });
  return { status: res.status, body: (await res.json()) as Health };
}

test('en fjern-kunde måles på OBJEKTERNE, ikke på manifestet', async () => {
  configureStore();
  // Kun de to kunder der HAR et friskt objekt, så det samlede svar
  // afhænger af objekterne alene. Manifestet på disken siger 15 dage;
  // læste ruten stadig det, ville svaret her være false.
  const allTenants = process.env.TRAIL_DB_REMOTE;
  process.env.TRAIL_DB_REMOTE = JSON.stringify({
    'broberg-ai': 'http://trail-db-001.internal:6002',
    'fd-aalborg': 'http://trail-db-001.internal:6001',
  });
  try {
    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body.configured).toBe(true);
    expect(body.providerType).toBe('db-machine-sidecar');
    expect(body.healthy).toBe(true);
    expect(body.lastSuccess).toBe(FRESH.toISOString());
    expect(body.lastSuccess).not.toBe(STALE_MANIFEST_AT);
  } finally {
    process.env.TRAIL_DB_REMOTE = allTenants;
  }
});

test('ÉN kunde uden backup gør det samlede svar rødt — flertallet må ikke dække den', async () => {
  configureStore();
  const { body } = await health();
  expect(body.healthy).toBe(false);
  expect(body.tenants.filter((t) => t.healthy === true)).toHaveLength(2);
  expect(body.tenants.filter((t) => t.healthy === false)).toHaveLength(1);
});

test('svaret bærer én række pr. konfigureret kunde med alle fire felter', async () => {
  configureStore();
  const { body } = await health();
  expect(body.tenants.map((t) => t.slug).sort()).toEqual(['broberg-ai', 'fd-aalborg', 'sanne-andersen']);
  const bro = body.tenants.find((t) => t.slug === 'broberg-ai')!;
  // Streng lighed på tidsstemplet — aldrig «indeholder».
  expect(bro.newestSnapshotAt).toBe(FRESH.toISOString());
  expect(bro.ageHours).toBeGreaterThan(1.9);
  expect(bro.ageHours).toBeLessThan(2.1);
  expect(bro.snapshotCount).toBe(2);
  expect(bro.healthy).toBe(true);
  expect(bro.reason).toBe('ok');
  expect(body.maxAgeHours).toBe(25);
});

test('en kunde uden ét objekt er TIL STEDE og rød — og trækker det samlede svar ned', async () => {
  configureStore();
  const { body } = await health();
  const sanne = body.tenants.find((t) => t.slug === 'sanne-andersen');
  expect(sanne).toBeDefined();
  expect(sanne!.healthy).toBe(false);
  expect(sanne!.reason).toBe('no_snapshot');
  expect(sanne!.newestSnapshotAt).toBe(null);
  expect(sanne!.snapshotCount).toBe(0);
});

test('en fremmed fil under præfikset tælles ikke som en kundes backup', async () => {
  configureStore();
  const { body } = await health();
  expect(body.tenants.some((t) => t.slug === 'stray')).toBe(false);
  expect(body.tenants.find((t) => t.slug === 'fd-aalborg')!.snapshotCount).toBe(1);
});

test('uden butiks-nøglen er svaret IKKE-KONFIGURERET og healthy:null — ikke rødt', async () => {
  unconfigureStore();
  const { body } = await health();
  expect(body.configured).toBe(false);
  expect(body.healthy).toBe(null);
  expect(body.reason).toBe('db_backup_store_not_configured');
  expect(body.tenants).toHaveLength(3);
  for (const row of body.tenants) {
    expect(row.healthy).toBe(null);
    expect(row.reason).toBe('not_measured');
  }
  configureStore();
});
