/**
 * F182.6 AC[1] verification — decay-aware chat retrieval rules, against a real
 * migrated libSQL DB (no FTS needed: exercises the extracted loadNeuronConfidence
 * + isChatVisible + confidence ranking that retrieveContext uses verbatim).
 *
 *   - hide Neurons < floor (0.3) unless curator-pinned
 *   - hide superseded Neurons (F182.5)
 *   - keep pinned Neurons regardless of confidence (F182.8)
 *   - rank survivors confidence-DESC
 *
 * Run:  bun run apps/server/scripts/verify-chat-decay.ts
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runMigrationsByHash, schema, type TrailDatabase } from '@trail/db';
import {
  loadNeuronConfidence,
  isChatVisible,
  confidenceOf,
  CHAT_HIDE_BELOW,
} from '../src/services/chat-confidence.js';

const DBF = join(tmpdir(), `verify-chatdecay-${process.pid}-${Date.now()}.db`);
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

  const mk = async (id: string, confidence: number, pinned = 0, supersededBy: string | null = null) =>
    client.execute(
      `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type, path, confidence, confidence_pinned, superseded_by_neuron_id)
       VALUES ('${id}','t1','k1','u1','wiki','${id}.md','md','/neurons/concepts/',${confidence},${pinned},${supersededBy ? `'${supersededBy}'` : 'NULL'})`,
    );
  await mk('high', 0.9);
  await mk('mid', 0.6);
  await mk('low', 0.2);            // below floor, not pinned → hidden
  await mk('lowPinned', 0.2, 1);   // below floor but pinned → visible
  await mk('replacement', 0.95);
  await mk('superseded', 0.85, 0, 'replacement'); // high conf but superseded → hidden

  const trail = { db: drizzle(client, { schema }) } as unknown as TrailDatabase;

  console.log(`1. floor = ${CHAT_HIDE_BELOW}`);
  assert(CHAT_HIDE_BELOW === 0.3, 'default chat confidence floor is 0.3');

  console.log('\n2. loadNeuronConfidence reads state');
  const map = await loadNeuronConfidence(trail, 't1', ['high', 'mid', 'low', 'lowPinned', 'superseded', 'replacement']);
  assert(map.get('low')?.confidence === 0.2, 'low confidence read (0.2)');
  assert(map.get('lowPinned')?.pinned === true, 'lowPinned pinned flag read');
  assert(map.get('superseded')?.superseded === true, 'superseded flag read (superseded_by set)');

  console.log('\n3. visibility rules');
  assert(isChatVisible(map.get('high')) === true, 'high (0.9) visible');
  assert(isChatVisible(map.get('mid')) === true, 'mid (0.6) visible');
  assert(isChatVisible(map.get('low')) === false, 'low (0.2, unpinned) hidden');
  assert(isChatVisible(map.get('lowPinned')) === true, 'lowPinned (0.2, pinned) visible');
  assert(isChatVisible(map.get('superseded')) === false, 'superseded (0.85) hidden');
  assert(isChatVisible(undefined) === true, 'unknown Neuron default-visible');

  console.log('\n4. ranking confidence-DESC');
  const ids = ['mid', 'high', 'lowPinned'];
  const ranked = [...ids].sort((a, b) => confidenceOf(map, b) - confidenceOf(map, a));
  assert(ranked[0] === 'high' && ranked[1] === 'mid' && ranked[2] === 'lowPinned', `ranked high>mid>lowPinned (got ${ranked.join('>')})`);
} finally {
  client.close();
  for (const ext of ['', '-wal', '-shm']) rmSync(DBF + ext, { force: true });
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
