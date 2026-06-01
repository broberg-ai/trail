/**
 * F182.8 verification — curator-pin as decay EXEMPTION, end-to-end on a real
 * migrated libSQL DB.
 *
 *   AC[0]  migration 0036 adds confidence_pinned/_at/_by (pragma_table_info)
 *          AND the migration hash is recorded.
 *   AC[1]  a pinned 730d Neuron holds confidence=1.0 after the decay pass
 *          (vs the ~0.04 it decays to unpinned).
 *   AC[2]  pinning records a curator-pin audit row; unpinning reverts so the
 *          next pass recomputes from the formula — and the lingering audit
 *          row does NOT leak a boost (no-leak property).
 *
 * Run:  bun run apps/server/scripts/verify-curator-pin.ts
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runMigrationsByHash, schema, type TrailDatabase } from '@trail/db';
import { recordReinforcement } from '../src/services/reinforcement.js';
import { runDecayPass } from '../src/services/confidence-decay.js';

const DBF = join(tmpdir(), `verify-pin-${process.pid}-${Date.now()}.db`);
const MIGRATIONS = resolve(import.meta.dir, '../../../packages/db/drizzle');
const NOW = Date.now();
const DAY = 24 * 3600 * 1000;

let failures = 0;
function assert(c: boolean, m: string) { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failures++; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const client = createClient({ url: `file:${DBF}` });
try {
  await client.execute('PRAGMA foreign_keys = ON');
  await runMigrationsByHash(client, MIGRATIONS);

  console.log('1. AC[0] — migration 0036 columns + recorded hash');
  const cols = (await client.execute("PRAGMA table_info('documents')")).rows.map((r) => (r as { name: string }).name);
  for (const c of ['confidence_pinned', 'confidence_pinned_at', 'confidence_pinned_by'])
    assert(cols.includes(c), `documents.${c} present`);
  const sql0036 = readFileSync(join(MIGRATIONS, '0036_curator_pin_exemption.sql'), 'utf8');
  const hash = createHash('sha256').update(sql0036).digest('hex');
  const applied = new Set((await client.execute('SELECT hash FROM __drizzle_migrations')).rows.map((r) => (r as { hash: string }).hash));
  assert(applied.has(hash), '0036 hash recorded (runner applied it)');

  await client.execute("INSERT INTO tenants (id, slug, name) VALUES ('t1','t1','T1')");
  await client.execute("INSERT INTO users (id, tenant_id, email) VALUES ('u1','t1','a@b.c')");
  await client.execute("INSERT INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES ('k1','t1','k1','K1','u1')");
  const createdAtStr = (ageDays: number) => new Date(NOW - ageDays * DAY).toISOString().replace('T', ' ').slice(0, 19);
  await client.execute(
    `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path, created_at)
     VALUES ('newton','t1','k1','u1','wiki','newton.md','md','/neurons/concepts/','${createdAtStr(730)}')`,
  );

  const trail = { db: drizzle(client, { schema }) } as unknown as TrailDatabase;
  const conf = async () => ((await client.execute("SELECT confidence FROM documents WHERE id='newton'")).rows[0] as { confidence: number }).confidence;

  console.log('\n2. baseline — unpinned 730d Neuron decays');
  await runDecayPass(trail);
  const decayed = await conf();
  assert(decayed < 0.1, `unpinned 730d decays to ${decayed.toFixed(3)} (<0.1)`);

  console.log('\n3. AC[1] — pinned Neuron holds confidence=1.0');
  await client.execute("UPDATE documents SET confidence_pinned=1, confidence_pinned_at=" + NOW + ", confidence_pinned_by='u1' WHERE id='newton'");
  await runDecayPass(trail);
  const pinned = await conf();
  assert(pinned === 1, `pinned 730d Neuron held at ${pinned.toFixed(3)} (=1.0, decay-exempt)`);

  console.log('\n4. AC[2] — pin records a curator-pin audit row (weight 0)');
  recordReinforcement(trail, { neuronId: 'newton', signalType: 'curator-pin', metadata: { pinned: true, by: 'u1' } });
  for (let i = 0; i < 40; i++) {
    const n = ((await client.execute("SELECT count(*) AS n FROM confidence_signals WHERE neuron_id='newton' AND signal_type='curator-pin'")).rows[0] as { n: number }).n;
    if (Number(n) > 0) break;
    await sleep(50);
  }
  const auditRow = (await client.execute("SELECT weight AS w FROM confidence_signals WHERE neuron_id='newton' AND signal_type='curator-pin'")).rows[0] as { w: number } | undefined;
  assert(!!auditRow, 'curator-pin audit row appended');
  assert(auditRow?.w === 0, `audit row weight is 0 (got ${auditRow?.w}) — excluded from boost`);

  console.log('\n5. AC[2] — unpin reverts to formula, no boost leak from the audit row');
  await client.execute("UPDATE documents SET confidence_pinned=0, confidence_pinned_at=NULL, confidence_pinned_by=NULL WHERE id='newton'");
  await runDecayPass(trail);
  const unpinned = await conf();
  assert(unpinned < 0.1, `unpinned Neuron decays again to ${unpinned.toFixed(3)} (<0.1)`);
  assert(Math.abs(unpinned - decayed) < 1e-6, `no boost leak: post-unpin (${unpinned.toFixed(4)}) == baseline (${decayed.toFixed(4)})`);
} finally {
  client.close();
  for (const ext of ['', '-wal', '-shm']) rmSync(DBF + ext, { force: true });
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
