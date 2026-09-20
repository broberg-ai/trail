/**
 * F212.2 — EN FEJLET SNAPSHOT MÅ IKKE EFTERLADE SIN FIL.
 *
 * Kravet er skrevet som «staging-mappen holder PRÆCIS samme antal filer som
 * før passet» — ikke «færre end N». Forskellen er bærende: en oprydning der
 * fjerner ni af ti filer består en «færre end»-påstand og efterlader stadig
 * en fil pr. fejl, altså præcis den ophobning der fyldte disken.
 *
 * FEJLEN REPRODUCERES MED PRODUKTIONENS EGEN MEKANISME, ikke med en opdigtet
 * fejl: `ALTER TABLE … ADD COLUMN c real NOT NULL DEFAULT 0.7`. SQLite
 * omskriver ikke eksisterende rækker ved ADD COLUMN, så den gamle række har
 * fysisk ingen værdi der hvor skemaet siger NOT NULL — og `integrity_check`
 * melder en overtrædelse der ikke findes på SQL-niveau. Epicens egen måling
 * viser at netop `real` er den ENESTE af de tolv ALTER-tilføjede kolonner i
 * skemaet der udløser det. En kunstig fejl (fx en slettet fil) ville have
 * bevist noget andet end det der skete i produktionen.
 *
 * MÅLT PÅ PROD 27/8 2026: 68 fejl × ~110 MB = 7,4 GB i
 * /data/backups/staging, en 10 GB-disk 99,8 % fuld, og 75 minutters
 * crash-loop på SQLITE_FULL. De to levende databaser var tilsammen 194 MB.
 *
 * MUTATIONS-TJEK, kørt 20. september 2026. Baseline 5/5 grønne:
 *   - fjern `unlink(rawPath)` i den nye catch              2 pass / 3 fail
 *       rød: enkelttilfældet, ophobningen (tre fejl i træk) OG
 *       fremmed-fil-prøven. Ophobningen er den der kostede disken.
 *   - fjern HELE catch-blokken (tilstanden FØR dette kort) 2 pass / 3 fail
 *       samme tre. Prøverne måler altså netop den kode kortet indførte.
 *   - fjern `unlink(gzPath)` i den nye catch               5 pass / 0 fail
 *       GRØN, og det skal stå her frem for at blive udeladt: ingen af
 *       prøverne fejler efter at gzip er begyndt, så den linje er
 *       UAFPRØVET. Den står fordi et stat/gzip-nedbrud KAN efterlade en
 *       delvis .db.gz, og en oprydning der kun kender det ene navn er
 *       netop den halve oprydning dette kort findes for. En kendt,
 *       navngivet mangel i dækningen er brugbar; en udeladt er ikke.
 */
import { test, expect } from 'bun:test';
import { createClient } from '@libsql/client';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotDb } from './backup.js';

/** A database whose integrity_check FAILS the way production's did. */
async function makeCorruptReadingDb(dir: string, name: string) {
  const path = join(dir, name);
  const c = createClient({ url: `file:${path}` });
  await c.execute('CREATE TABLE t (id integer primary key, x text)');
  await c.execute("INSERT INTO t (id, x) VALUES (1, 'a')");
  // The one ALTER shape that makes integrity_check complain about rows
  // that are perfectly readable at SQL level.
  await c.execute('ALTER TABLE t ADD COLUMN c real NOT NULL DEFAULT 0.7');
  return c;
}

async function makeHealthyDb(dir: string, name: string) {
  const path = join(dir, name);
  const c = createClient({ url: `file:${path}` });
  await c.execute('CREATE TABLE t (id integer primary key, x text)');
  await c.execute("INSERT INTO t (id, x) VALUES (1, 'a')");
  return c;
}

function files(dir: string): string[] {
  return readdirSync(dir).sort();
}

test('forudsætningen holder: databasen fejler faktisk integrity_check', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'f212-2-pre-'));
  const c = await makeCorruptReadingDb(dir, 'live.db');
  try {
    const rows = (await c.execute('PRAGMA integrity_check')).rows;
    const first = rows[0] ? Object.values(rows[0])[0] : undefined;
    // Uden denne kontrol kunne oprydnings-prøverne bestå fordi der aldrig
    // blev kastet en fejl — en grøn der intet beviser.
    expect(first).not.toBe('ok');
    // Og rækken er fint læsbar på SQL-niveau: fejlen er i aflæsningen, ikke i data.
    const value = (await c.execute('SELECT c FROM t WHERE id = 1')).rows[0];
    expect(value && Object.values(value)[0]).toBe(0.7);
  } finally {
    c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('en integritets-fejl efterlader INTET i staging — præcis samme filantal som før', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'f212-2-fail-'));
  const staging = join(dir, 'staging');
  const c = await makeCorruptReadingDb(dir, 'live.db');
  try {
    // Baseline: mappen findes ikke endnu, så «før» er tom.
    await expect(snapshotDb(c, staging, { basename: 'snap-1' })).rejects.toThrow(
      /integrity_check/,
    );
    expect(files(staging)).toEqual([]);
  } finally {
    c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('to fejl i træk efterlader stadig intet — det var ophobningen der fyldte disken', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'f212-2-twice-'));
  const staging = join(dir, 'staging');
  const c = await makeCorruptReadingDb(dir, 'live.db');
  try {
    for (const id of ['snap-1', 'snap-2', 'snap-3']) {
      await expect(snapshotDb(c, staging, { basename: id })).rejects.toThrow();
    }
    expect(files(staging)).toEqual([]);
  } finally {
    c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('en fil der IKKE er vores røres ikke af oprydningen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'f212-2-foreign-'));
  const staging = join(dir, 'staging');
  const c = await makeCorruptReadingDb(dir, 'live.db');
  try {
    // Et andet pas' fil, midt i sit eget arbejde.
    await expect(snapshotDb(c, staging, { basename: 'mine' })).rejects.toThrow();
    await Bun.write(join(staging, 'someone-elses.db.gz'), 'not mine');
    await expect(snapshotDb(c, staging, { basename: 'mine-again' })).rejects.toThrow();
    expect(files(staging)).toEqual(['someone-elses.db.gz']);
  } finally {
    c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('en LYKKET snapshot efterlader sin .db.gz og intet andet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'f212-2-ok-'));
  const staging = join(dir, 'staging');
  const c = await makeHealthyDb(dir, 'live.db');
  try {
    const snap = await snapshotDb(c, staging, { basename: 'good' });
    // Den ukomprimerede kopi er væk, gzip'en står tilbage — uændret
    // adfærd, og prøven er her så oprydningen ikke kan «rette» sig til
    // også at slette det der lykkedes.
    expect(files(staging)).toEqual(['good.db.gz']);
    expect(snap.path).toBe(join(staging, 'good.db.gz'));
    expect(snap.compressedBytes).toBeGreaterThan(0);
    expect(snap.sha256).toMatch(/^[0-9a-f]{64}$/);
  } finally {
    c.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
