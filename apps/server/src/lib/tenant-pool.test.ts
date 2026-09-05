/**
 * F222.3 — the migration-marker gate MUST fail closed.
 *
 * The failure shape this seals against (from the card): a migrated
 * database that is missing rows answers perfectly for everything it
 * still has — the gaps are invisible until a customer asks. So an
 * engine pointed at a remote DB without a COMPLETED migration marker
 * must refuse to serve, and these tests are the RED wire: break the
 * gate and they go red.
 */
import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibsqlDatabase } from '@trail/db';
import { assertMigrationComplete, remoteTenantConfig } from './tenant-pool.js';

const dir = mkdtempSync(join(tmpdir(), 'f222-gate-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function freshDb(name: string) {
  return createLibsqlDatabase({ path: join(dir, `${name}.db`) });
}

describe('F222.3 migration-marker gate', () => {
  test('NEGATIV KONTROL: en database UDEN marker-tabel afvises', async () => {
    const db = await freshDb('no-table');
    await expect(assertMigrationComplete(db, 'fd-aalborg')).rejects.toThrow(/no .*migration marker|refusing/);
    await db.close();
  });

  test('en database med marker-tabel men UDEN denne tenants række afvises', async () => {
    const db = await freshDb('wrong-slug');
    await db.execute(
      `CREATE TABLE trail_migration (tenant_slug TEXT PRIMARY KEY, completed_at TEXT, source_rowcounts TEXT, verified TEXT)`,
    );
    await db.execute(
      `INSERT INTO trail_migration (tenant_slug, completed_at) VALUES ('en-anden-tenant', '2026-09-05T00:00:00Z')`,
    );
    await expect(assertMigrationComplete(db, 'fd-aalborg')).rejects.toThrow(/refusing/);
    await db.close();
  });

  test('en række med tom completed_at afvises — kun en FÆRDIG migrering åbner porten', async () => {
    const db = await freshDb('empty-completed');
    await db.execute(
      `CREATE TABLE trail_migration (tenant_slug TEXT PRIMARY KEY, completed_at TEXT, source_rowcounts TEXT, verified TEXT)`,
    );
    await db.execute(`INSERT INTO trail_migration (tenant_slug) VALUES ('fd-aalborg')`);
    await expect(assertMigrationComplete(db, 'fd-aalborg')).rejects.toThrow(/refusing/);
    await db.close();
  });

  test('en færdig migrering med marker-række passerer porten', async () => {
    const db = await freshDb('complete');
    await db.execute(
      `CREATE TABLE trail_migration (tenant_slug TEXT PRIMARY KEY, completed_at TEXT, source_rowcounts TEXT, verified TEXT)`,
    );
    await db.execute(
      `INSERT INTO trail_migration (tenant_slug, completed_at, verified) VALUES ('fd-aalborg', '2026-09-05T07:00:00Z', 'rowcounts+fts')`,
    );
    await expect(assertMigrationComplete(db, 'fd-aalborg')).resolves.toBeUndefined();
    await db.close();
  });
});

describe('F222.3 remote-config parsing', () => {
  test('ugyldig TRAIL_DB_REMOTE kaster højt i stedet for at falde tavst tilbage til disken', () => {
    process.env.TRAIL_DB_REMOTE = '{not json';
    expect(() => remoteTenantConfig()).toThrow(/not valid JSON/);
    delete process.env.TRAIL_DB_REMOTE;
  });

  test('fraværende TRAIL_DB_REMOTE betyder ingen fjern-tenants (ship dark)', () => {
    delete process.env.TRAIL_DB_REMOTE;
    expect(remoteTenantConfig()).toEqual({});
  });
});
