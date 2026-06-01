/**
 * F182.7 verification — Memory Health data + decay-rate persistence, on a real
 * migrated libSQL DB.
 *
 *   AC[0]  getMemoryHealth returns the 5-bucket confidence histogram.
 *   AC[1]  the decaying list contains qualifying Neurons (conf<0.5, unpinned,
 *          not superseded, no reinforcement in 30d) and excludes pinned /
 *          recently-reinforced / superseded ones.
 *   AC[2]  superseded chains list the replacement; decay-rate overrides persist
 *          to tenants.settings_json (loadDecayRates) AND the decay job reads
 *          them (a tiny session τ decays a session Neuron far below default).
 *
 * Run:  bun run apps/server/scripts/verify-memory-health.ts
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runMigrationsByHash, schema, type TrailDatabase } from '@trail/db';
import { getMemoryHealth } from '../src/services/memory-health.js';
import { loadDecayRates, saveDecayRates } from '../src/services/tenant-settings.js';
import { runDecayPass } from '../src/services/confidence-decay.js';
import { DEFAULT_DECAY_RATES } from '../src/services/confidence.js';

const DBF = join(tmpdir(), `verify-mh-${process.pid}-${Date.now()}.db`);
const MIGRATIONS = resolve(import.meta.dir, '../../../packages/db/drizzle');
const NOW = Date.now();
const DAY = 24 * 3600 * 1000;

let failures = 0;
function assert(c: boolean, m: string) { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failures++; }

const client = createClient({ url: `file:${DBF}` });
try {
  await client.execute('PRAGMA foreign_keys = ON');
  await runMigrationsByHash(client, MIGRATIONS);
  await client.execute("INSERT INTO tenants (id, slug, name) VALUES ('t1','t1','T1')");
  await client.execute("INSERT INTO users (id, tenant_id, email) VALUES ('u1','t1','a@b.c')");
  await client.execute("INSERT INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES ('k1','t1','k1','K1','u1')");

  const mk = async (id: string, conf: number, opts: { pinned?: boolean; supersededBy?: string; path?: string; ageDays?: number } = {}) => {
    const createdAt = opts.ageDays != null ? new Date(NOW - opts.ageDays * DAY).toISOString().replace('T', ' ').slice(0, 19) : new Date(NOW).toISOString().replace('T', ' ').slice(0, 19);
    await client.execute(
      `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path, confidence, confidence_pinned, superseded_by_neuron_id, created_at)
       VALUES ('${id}','t1','k1','u1','wiki','${id}.md','md','${opts.path ?? '/neurons/concepts/'}',${conf},${opts.pinned ? 1 : 0},${opts.supersededBy ? `'${opts.supersededBy}'` : 'NULL'},'${createdAt}')`,
    );
  };

  // Histogram fixtures: one per bucket + extras.
  await mk('b0', 0.1);   // [0,0.2)
  await mk('b1', 0.3);   // [0.2,0.4)
  await mk('b2', 0.5);   // [0.4,0.6)
  await mk('b3', 0.7);   // [0.6,0.8)
  await mk('b4', 0.95);  // [0.8,1.0]
  await mk('b4b', 1.0);  // exactly 1.0 → last bucket
  // Decaying-list fixtures (all conf<0.5):
  await mk('decaying1', 0.15);                 // qualifies
  await mk('pinnedLow', 0.15, { pinned: true }); // excluded (pinned)
  await mk('supLow', 0.15, { supersededBy: 'b4' }); // excluded (superseded)
  await mk('recentlyRead', 0.15);              // excluded (recent access signal)
  await client.execute(`INSERT INTO confidence_signals (neuron_id, signal_type, weight, recorded_at) VALUES ('recentlyRead','access',0.1,${NOW - 2 * DAY})`);

  const trail = { db: drizzle(client, { schema }) } as unknown as TrailDatabase;

  console.log('1. AC[0] — 5-bucket histogram');
  const mh = await getMemoryHealth(trail, 't1', 'k1', NOW);
  assert(mh.histogram.length === 5, `histogram has 5 buckets`);
  // b0(0.1), b1(0.3,decaying1? no — decaying1=0.15→b0). Let me just assert totals.
  const total = mh.histogram.reduce((a, b) => a + b, 0);
  assert(total === 10, `histogram counts all 10 wiki Neurons (got ${total})`);
  assert(mh.histogram[4] === 2, `top bucket holds 0.95 + 1.0 (got ${mh.histogram[4]})`);

  console.log('\n2. AC[1] — decaying list filters correctly');
  const decayingIds = new Set(mh.decaying.map((d) => d.id));
  assert(decayingIds.has('decaying1'), 'decaying1 (0.15, unpinned, fresh-signal-free) listed');
  assert(!decayingIds.has('pinnedLow'), 'pinnedLow excluded (pinned)');
  assert(!decayingIds.has('supLow'), 'supLow excluded (superseded)');
  assert(!decayingIds.has('recentlyRead'), 'recentlyRead excluded (access signal in 30d)');
  assert(mh.decaying.every((d) => d.confidence < 0.5), 'all decaying are <0.5');

  console.log('\n3. AC[2] — superseded chains');
  const sup = mh.superseded.find((s) => s.id === 'supLow');
  assert(!!sup && sup.replacementId === 'b4', `supLow chain shows replacement b4 (got ${sup?.replacementId})`);

  console.log('\n4. AC[2] — decay-rate persistence round-trips to settings_json');
  const saved = await saveDecayRates(trail, { session: 5, concept: 730 });
  assert(saved.session === 5, `session τ saved as 5 (got ${saved.session})`);
  assert(saved.concept === 730, `concept τ saved as 730 (got ${saved.concept})`);
  assert(saved.entity === DEFAULT_DECAY_RATES.entity, `untouched type keeps default (entity=${saved.entity})`);
  const reloaded = await loadDecayRates(trail);
  assert(reloaded.session === 5 && reloaded.concept === 730, 'reload reads the persisted overrides');
  const rawSettings = (await client.execute("SELECT settings_json AS s FROM tenants WHERE id='t1'")).rows[0] as { s: string };
  assert(JSON.parse(rawSettings.s).decayRates.session === 5, 'tenants.settings_json holds decayRates.session=5');

  console.log('\n5. AC[2] — the decay job READS the persisted τ override');
  // A session Neuron aged 30d: default τ=30 → recency=exp(-1)≈0.37; override
  // τ=5 → recency=exp(-6)≈0.0025. The override must produce a much lower score.
  await mk('sess', 0.7, { path: '/neurons/sessions/', ageDays: 30 });
  await runDecayPass(trail, NOW);
  const sessConf = ((await client.execute("SELECT confidence FROM documents WHERE id='sess'")).rows[0] as { confidence: number }).confidence;
  // With τ=5 the session Neuron should land well below what τ=30 would give
  // (the single-source floor × exp(-6) ≈ 0.0007). Assert it decayed hard.
  assert(sessConf < 0.05, `session Neuron decayed under the τ=5 override to ${sessConf.toFixed(4)} (<0.05)`);
} finally {
  client.close();
  for (const ext of ['', '-wal', '-shm']) rmSync(DBF + ext, { force: true });
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
