/**
 * F226 runtime proof — the per-Trail minimum image size.
 *
 * Drizzle recording a migration is not the same as the DDL landing, so this
 * asserts BOTH, and then round-trips a real value through the column. It also
 * proves the value can be cleared back to NULL: a field that can only ever be
 * SET looks identical to one that saves correctly, until someone tries to
 * empty it.
 *
 * Run: bun run apps/server/scripts/verify-f226-min-image-px.ts
 */
import { createLibsqlDatabase } from '@trail/db';
import { isImageLargeEnough } from '../src/services/document-images.js';
import { existsSync, rmSync } from 'node:fs';

const path = '/tmp/f226-verify.db';
for (const f of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(f)) rmSync(f);

const trail = await createLibsqlDatabase({ path });
await trail.runMigrations();

let fail = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail++;
};

// 1. The migration is RECORDED.
const j = await trail.execute(
  "SELECT COUNT(*) AS n FROM __drizzle_migrations",
);
check('migrations table exists and has rows', Number((j.rows[0] as any).n) > 0, `${(j.rows[0] as any).n} applied`);

// 2. The DDL actually LANDED — the separate fact.
const col = await trail.execute(
  "SELECT name, type FROM pragma_table_info('knowledge_bases') WHERE name = 'min_image_px'",
);
check('column min_image_px exists on knowledge_bases', col.rows.length === 1, JSON.stringify(col.rows));

// 3. Round-trip a real value, and clear it again.
await trail.execute('PRAGMA foreign_keys = OFF');
await trail.execute(
  "INSERT INTO knowledge_bases (id,tenant_id,created_by,name,slug,language,lint_policy,contradiction_lint_enabled,track_access) VALUES ('kb1','t1','u1','KB','kb','da','trusting',1,1)",
);
const readBack = async () =>
  (await trail.execute("SELECT min_image_px AS v FROM knowledge_bases WHERE id='kb1'")).rows[0] as any;

check('a new Trail starts with NO filter (NULL)', (await readBack()).v === null, `got ${JSON.stringify((await readBack()).v)}`);

await trail.execute("UPDATE knowledge_bases SET min_image_px = 64 WHERE id='kb1'");
check('64 round-trips through the column', Number((await readBack()).v) === 64);

await trail.execute("UPDATE knowledge_bases SET min_image_px = NULL WHERE id='kb1'");
check('NEGATIVE CONTROL — it can be cleared back to NULL', (await readBack()).v === null);

// 4. The filter itself, against the values that decided the default.
console.log('\n── the rule, on the shapes that motivated it ──');
check('a 32x32 bullet is filtered at 64', isImageLargeEnough(32, 32, 64) === false);
check('a 400x400 figure is kept at 64', isImageLargeEnough(400, 400, 64) === true);
check('a 2000x10 divider rule is filtered (smallest side, not area)', isImageLargeEnough(2000, 10, 64) === false);
check('exactly 64x64 is KEPT (>=, not >)', isImageLargeEnough(64, 64, 64) === true);
check('with no threshold set, a 1x1 pixel is still kept', isImageLargeEnough(1, 1, null) === true);

console.log(`\n${fail === 0 ? 'ALLE TJEK BESTÅET' : `${fail} TJEK FEJLEDE`}`);
process.exit(fail === 0 ? 0 : 1);
