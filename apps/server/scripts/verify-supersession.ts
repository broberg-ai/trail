/**
 * F182.5 verification — auto-supersession chain end-to-end on a real migrated
 * libSQL DB (plan-doc Verification steps 6-10).
 *
 *   AC[0]  decideSupersession returns the correct directed decision past
 *          threshold, and a 'supersede' candidate is created + auto-approved.
 *   AC[1]  approval writes a 'supersedes' wiki_backlinks edge (new→old) and
 *          sets old.superseded_by_neuron_id, with the old Neuron preserved
 *          (not archived/deleted).
 *   AC[2]  an activity_log row kind='neuron.superseded' is recorded.
 *
 * Also checks the negative case: equal-confidence Neurons → no supersession.
 *
 * Run:  bun run apps/server/scripts/verify-supersession.ts
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runMigrationsByHash, schema, type TrailDatabase } from '@trail/db';
import { createCandidate } from '@trail/core';
import { decideSupersession } from '../src/services/supersession.js';

const DBF = join(tmpdir(), `verify-supersede-${process.pid}-${Date.now()}.db`);
const MIGRATIONS = resolve(import.meta.dir, '../../../packages/db/drizzle');

let failures = 0;
function assert(c: boolean, m: string) { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failures++; }

const client = createClient({ url: `file:${DBF}` });
try {
  await client.execute('PRAGMA foreign_keys = ON');
  await runMigrationsByHash(client, MIGRATIONS);

  await client.execute("INSERT INTO tenants (id, slug, name) VALUES ('t1','t1','T1')");
  await client.execute("INSERT INTO users (id, tenant_id, email) VALUES ('u1','t1','a@b.c')");
  await client.execute("INSERT INTO knowledge_bases (id, tenant_id, slug, name, created_by) VALUES ('k1','t1','k1','K1','u1')");
  const mkDoc = async (id: string, kind: string, confidence: number) =>
    client.execute(
      `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path, confidence)
       VALUES ('${id}','t1','k1','u1','${kind}','${id}.md','md','/neurons/concepts/',${confidence})`,
    );
  // Two contradicting Neurons: 'new' is strong (0.9, 2 sources), 'old' is weak (0.5, 1 source).
  await mkDoc('new', 'wiki', 0.9);
  await mkDoc('old', 'wiki', 0.5);
  await mkDoc('s1', 'source', 0.7);
  await mkDoc('s2', 'source', 0.7);
  const mkRef = async (id: string, wiki: string, src: string) =>
    client.execute(
      `INSERT INTO document_references (id, tenant_id, knowledge_base_id, wiki_document_id, source_document_id) VALUES ('${id}','t1','k1','${wiki}','${src}')`,
    );
  await mkRef('r1', 'new', 's1');
  await mkRef('r2', 'new', 's2');
  await mkRef('r3', 'old', 's1');

  const trail = { db: drizzle(client, { schema }) } as unknown as TrailDatabase;

  console.log('1. AC[0] — decideSupersession picks the dominant Neuron');
  const decision = await decideSupersession(trail, 't1', 'new', 'old');
  assert(decision?.targetNeuronId === 'old', `target = old (got ${decision?.targetNeuronId})`);
  assert(decision?.replacementNeuronId === 'new', `replacement = new (got ${decision?.replacementNeuronId})`);
  assert(Math.abs((decision?.confidenceDelta ?? 0) - 0.4) < 1e-6, `Δconfidence = 0.40 (got ${decision?.confidenceDelta?.toFixed(2)})`);

  console.log('\n   negative case — equal confidence → no supersession');
  await mkDoc('eqA', 'wiki', 0.7);
  await mkDoc('eqB', 'wiki', 0.7);
  const none = await decideSupersession(trail, 't1', 'eqA', 'eqB');
  assert(none === null, 'equal-confidence pair → null (curator review)');

  console.log('\n2. AC[0] — supersede candidate is created + auto-approved');
  const { candidate, approval } = await createCandidate(
    trail,
    't1',
    {
      knowledgeBaseId: 'k1',
      kind: 'supersede',
      title: 'Supersede: new vs old',
      content: 'new supersedes old',
      metadata: JSON.stringify({
        op: 'supersede',
        source: 'supersession-lint',
        targetNeuronId: decision!.targetNeuronId,
        replacementNeuronId: decision!.replacementNeuronId,
        confidenceDelta: decision!.confidenceDelta,
        autoSupersede: true,
      }),
      confidence: decision!.replacementConfidence,
      actions: [
        {
          id: 'supersede',
          effect: 'supersede',
          args: { documentId: decision!.targetNeuronId, replacementNeuronId: decision!.replacementNeuronId },
          label: { en: 'Supersede' },
          explanation: { en: 'Mark old superseded by new.' },
        },
      ],
    },
    { id: 'system:supersession-lint', kind: 'system' },
  );
  assert(candidate.kind === 'supersede', `candidate kind = supersede`);
  assert(!!approval && approval.status === 'approved', `auto-approved (status=${approval?.status})`);
  assert(approval?.documentId === 'old', `resolution documentId = old (superseded subject) (got ${approval?.documentId})`);

  console.log('\n3. AC[1] — supersedes edge + superseded_by_neuron_id, old preserved');
  const edge = (await client.execute("SELECT from_document_id AS f, to_document_id AS t, edge_type AS e FROM wiki_backlinks WHERE edge_type='supersedes'")).rows[0] as { f: string; t: string; e: string } | undefined;
  assert(edge?.f === 'new' && edge?.t === 'old', `supersedes edge new→old (got ${edge?.f}→${edge?.t})`);
  const oldRow = (await client.execute("SELECT superseded_by_neuron_id AS s, archived AS a FROM documents WHERE id='old'")).rows[0] as { s: string | null; a: number };
  assert(oldRow.s === 'new', `old.superseded_by_neuron_id = new (got ${oldRow.s})`);
  assert(Number(oldRow.a) === 0, `old Neuron preserved, not archived (archived=${oldRow.a})`);

  console.log('\n4. AC[2] — activity_log kind=neuron.superseded');
  const act = (await client.execute("SELECT count(*) AS n FROM activity_log WHERE kind='neuron.superseded' AND subject_id='old'")).rows[0] as { n: number };
  assert(Number(act.n) >= 1, `neuron.superseded activity row recorded (got ${act.n})`);
} finally {
  client.close();
  for (const ext of ['', '-wal', '-shm']) rmSync(DBF + ext, { force: true });
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
