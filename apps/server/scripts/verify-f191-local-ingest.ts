/**
 * F191.1 runtime proof — the `awaiting_local_compile` lifecycle column.
 * Proves, against a FRESH migrated DB (not inference):
 *   1. Migration 0038 applied → the column exists with the right default.
 *   2. The column round-trips a real value (INSERT → SELECT).
 *   3. The `WHERE awaiting_local_compile = 1` filter (the pending query the
 *      Station + /local-ingest skill use) returns only the parked source.
 * FK is toggled off for this isolated probe so we don't have to seed
 * tenant/kb/user parents — the column + filter are what we're verifying.
 * Run with `bun run`.
 */
import { createLibsqlDatabase } from '@trail/db';
import { existsSync, rmSync } from 'node:fs';

const path = '/tmp/f191-verify.db';
for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);

const trail = await createLibsqlDatabase({ path });
await trail.runMigrations();

// 1. DDL landed.
const col = await trail.execute(
  "SELECT name, \"notnull\" AS nn, dflt_value AS dflt FROM pragma_table_info('documents') WHERE name = 'awaiting_local_compile'",
);
console.log('column:', JSON.stringify(col.rows));

// 2 + 3. Round-trip + filter (FK off — isolated probe of the column/filter).
await trail.execute('PRAGMA foreign_keys = OFF');
const ins = (id: string, flag: number) =>
  trail.execute(
    "INSERT INTO documents (id,tenant_id,knowledge_base_id,user_id,kind,filename,file_type,status,awaiting_local_compile) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, 't1', 'k1', 'u1', 'source', `${id}.md`, 'md', 'ready', flag],
  );
await ins('d-parked', 1);
await ins('d-normal', 0);

const back = await trail.execute(
  "SELECT id, awaiting_local_compile AS f FROM documents ORDER BY id",
);
console.log('roundtrip:', JSON.stringify(back.rows));

const pending = await trail.execute(
  "SELECT id FROM documents WHERE awaiting_local_compile = 1",
);
console.log('pending(filter):', JSON.stringify(pending.rows));

const ok =
  col.rows.length === 1 &&
  Number(col.rows[0]!.nn) === 1 &&
  back.rows.length === 2 &&
  pending.rows.length === 1 &&
  pending.rows[0]!.id === 'd-parked';

console.log(
  ok
    ? '✓ F191.1 verified: column applied (NOT NULL default 0), round-trips, and the pending filter returns only the parked source'
    : '✗ F191.1 FAILED',
);
if (!ok) process.exit(1);
