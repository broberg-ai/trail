/**
 * F222.8 — find every query that would ask sqld for a whole KB's text at once.
 *
 * Lives here rather than inside the test because it has two callers: the guard
 * in `src/test/no-unbounded-kb-content-scan.test.ts`, and a human driving the
 * migration who needs to SEE the list. A rule that can only be run by the thing
 * that asserts it cannot be used to do the work it is asserting.
 *
 * Run it:  bun run apps/server/scripts/audit-kb-content-scans.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Each root with the floor its enumeration must clear.
 *
 * The floors are MEASURED (21 September 2026, non-test `.ts` under each root:
 * 148 and 26), then halved. A guessed floor is the same mistake this card is
 * about: my first version used a flat 50 and failed `packages/core/src` — a
 * root that has 26 files and is perfectly healthy. Half of a measured count
 * means a legitimate refactor can halve a directory without a false alarm,
 * while a broken walk — which goes to roughly zero — still trips it.
 */
const ROOTS = [
  { path: new URL('../src', import.meta.url).pathname, floor: 74 },
  { path: new URL('../../../packages/core/src', import.meta.url).pathname, floor: 13 },
];

/**
 * Enumerate the TypeScript sources under a root.
 *
 * The liveness check lives INSIDE the enumerator on purpose. A `readFileSync`
 * on a deleted path throws; a LISTING just goes quietly empty — so a guard that
 * walks the filesystem and asserts an absence passes perfectly when it walked
 * nothing at all. Every caller inherits the check by construction, rather than
 * relying on a sibling test that a later tidy-up can delete without seeing the
 * coupling.
 */
function sourceFiles(root: string, floor: number): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.includes('.test.')) out.push(p);
    }
  };
  walk(root);
  if (out.length < floor) {
    throw new Error(
      `enumerated only ${out.length} files under ${root} — expected ${floor}+. ` +
        `The guard cannot prove an absence over a list it never built.`,
    );
  }
  return out;
}

/**
 * The statement a line starts, bounded by the statement's OWN end.
 *
 * Deliberately not a fixed byte window. `kun-neuroner.test.ts` records what a
 * fixed window costs: when `loadVectors` gained pagination its filter moved to
 * character 1.111 and a correct function was failed by a 900-byte window. A
 * window measures DISTANCE, not presence, and it is wrong in both directions.
 */
function statementAt(lines: string[], i: number): string {
  let stmt = '';
  for (let j = i; j < Math.min(i + 40, lines.length); j++) {
    const line = lines[j] ?? '';
    stmt += line + '\n';
    if (/;\s*$/.test(line)) break;
  }
  return stmt;
}

export interface Offender {
  file: string;
  line: number;
}

/** Exported so a future call site can be checked without re-deriving the rule. */
export function unboundedKbContentScans(roots = ROOTS): Offender[] {
  const found: Offender[] = [];
  for (const root of roots) {
    for (const file of sourceFiles(root.path, root.floor)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const opensQuery = /\.select\(\s*\{/.test(line) || /execute\(|sql`|`SELECT/i.test(line);
        if (!opensQuery) continue;

        const stmt = statementAt(lines, i);

        const selectsContent =
          /content:\s*documents\.content/.test(stmt) ||
          /SELECT[^;]*\bcontent\b[^;]*FROM\s+documents/is.test(stmt);
        if (!selectsContent) continue;

        // An AGGREGATE over content returns ONE row, however large the table.
        // `kb-size.ts` sums LENGTH(content) across a whole KB and is correct.
        if (/\b(SUM|COUNT|AVG|MAX|MIN)\s*\(\s*(LENGTH\s*\()?\s*d?\.?content/i.test(stmt)) continue;

        // The KB scope has to be in the FILTER, not merely among the selected
        // columns — and that distinction is the whole predicate.
        //
        // My first version tested the statement as a whole, which is wrong in
        // the dangerous direction as well as the noisy one. It flagged
        // `contradiction-lint.ts`, which fetches ONE document by id and simply
        // happens to SELECT `knowledgeBaseId` as a column; and it would have
        // cleared a genuine whole-KB scan that filtered on a variable without
        // naming the column. A query that selects a column tells you nothing
        // about how many rows come back. The WHERE clause is what does.
        const where = stmt.slice(Math.max(stmt.search(/\.where\(|\bWHERE\b/i), 0));
        const wholeKb =
          /\.where\(|\bWHERE\b/i.test(stmt) && /knowledgeBaseId|knowledge_base_id/.test(where);
        if (!wholeKb) continue;

        // A filter on a single document id bounds the result at one row,
        // however the rest of the WHERE is written.
        if (/documents\.id\s*,|\bd?\.?id\s*=\s*\?/.test(where) && /\.get\(\)|\bLIMIT 1\b/i.test(stmt))
          continue;

        // An explicit id LIST bounds the result at the list's length — the KB
        // filter beside it is a scope check, not the thing that decides the row
        // count. `search.ts` reads exactly this shape: it has already chosen
        // which documents it wants and asks for those.
        if (/\bid\s+IN\s*\(|inArray\s*\(/i.test(where)) continue;

        if (/\.limit\(|\bLIMIT\b/i.test(stmt)) continue;

        found.push({ file: file.replace(/^.*\/(apps|packages)\//, '$1/'), line: i + 1 });
      }
    }
  }
  return found;
}

// Running the file directly prints the live list — the migration's worklist.
if (import.meta.main) {
  const live = unboundedKbContentScans();
  const ui = live.filter((o) => o.file.includes('/routes/'));
  console.log(`${live.length} ubegraensede fuld-KB content-scanninger (${ui.length} brugervendte):\n`);
  for (const o of live) {
    console.log(`  '${o.file}:${o.line}',${o.file.includes('/routes/') ? '  // BRUGERVENDT' : ''}`);
  }
}
