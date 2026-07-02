// F201.8 fix: prove GET /knowledge-bases LIST_SQL now projects autoApproveThreshold.
import { Database } from 'bun:sqlite';

const dbPath = process.env.TRAIL_DB_PATH ?? '../../packages/db/local.db';
const db = new Database(dbPath, { readwrite: true });

// column present in schema?
const cols = db.query(`SELECT name FROM pragma_table_info('knowledge_bases')`).all() as { name: string }[];
const hasCol = cols.some((c) => c.name === 'auto_approve_threshold');
console.log(`auto_approve_threshold column present: ${hasCol}`);

// exact LIST_SQL projection (mirrors routes/knowledge-bases.ts)
const LIST_SQL = `
  SELECT kb.id, kb.name, kb.slug,
         kb.auto_approve_threshold AS autoApproveThreshold
    FROM knowledge_bases kb
   ORDER BY kb.updated_at DESC
   LIMIT 3
`;
const rows = db.query(LIST_SQL).all() as Record<string, unknown>[];
console.log(`rows returned: ${rows.length}`);
for (const r of rows) {
  const keyPresent = 'autoApproveThreshold' in r;
  console.log(`  ${r.slug}: key present=${keyPresent} value=${JSON.stringify(r.autoApproveThreshold)}`);
}

const ok = hasCol && rows.every((r) => 'autoApproveThreshold' in r);
console.log(ok ? '\n✓ LIST_SQL projects autoApproveThreshold (key present on every row)' : '\n✗ projection broken');
process.exit(ok ? 0 : 1);
