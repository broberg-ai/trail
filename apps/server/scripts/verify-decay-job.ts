/**
 * F182.3 verification — runs the decay PASS end-to-end against a real libSQL
 * DB (full migration chain), not the pure formula. Proves the job actually
 * reads signals, recomputes, and writes documents.confidence +
 * confidence_last_recomputed_at — and that the write-skip is idempotent.
 *
 * Run:  bun run apps/server/scripts/verify-decay-job.ts
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runMigrationsByHash, schema, type TrailDatabase } from '@trail/db';
import { runDecayPass } from '../src/services/confidence-decay.js';

const DBF = join(tmpdir(), `verify-decay-${process.pid}-${Date.now()}.db`);
const MIGRATIONS = resolve(import.meta.dir, '../../../packages/db/drizzle');
const NOW = 1_800_000_000_000; // fixed epoch ms for determinism
const DAY = 24 * 3600 * 1000;

let failures = 0;
function assert(c: boolean, m: string) { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failures++; }

const client = createClient({ url: `file:${DBF}` });
try {
  await client.execute('PRAGMA foreign_keys = ON');
  await runMigrationsByHash(client, MIGRATIONS);

  // Seed FK parents.
  await client.execute("INSERT INTO tenants (id, slug, name) VALUES ('t1','t1','T1')");
  await client.execute("INSERT INTO users (id, tenant_id, email) VALUES ('u1','t1','a@b.c')");
  await client.execute("INSERT INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES ('k1','t1','k1','K1','u1')");

  // Three concept Neurons of differing age. created_at written as the UTC
  // string SQLite uses, derived from NOW so the job's clock (NOW) lines up.
  const createdAtStr = (ageDays: number) =>
    new Date(NOW - ageDays * DAY).toISOString().replace('T', ' ').slice(0, 19);
  const insertNeuron = async (id: string, ageDays: number) => {
    await client.execute(
      `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path, created_at)
       VALUES ('${id}','t1','k1','u1','wiki','${id}.md','md','/neurons/concepts/','${createdAtStr(ageDays)}')`,
    );
  };
  await insertNeuron('fresh', 1);     // 1 day old
  await insertNeuron('mid', 200);     // ~6.5 months
  await insertNeuron('old', 730);     // 2 years — should decay most
  await insertNeuron('oldReinf', 730); // 2 years but reinforced

  // Reinforce `oldReinf` with 5 recent access signals (within 90d window).
  for (let i = 1; i <= 5; i++) {
    await client.execute(
      `INSERT INTO confidence_signals (neuron_id, signal_type, weight, recorded_at) VALUES ('oldReinf','access',0.1,${NOW - i * DAY})`,
    );
  }
  // An archived Neuron the job must NOT touch.
  await client.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path, archived, confidence)
     VALUES ('arch','t1','k1','u1','wiki','arch.md','md','/neurons/concepts/',1,0.7)`,
  );

  const trail = { db: drizzle(client, { schema }) } as unknown as TrailDatabase;

  console.log('1. first pass recomputes + writes');
  const r1 = await runDecayPass(trail, NOW);
  assert(r1.recomputed === 4, `recomputed 4 non-archived wiki Neurons (got ${r1.recomputed})`);
  assert(r1.updated === 4, `wrote all 4 (moved off 0.7 default) (got ${r1.updated})`);

  const conf = async (id: string) =>
    (await client.execute(`SELECT confidence, confidence_last_recomputed_at AS t FROM documents WHERE id='${id}'`)).rows[0] as { confidence: number; t: number | null };

  const fresh = await conf('fresh');
  const mid = await conf('mid');
  const old = await conf('old');
  const oldReinf = await conf('oldReinf');
  const arch = await conf('arch');

  console.log('\n2. age ordering: fresher decays less');
  assert(fresh.confidence > mid.confidence, `fresh (${fresh.confidence.toFixed(3)}) > mid (${mid.confidence.toFixed(3)})`);
  assert(mid.confidence > old.confidence, `mid (${mid.confidence.toFixed(3)}) > old (${old.confidence.toFixed(3)})`);

  console.log('\n3. reinforcement lifts an old Neuron above its bare-decay twin');
  assert(oldReinf.confidence > old.confidence, `oldReinf (${oldReinf.confidence.toFixed(3)}) > old (${old.confidence.toFixed(3)})`);

  console.log('\n4. all values in [0,1] and timestamp stamped');
  for (const [id, c] of [['fresh', fresh], ['mid', mid], ['old', old], ['oldReinf', oldReinf]] as const) {
    assert(c.confidence >= 0 && c.confidence <= 1 && c.t === NOW, `${id}: ${c.confidence.toFixed(3)} in [0,1], recomputed_at set`);
  }

  console.log('\n5. archived Neuron untouched');
  assert(arch.confidence === 0.7 && arch.t === null, `arch still default 0.7, never recomputed`);

  console.log('\n6. write-skip: a second pass at the same clock writes nothing');
  const r2 = await runDecayPass(trail, NOW);
  assert(r2.recomputed === 4 && r2.updated === 0, `re-pass recomputed 4, updated 0 (got recomputed=${r2.recomputed} updated=${r2.updated})`);
} finally {
  client.close();
  for (const ext of ['', '-wal', '-shm']) rmSync(DBF + ext, { force: true });
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
