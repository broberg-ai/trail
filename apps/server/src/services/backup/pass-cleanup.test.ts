/**
 * F212.2 — EN UPLOAD-FEJL BEHOLDER SIN FIL. EN SNAPSHOT-FEJL GØR IKKE.
 *
 * De to halvdele står i samme fil med vilje. Rettelsen i `snapshotDb`
 * rydder op efter en snapshot-fejl, og den mest sandsynlige næste fejl er
 * at nogen «forenkler» den til at rydde op efter ALLE fejl — hvorved det
 * eneste eksemplar af en færdig, komprimeret backup bliver slettet fordi
 * uploadet fejlede. Den fil er brugbar: en operatør kan sende den igen.
 *
 * Oprindeligt design (F153), og det er stadig rigtigt: «Leave the staged
 * .db.gz on disk — the admin can retry manually.»
 *
 * MUTATIONS-TJEK, kørt 20. september 2026. Baseline 4/4 grønne:
 *   - tilføj `await unlinkQuietly(snap.path)` i upload-catch'en i
 *     pass.ts (den overkorrigerende «forenkling»)   3 pass / 1 fail
 *       rød: «en upload-fejl BEHOLDER den komprimerede fil». Det er
 *       præcis den ændring prøven findes for at afvise.
 *   - fjern `if (!dbPath.startsWith('/'))`-afvisningen  3 pass / 1 fail
 *       rød: «en fjern-kunde afvises FØR der skrives noget». Uden den
 *       ville en fjern-kunde skrive en manifest-post og forsøge en
 *       VACUUM der ikke kan lykkes.
 */
import { test, expect } from 'bun:test';
import { createClient } from '@libsql/client';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { runBackupPass } from './pass.js';
import { readManifest } from './manifest.js';
import type { BackupProvider, CloudBackupFile } from './providers/types.js';

/** A provider whose upload ALWAYS fails, and nothing else is exercised. */
function failingProvider(message: string): BackupProvider {
  return {
    id: 'test-failing',
    name: 'Test (test-bucket)',
    upload: () => Promise.reject(new Error(message)),
    list: (): Promise<CloudBackupFile[]> => Promise.resolve([]),
    download: (): Promise<Readable> => Promise.reject(new Error('not used')),
    delete: () => Promise.resolve(),
    test: () => Promise.resolve({ ok: true, message: 'test' }),
  };
}

async function healthyDb(path: string) {
  const c = createClient({ url: `file:${path}` });
  await c.execute('CREATE TABLE t (id integer primary key, x text)');
  await c.execute("INSERT INTO t (id, x) VALUES (1, 'a')");
  c.close();
}

function layout() {
  const root = mkdtempSync(join(tmpdir(), 'f212-2-pass-'));
  const dataDir = join(root, 'data');
  const stagingDir = join(dataDir, 'backups', 'staging');
  const localDir = join(dataDir, 'backups', 'local');
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(localDir, { recursive: true });
  return { root, dataDir, stagingDir, localDir, dbPath: join(root, 'live.db') };
}

test('en upload-fejl BEHOLDER den komprimerede fil — den kan sendes igen', async () => {
  const L = layout();
  await healthyDb(L.dbPath);
  try {
    const result = await runBackupPass({
      dbPath: L.dbPath,
      dataDir: L.dataDir,
      stagingDir: L.stagingDir,
      localDir: L.localDir,
      provider: failingProvider('bucket unreachable'),
      trigger: 'manual',
    });

    expect(result.ok).toBe(false);
    expect(result.snapshot.status).toBe('failed');
    expect(result.snapshot.error).toContain('upload:');

    // Den færdige .db.gz står tilbage — præcis én fil, med passets eget id.
    const staged = readdirSync(L.stagingDir);
    expect(staged).toEqual([`${result.snapshot.id}.db.gz`]);
    // Og den nåede ALDRIG keep-mappen, for rename sker først efter upload.
    expect(readdirSync(L.localDir)).toEqual([]);
  } finally {
    rmSync(L.root, { recursive: true, force: true });
  }
});

test('manifestet kender fejlen med sit eget id og sin egen fejltekst', async () => {
  const L = layout();
  await healthyDb(L.dbPath);
  try {
    const result = await runBackupPass({
      dbPath: L.dbPath,
      dataDir: L.dataDir,
      stagingDir: L.stagingDir,
      localDir: L.localDir,
      provider: failingProvider('bucket unreachable'),
      trigger: 'scheduled',
    });
    const manifest = await readManifest(L.dataDir);
    const row = manifest.snapshots.find((s) => s.id === result.snapshot.id);
    expect(row).toBeDefined();
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('upload: bucket unreachable');
    expect(row!.remoteUrl).toBe(null);
    // Størrelserne er kendte selv om uploadet fejlede — filen ER lavet.
    expect(row!.compressedBytes).toBeGreaterThan(0);
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
  } finally {
    rmSync(L.root, { recursive: true, force: true });
  }
});

test('en LYKKET pass flytter filen til keep-mappen og efterlader staging tom', async () => {
  const L = layout();
  await healthyDb(L.dbPath);
  const uploaded: string[] = [];
  const okProvider: BackupProvider = {
    ...failingProvider('unused'),
    upload: (filename: string) => {
      uploaded.push(filename);
      return Promise.resolve({ key: `prefix/${filename}`, size: 1 });
    },
  };
  try {
    const result = await runBackupPass({
      dbPath: L.dbPath,
      dataDir: L.dataDir,
      stagingDir: L.stagingDir,
      localDir: L.localDir,
      provider: okProvider,
      trigger: 'manual',
    });
    expect(result.ok).toBe(true);
    expect(uploaded).toEqual([`${result.snapshot.id}.db.gz`]);
    expect(readdirSync(L.stagingDir)).toEqual([]);
    expect(readdirSync(L.localDir)).toEqual([`${result.snapshot.id}.db.gz`]);
  } finally {
    rmSync(L.root, { recursive: true, force: true });
  }
});

test('en fjern-kunde afvises FØR der skrives noget — hverken fil eller manifest-post', async () => {
  const L = layout();
  try {
    const result = await runBackupPass({
      dbPath: 'http://trail-db-001.internal:6002',
      dataDir: L.dataDir,
      stagingDir: L.stagingDir,
      localDir: L.localDir,
      provider: failingProvider('unused'),
      trigger: 'scheduled',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('remote_tenant_backup_runs_on_db_machine');
    expect(readdirSync(L.stagingDir)).toEqual([]);
    // Og manifestet er urørt — det er grunden til at prod-manifestet er
    // FROSSET siden 2026-09-04 frem for fuldt af nye fejl-poster (F212.5).
    const manifest = await readManifest(L.dataDir);
    expect(manifest.snapshots).toEqual([]);
  } finally {
    rmSync(L.root, { recursive: true, force: true });
  }
});
