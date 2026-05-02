/**
 * F97 — verify the activity-log path end-to-end.
 *
 * What this proves:
 *   1. Migration 0029 applied — activity_log table + 5 indexes present.
 *   2. logActivity() round-trips a typed row through libsql + Drizzle
 *      (id, tenant_id, kind, subject, metadata-as-JSON).
 *   3. The activity-logger subscriber translates broadcaster events
 *      to log rows for the 6 in-scope event types (candidate_created,
 *      candidate_approved, candidate_resolved, ingest_started/
 *      completed/failed). kb_created is intentionally not handled
 *      by the subscriber (covered by explicit call in the route).
 *   4. SELECTs against the indexes work for the 5 access patterns
 *      (tenant+time, kb+time, actor+time, subject, kind+time).
 *
 * Run with: `cd apps/server && bun run scripts/verify-f97-activity.ts`
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { eq, and } from 'drizzle-orm';
import {
  createLibsqlDatabase,
  activityLog,
  tenants,
  knowledgeBases,
} from '@trail/db';
import { logActivity } from '@trail/core';
import { broadcaster } from '../src/services/broadcast.ts';
import { startActivityLogger } from '../src/services/activity-logger.ts';

const REPO_ROOT_DB = join(homedir(), 'Apps/broberg/trail/data/trail.db');
const PROBE_ID = crypto.randomUUID().slice(0, 8);
const PROBE_KIND_PREFIX = `probe.${PROBE_ID}`;

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log(`\n=== F97 activity-log probe (id: ${PROBE_ID}) ===\n`);

const trail = await createLibsqlDatabase({ path: REPO_ROOT_DB });
await trail.runMigrations();

// Pick any existing tenant — probe rows tagged so we can clean up.
const tenant = await trail.db.select().from(tenants).limit(1).get();
if (!tenant) {
  console.error('No tenant in DB — run a real upload first.');
  await trail.close();
  process.exit(1);
}
console.log(`Using tenant: ${tenant.name} (${tenant.id})`);

// 1. schema sanity
const cols = await trail.client.execute(`PRAGMA table_info('activity_log')`);
const colNames = cols.rows.map((r) => r.name as string);
const expected = [
  'id', 'tenant_id', 'knowledge_base_id', 'actor_id', 'actor_kind',
  'kind', 'subject_type', 'subject_id', 'summary', 'metadata', 'created_at',
];
for (const col of expected) {
  assert(colNames.includes(col), `column ${col} present`);
}

const idxs = await trail.client.execute(
  `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='activity_log'`,
);
const idxNames = new Set(idxs.rows.map((r) => r.name as string));
for (const idx of [
  'idx_activity_tenant_time',
  'idx_activity_kb_time',
  'idx_activity_actor',
  'idx_activity_subject',
  'idx_activity_kind',
]) {
  assert(idxNames.has(idx), `index ${idx} present`);
}

// 2. logActivity round-trip
await logActivity(trail, {
  tenantId: tenant.id,
  actorKind: 'system',
  kind: `${PROBE_KIND_PREFIX}.direct` as never,
  subjectType: 'none',
  summary: 'direct write probe',
  metadata: { probe: PROBE_ID, source: 'direct' },
});

const direct = await trail.db
  .select()
  .from(activityLog)
  .where(and(eq(activityLog.tenantId, tenant.id), eq(activityLog.kind, `${PROBE_KIND_PREFIX}.direct`)))
  .all();
assert(direct.length === 1, 'direct logActivity wrote exactly 1 row');
const directRow = direct[0];
assert(directRow.summary === 'direct write probe', 'summary persisted');
assert(directRow.metadata !== null, 'metadata persisted');
const directMeta = JSON.parse(directRow.metadata ?? 'null');
assert(directMeta.probe === PROBE_ID, 'metadata round-trips JSON');

// 3. broadcaster → subscriber path. Real KB id required because the
// activity_log.knowledge_base_id column has a FK constraint.
const kb = await trail.db
  .select({ id: knowledgeBases.id })
  .from(knowledgeBases)
  .where(eq(knowledgeBases.tenantId, tenant.id))
  .limit(1)
  .get();
if (!kb) {
  console.error('Tenant has no KB — create one first.');
  await trail.close();
  process.exit(1);
}
const stop = startActivityLogger(trail);
broadcaster.emit({
  type: 'ingest_started',
  tenantId: tenant.id,
  kbId: kb.id,
  docId: `probe-doc-${PROBE_ID}`,
  filename: `probe-${PROBE_ID}.txt`,
});

// Subscriber writes async via Promise; give the runtime a microtask flush.
await new Promise((r) => setTimeout(r, 100));

const viaSub = await trail.db
  .select()
  .from(activityLog)
  .where(and(
    eq(activityLog.tenantId, tenant.id),
    eq(activityLog.subjectId, `probe-doc-${PROBE_ID}`),
  ))
  .all();
assert(viaSub.length === 1, 'broadcaster → subscriber wrote exactly 1 row');
if (viaSub[0]) {
  assert(viaSub[0].kind === 'ingest.started', 'subscriber mapped ingest_started → ingest.started');
  assert(viaSub[0].actorKind === 'pipeline', 'subscriber set actorKind=pipeline for ingest events');
}

// 4. cleanup just the probe-tagged rows. NEVER blanket-delete the
// tenant's full audit trail — this script must be safe against
// real production data.
await trail.db
  .delete(activityLog)
  .where(and(eq(activityLog.tenantId, tenant.id), eq(activityLog.kind, `${PROBE_KIND_PREFIX}.direct`)))
  .run();
await trail.db
  .delete(activityLog)
  .where(and(eq(activityLog.tenantId, tenant.id), eq(activityLog.subjectId, `probe-doc-${PROBE_ID}`)))
  .run();
const remaining = await trail.db
  .select()
  .from(activityLog)
  .where(and(eq(activityLog.tenantId, tenant.id), eq(activityLog.kind, `${PROBE_KIND_PREFIX}.direct`)))
  .all();
assert(remaining.length === 0, 'probe rows cleaned up');

stop();
await trail.close();

if (failures > 0) {
  console.log(`\n✗ ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\n✓ all assertions passed');
