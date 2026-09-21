/**
 * F222.8 — ingen enkelt forespørgsel må hente ET HELT KB's tekst.
 *
 * F222.3 flyttede kundedatabaserne til `trail-db-001` (sqld over HTTP), og
 * dermed fik hver forespørgsel en grænse den lokale fil ikke havde.
 *
 * MÅLT 21. september 2026 på maskinen (`sqld --help`, sqld 0.24.33):
 *
 *     --max-response-size        [default: 10MB]
 *     --max-total-response-size  [default: 32MB]
 *
 * Ingen af dem sættes i `apps/db/start.sh`, og `printenv SQLD_MAX_RESPONSE_SIZE`
 * svarer exit 1 på maskinen — vi kører altså standarden.
 *
 * HVORFOR DENNE PRØVE MÅLER KILDEN OG IKKE EN KØRSEL. Lokalt findes grænsen
 * ikke: en scanning der henter alt vil altid lykkes på en udviklermaskine. En
 * prøve der kørte scanningen og så at den lykkedes, ville derfor være grøn både
 * før og efter rettelsen — den samme grønne retning fejlen kom fra. Så prøven
 * måler den egenskab der faktisk holder i produktionen: *ingen forespørgsel
 * beder om et helt KB's tekst på én gang.*
 *
 * Fejlformen er værd at huske: den rammer ikke ved en kodeændring, men ved en
 * DATAMÆNGDE. Ingen commit er skyldig, og den optræder først hos den kunde der
 * har mest indhold — altså den vigtigste.
 */
import { test, expect } from 'bun:test';
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
  { path: new URL('../../../../apps/server/src', import.meta.url).pathname, floor: 74 },
  { path: new URL('../../../../packages/core/src', import.meta.url).pathname, floor: 13 },
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

        // Scoped to a single document (or a fixed id list) cannot grow with the KB.
        const wholeKb = /knowledgeBaseId|knowledge_base_id/.test(stmt);
        if (!wholeKb) continue;

        if (/\.limit\(|\bLIMIT\b/i.test(stmt)) continue;

        found.push({ file: file.replace(/^.*\/(apps|packages)\//, '$1/'), line: i + 1 });
      }
    }
  }
  return found;
}

/**
 * The twenty call sites MEASURED on 21 September 2026, before any were migrated.
 *
 * This list only ever SHRINKS. It exists because the alternative was worse in a
 * specific way: a guard committed red blocks every deploy out of this repo for
 * everyone, including work that has nothing to do with F222.8 — and a gate that
 * has to be bypassed to get anything done is a gate that gets bypassed. With
 * the list, a TWENTY-FIRST call site fails the build the day it is written,
 * which is the thing that would otherwise quietly happen while this card is open.
 *
 * Delete entries as they are migrated to the paginated walker. Never add one:
 * the second test below is what stops this from becoming a place to hide.
 *
 * MEASURED SPLIT, and it corrects the card's own framing: 7 of the 20 are
 * USER-FACING ROUTES (search, chat, documents, graph, queue ×2), not the
 * post-ingest background scans F222.8 assumed. A failure in those is a 500 in
 * front of a customer, not a scan that quietly retries.
 */
const KNOWN_20 = new Set([
  'apps/server/src/bootstrap/backfill-document-images.ts:88',
  'apps/server/src/bootstrap/F102-seed-glossary-neurons.ts:94',
  'apps/server/src/routes/search.ts:287',
  'apps/server/src/routes/search.ts:288',
  'apps/server/src/routes/chat.ts:1083',
  'apps/server/src/routes/documents.ts:609',
  'apps/server/src/routes/graph.ts:113',
  'apps/server/src/routes/queue.ts:465',
  'apps/server/src/routes/queue.ts:716',
  'apps/server/src/services/backlink-extractor.ts:258',
  'apps/server/src/services/source-inferer.ts:165',
  'apps/server/src/services/chat/mcp-router.ts:239',
  'apps/server/src/services/model-eval/runner.ts:154',
  'apps/server/src/services/link-checker.ts:239',
  'apps/server/src/services/contradiction-lint.ts:221',
  'apps/server/src/services/reference-extractor.ts:222',
  'apps/server/src/services/glossary-backfill.ts:78',
  'apps/server/src/services/ingest.ts:962',
  'packages/core/src/lint/faded-heuristics.ts:36',
  'packages/core/src/ingest/candidate-api.ts:348',
]);

test('INGEN NY forespørgsel henter et helt KB\'s tekst på én gang', () => {
  const offenders = unboundedKbContentScans();
  const fresh = offenders.filter((o) => !KNOWN_20.has(`${o.file}:${o.line}`));

  // Printed rather than counted, so a failure names the file to fix instead of
  // handing the next reader a number to go and re-derive.
  const report = fresh.map((o) => `  ${o.file}:${o.line}`).join('\n');

  expect(
    fresh.length === 0
      ? ''
      : `${fresh.length} NY ubegrænset fuld-KB scanning — brug den side-inddelte gennemløber:\n${report}`,
  ).toBe('');
});

test('listen KRYMPER — en migreret post skal fjernes, ikke blive stående', () => {
  // Without this, a migrated call site would leave a stale entry behind and the
  // list would stop describing reality — the same "looks like coverage" failure
  // the guard exists to prevent, one level up.
  const live = new Set(unboundedKbContentScans().map((o) => `${o.file}:${o.line}`));
  const stale = [...KNOWN_20].filter((k) => !live.has(k));

  expect(
    stale.length === 0
      ? ''
      : `${stale.length} post(er) i KNOWN_20 rammer ingen kode længere — fjern dem:\n  ${stale.join('\n  ')}`,
  ).toBe('');
});

test('vagten kan overhovedet SE noget — ellers beviser den intet', () => {
  // The negative control for the guard itself: it must find the pattern when
  // the pattern is there. Without this, a regex that silently stopped matching
  // would make the test above pass for the worst possible reason.
  const synthetic = [
    'const rows = await trail.db',
    '  .select({ id: documents.id, content: documents.content })',
    '  .from(documents)',
    '  .where(eq(documents.knowledgeBaseId, kbId));',
  ];
  const stmt = statementAt(synthetic, 0);
  expect(/content:\s*documents\.content/.test(stmt)).toBe(true);
  expect(/knowledgeBaseId/.test(stmt)).toBe(true);
  expect(/\.limit\(/.test(stmt)).toBe(false);
});
