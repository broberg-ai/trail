/**
 * F182.4 verification — end-to-end Phase-1 lifecycle path (steps 1-5 of the
 * plan-doc's Verification section). Unlike verify-confidence.ts (pure formula)
 * and verify-decay-job.ts (decay pass with raw-SQL signals), this exercises
 * the *wired* recordReinforcement recorder against a real migrated libSQL DB:
 *
 *   AC[0]  recordReinforcement appends a confidence_signals row with the
 *          correct signal_type for cite / access / chat-cite.
 *   AC[1]  after the oldest Neuron is reinforced, runDecayPass writes
 *          oldest-confidence > newest-confidence.
 *   AC[2]  every recomputed confidence is in [0,1].
 *
 * recordReinforcement is fire-and-forget, so each assertion polls the table
 * until the async insert lands (or times out).
 *
 * Run:  bun run apps/server/scripts/verify-memory-lifecycle.ts
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runMigrationsByHash, schema, type TrailDatabase } from '@trail/db';
import { recordReinforcement } from '../src/services/reinforcement.js';
import { runDecayPass } from '../src/services/confidence-decay.js';

const DBF = join(tmpdir(), `verify-lifecycle-${process.pid}-${Date.now()}.db`);
const MIGRATIONS = resolve(import.meta.dir, '../../../packages/db/drizzle');
const NOW = Date.now(); // real clock: recordReinforcement stamps recorded_at=Date.now()
const DAY = 24 * 3600 * 1000;

let failures = 0;
function assert(c: boolean, m: string) { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failures++; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Poll until the predicate query returns >0, or fail after ~2s. */
async function waitForRow(client: ReturnType<typeof createClient>, sql: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    const n = (await client.execute(sql)).rows[0] as { n: number };
    if (Number(n.n) > 0) return true;
    await sleep(50);
  }
  return false;
}

const client = createClient({ url: `file:${DBF}` });
try {
  await client.execute('PRAGMA foreign_keys = ON');
  await runMigrationsByHash(client, MIGRATIONS);

  await client.execute("INSERT INTO tenants (id, slug, name) VALUES ('t1','t1','T1')");
  await client.execute("INSERT INTO users (id, tenant_id, email) VALUES ('u1','t1','a@b.c')");
  await client.execute("INSERT INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES ('k1','t1','k1','K1','u1')");

  const createdAtStr = (ageDays: number) =>
    new Date(NOW - ageDays * DAY).toISOString().replace('T', ' ').slice(0, 19);
  const insertNeuron = async (id: string, ageDays: number) => {
    await client.execute(
      `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path, created_at)
       VALUES ('${id}','t1','k1','u1','wiki','${id}.md','md','/neurons/concepts/','${createdAtStr(ageDays)}')`,
    );
  };
  await insertNeuron('old', 730);   // 2 years
  await insertNeuron('mid', 200);
  await insertNeuron('fresh', 1);    // 1 day

  const trail = { db: drizzle(client, { schema }) } as unknown as TrailDatabase;

  console.log('1. AC[0] — recordReinforcement appends a row per signal_type');
  recordReinforcement(trail, { neuronId: 'old', signalType: 'cite', sourceNeuronId: 'fresh', metadata: { edgeType: 'relates' } });
  recordReinforcement(trail, { neuronId: 'old', signalType: 'access', metadata: { source: 'chat' } });
  recordReinforcement(trail, { neuronId: 'old', signalType: 'chat-cite' });
  for (const t of ['cite', 'access', 'chat-cite'] as const) {
    const ok = await waitForRow(client, `SELECT count(*) AS n FROM confidence_signals WHERE neuron_id='old' AND signal_type='${t}'`);
    assert(ok, `'${t}' signal row appended`);
  }
  // The 'cite' row carries source provenance + metadata.
  const citeRow = (await client.execute("SELECT source_neuron_id AS s, weight AS w, metadata AS m FROM confidence_signals WHERE neuron_id='old' AND signal_type='cite'")).rows[0] as { s: string; w: number; m: string };
  assert(citeRow.s === 'fresh', `'cite' records source_neuron_id (got ${citeRow.s})`);
  assert(citeRow.w === 0.1, `'cite' default weight 0.1 (got ${citeRow.w})`);
  assert(JSON.parse(citeRow.m).edgeType === 'relates', `'cite' metadata round-trips`);

  console.log('\n2. AC[1] — reinforce oldest, then decay pass writes oldest > newest');
  // 5 recent access reads on the oldest Neuron (recorded "now").
  for (let i = 0; i < 5; i++) recordReinforcement(trail, { neuronId: 'old', signalType: 'access' });
  await waitForRow(client, "SELECT count(*) AS n FROM confidence_signals WHERE neuron_id='old' AND signal_type='access' HAVING count(*) >= 6");
  await sleep(100); // let any straggler inserts land before the pass reads

  // Use a fresh clock for the pass: signals were stamped recorded_at=Date.now()
  // a few ms ago, so the pass clock must be >= those stamps or the boost's
  // ageDays>=0 guard skips them.
  const r = await runDecayPass(trail);
  assert(r.recomputed === 3, `recomputed all 3 Neurons (got ${r.recomputed})`);

  const conf = async (id: string) =>
    (await client.execute(`SELECT confidence FROM documents WHERE id='${id}'`)).rows[0] as { confidence: number };
  const old = (await conf('old')).confidence;
  const mid = (await conf('mid')).confidence;
  const fresh = (await conf('fresh')).confidence;
  console.log(`     old=${old.toFixed(3)} mid=${mid.toFixed(3)} fresh=${fresh.toFixed(3)}`);
  assert(old > fresh, `reinforced oldest (${old.toFixed(3)}) > newest (${fresh.toFixed(3)})`);

  console.log('\n3. AC[2] — all confidences in [0,1]');
  for (const [id, v] of [['old', old], ['mid', mid], ['fresh', fresh]] as const) {
    assert(v >= 0 && v <= 1, `${id}: ${v.toFixed(3)} in [0,1]`);
  }
} finally {
  client.close();
  for (const ext of ['', '-wal', '-shm']) rmSync(DBF + ext, { force: true });
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
