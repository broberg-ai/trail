/**
 * F191 runtime proof — the `/documents/:docId/local-recompile` re-park path.
 * Proves, against a FRESH migrated DB (not inference), that the exact UPDATE
 * the endpoint runs turns a FAILED source back into a PARKED one:
 *   before: status='failed', awaiting_local_compile=0, error_message set
 *   after:  status='ready',  awaiting_local_compile=1, error_message NULL
 * so the source rejoins the awaitingLocalCompile=true queue the next
 * /local-ingest drain reads. FK off — isolated probe of the transition.
 * Run with `bun run`.
 */
import { createLibsqlDatabase } from '@trail/db';
import { existsSync, rmSync } from 'node:fs';

const path = '/tmp/f191-recompile-verify.db';
for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);

const trail = await createLibsqlDatabase({ path });
await trail.runMigrations();

await trail.execute('PRAGMA foreign_keys = OFF');

// Seed a source in the FAILED-local-compile state.
await trail.execute(
  "INSERT INTO documents (id,tenant_id,knowledge_base_id,user_id,kind,filename,file_type,status,awaiting_local_compile,error_message) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ['d-failed', 't1', 'k1', 'u1', 'source', 'x.md', 'md', 'failed', 0, 'local-ingest compile produced no Neurons'],
);

const before = await trail.execute(
  "SELECT status, awaiting_local_compile AS f, error_message AS e FROM documents WHERE id='d-failed'",
);
console.log('before:', JSON.stringify(before.rows[0]));

// The EXACT SET the /local-recompile handler applies.
await trail.execute(
  "UPDATE documents SET awaiting_local_compile=1, status='ready', error_message=NULL, updated_at=? WHERE id='d-failed' AND kind='source'",
  [new Date('2026-06-04T00:00:00Z').toISOString()],
);

const after = await trail.execute(
  "SELECT status, awaiting_local_compile AS f, error_message AS e FROM documents WHERE id='d-failed'",
);
console.log('after: ', JSON.stringify(after.rows[0]));

// And it rejoins the pending queue.
const pending = await trail.execute(
  "SELECT id FROM documents WHERE awaiting_local_compile = 1",
);
console.log('pending(filter):', JSON.stringify(pending.rows));

const a = after.rows[0]!;
const ok =
  a.status === 'ready' &&
  Number(a.f) === 1 &&
  a.e === null &&
  pending.rows.length === 1 &&
  pending.rows[0]!.id === 'd-failed';

console.log(
  ok
    ? '✓ F191 verified: re-park flips failed→ready, sets awaiting=1, clears error, and the source rejoins the pending queue'
    : '✗ F191 re-park FAILED',
);
if (!ok) process.exit(1);
