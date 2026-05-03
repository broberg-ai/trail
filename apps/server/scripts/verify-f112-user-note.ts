/**
 * F112 — User-note (Luhmann friction) verify probe.
 *
 * Proves the round-trip works end-to-end + the privacy invariant
 * holds: user_note is NEVER passed as chat context.
 *
 * Run: `cd apps/server && bun run scripts/verify-f112-user-note.ts`
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { eq, and } from 'drizzle-orm';
import {
  createLibsqlDatabase,
  documents,
  knowledgeBases,
  tenants,
  users,
} from '@trail/db';

const REPO_ROOT_DB = join(homedir(), 'Apps/broberg/trail/data/trail.db');
const PROBE_ID = crypto.randomUUID().slice(0, 8);

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures += 1;
  }
}

console.log(`\n=== F112 user-note probe (id: ${PROBE_ID}) ===\n`);

const trail = await createLibsqlDatabase({ path: REPO_ROOT_DB });
await trail.runMigrations();

// 1. Schema sanity — column landed
const cols = await trail.client.execute(`PRAGMA table_info('documents')`);
const colNames = cols.rows.map((r) => r.name as string);
assert(colNames.includes('user_note'), 'user_note column present on documents');

// 2. Pick a real tenant + KB + user + create probe doc
const tenant = await trail.db.select().from(tenants).limit(1).get();
if (!tenant) {
  console.log('  ✗ No tenant in DB');
  process.exit(1);
}
const kb = await trail.db
  .select()
  .from(knowledgeBases)
  .where(eq(knowledgeBases.tenantId, tenant.id))
  .limit(1)
  .get();
if (!kb) {
  console.log('  ✗ No KB for tenant');
  process.exit(1);
}
const user = await trail.db
  .select()
  .from(users)
  .where(eq(users.tenantId, tenant.id))
  .limit(1)
  .get();
if (!user) {
  console.log('  ✗ No user');
  process.exit(1);
}

const docId = `prb_doc_f112_${PROBE_ID}`;
await trail.db
  .insert(documents)
  .values({
    id: docId,
    tenantId: tenant.id,
    knowledgeBaseId: kb.id,
    userId: user.id,
    kind: 'wiki',
    filename: `f112-probe-${PROBE_ID}.md`,
    path: '/neurons/concepts/',
    fileType: 'md',
    fileSize: 100,
    status: 'ready',
    content: '# Probe\n\nLLM-compiled body.',
  })
  .run();

// 3. Initial state — user_note is NULL
let row = await trail.db
  .select({ userNote: documents.userNote })
  .from(documents)
  .where(eq(documents.id, docId))
  .get();
assert(row?.userNote === null, 'user_note is NULL on a fresh row');

// 4. Update — set a note
await trail.db
  .update(documents)
  .set({ userNote: 'This is my reflection: I disagree with the framing.' })
  .where(eq(documents.id, docId))
  .run();

row = await trail.db
  .select({ userNote: documents.userNote })
  .from(documents)
  .where(eq(documents.id, docId))
  .get();
assert(
  row?.userNote === 'This is my reflection: I disagree with the framing.',
  'user_note round-trip works',
);

// 5. Survive a content rewrite (simulate re-ingest)
await trail.db
  .update(documents)
  .set({
    content: '# Probe\n\nLLM RE-COMPILED body — different text.',
    version: 2,
  })
  .where(eq(documents.id, docId))
  .run();

row = await trail.db
  .select({
    userNote: documents.userNote,
    content: documents.content,
    version: documents.version,
  })
  .from(documents)
  .where(eq(documents.id, docId))
  .get();
assert(
  row?.userNote === 'This is my reflection: I disagree with the framing.',
  'user_note survives a content rewrite (simulated re-ingest)',
);
assert(row?.version === 2, 'version bumped on the rewrite');
assert(
  row?.content?.includes('RE-COMPILED'),
  'content was actually rewritten',
);

// 6. Clear via NULL
await trail.db
  .update(documents)
  .set({ userNote: null })
  .where(eq(documents.id, docId))
  .run();
row = await trail.db
  .select({ userNote: documents.userNote })
  .from(documents)
  .where(eq(documents.id, docId))
  .get();
assert(row?.userNote === null, 'user_note clears via NULL update');

// 7. Privacy invariant: chat retrieveContext SELECTs from
// document_chunks, not documents.user_note. Verify the chunk-search
// surface doesn't expose user_note via grep on the route source.
// (Static probe; no live HTTP call needed.)
const chatRouteSrc = await Bun.file(
  join(import.meta.dirname, '../src/routes/chat.ts'),
).text();
const retrieveSrc = await Bun.file(
  join(import.meta.dirname, '../src/routes/retrieve.ts'),
).text();
assert(
  !chatRouteSrc.includes('userNote') && !chatRouteSrc.includes('user_note'),
  'chat.ts does NOT reference user_note column (privacy invariant)',
);
assert(
  !retrieveSrc.includes('userNote') && !retrieveSrc.includes('user_note'),
  'retrieve.ts (F160) does NOT reference user_note (privacy invariant)',
);

// Cleanup
await trail.db.delete(documents).where(eq(documents.id, docId)).run();

await trail.close();

console.log(
  `\n${failures === 0 ? '✓ All assertions passed' : `✗ ${failures} assertion(s) failed`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
