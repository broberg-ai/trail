/**
 * F182.1 verification — applies the full migration chain (incl. 0035) to a
 * throwaway libSQL DB via the repo's hash-based runMigrationsByHash, then
 * asserts BOTH the DDL effect (pragma_table_info) AND the recorded migration
 * hash, per CLAUDE.md's migration rule. Also round-trips a confidence_signals
 * row through real FK parents.
 *
 * Run:  bun run apps/server/scripts/verify-f182-schema.ts
 */
import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runMigrationsByHash } from '@trail/db';

const DB = join(tmpdir(), `verify-f182-${process.pid}-${Date.now()}.db`);
const MIGRATIONS = resolve(import.meta.dir, '../../../packages/db/drizzle');

let failures = 0;
function assert(c: boolean, m: string) { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failures++; }

const client = createClient({ url: `file:${DB}` });
try {
  await client.execute('PRAGMA foreign_keys = ON');
  await runMigrationsByHash(client, MIGRATIONS);

  console.log('\n1. documents new columns (DDL landed)');
  const docCols = (await client.execute("PRAGMA table_info('documents')")).rows.map((r) => (r as { name: string }).name);
  for (const c of ['confidence', 'confidence_last_recomputed_at', 'superseded_by_neuron_id'])
    assert(docCols.includes(c), `documents.${c} present`);

  console.log('\n2. confidence_signals table + index');
  const sigCols = (await client.execute("PRAGMA table_info('confidence_signals')")).rows.map((r) => (r as { name: string }).name);
  for (const c of ['id', 'neuron_id', 'signal_type', 'weight', 'source_neuron_id', 'recorded_at', 'metadata'])
    assert(sigCols.includes(c), `confidence_signals.${c} present`);
  const idx = (await client.execute("PRAGMA index_list('confidence_signals')")).rows.map((r) => (r as { name: string }).name);
  assert(idx.includes('idx_confidence_signals_neuron'), 'idx_confidence_signals_neuron present');

  console.log('\n3. migration hash recorded in __drizzle_migrations');
  const sql0035 = readFileSync(join(MIGRATIONS, '0035_memory_lifecycle_confidence.sql'), 'utf8');
  const hash = createHash('sha256').update(sql0035).digest('hex');
  const applied = new Set((await client.execute('SELECT hash FROM __drizzle_migrations')).rows.map((r) => (r as { hash: string }).hash));
  assert(applied.has(hash), '0035 hash recorded (runner applied it)');

  console.log('\n4. confidence default + signal round-trip through real FK parents');
  await client.execute("INSERT INTO tenants (id, slug, name) VALUES ('t1','t1','T1')");
  await client.execute("INSERT INTO users (id, tenant_id, email) VALUES ('u1','t1','a@b.c')");
  await client.execute("INSERT INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES ('k1','t1','k1','K1','u1')");
  await client.execute("INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type) VALUES ('d1','t1','k1','u1','wiki','x.md','md')");
  const conf = (await client.execute("SELECT confidence FROM documents WHERE id='d1'")).rows[0] as { confidence: number };
  assert(conf.confidence === 0.7, `new document defaults confidence=0.7 (got ${conf.confidence})`);
  await client.execute("INSERT INTO confidence_signals (neuron_id, signal_type, weight, recorded_at) VALUES ('d1','access',1.0,123)");
  const sig = (await client.execute("SELECT neuron_id, signal_type, weight FROM confidence_signals WHERE neuron_id='d1'")).rows[0] as { neuron_id: string; signal_type: string; weight: number };
  assert(sig?.neuron_id === 'd1' && sig.signal_type === 'access' && sig.weight === 1.0, 'confidence_signals row round-trips');
} finally {
  client.close();
  for (const ext of ['', '-wal', '-shm']) rmSync(DB + ext, { force: true });
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
