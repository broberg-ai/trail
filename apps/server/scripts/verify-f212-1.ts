/**
 * F212.1 — Prove that a snapshot of the engine DB can pass its integrity
 * check again, and that migration 0043 is what makes it pass.
 *
 * Background: every backup since 2026-06-03 failed with
 * "NULL value in documents.confidence". The data was never corrupt —
 * migration 0035 added `confidence real DEFAULT 0.7 NOT NULL`, SQLite left
 * the pre-existing row records short, and PRAGMA integrity_check reads the
 * raw record rather than the materialised default.
 *
 * This script reproduces the production sequence faithfully — seed rows are
 * written BEFORE 0035 runs, exactly as they were in prod — and then asserts:
 *
 *   1. the seeded rows read back as 0.7 even while integrity_check complains
 *      (i.e. the data was always fine — this is what makes it a false alarm)
 *   2. WITHOUT 0043 the check fails            <- negative control
 *   3. WITH 0043 the check returns exactly 'ok'
 *   4. VACUUM INTO of the repaired DB also returns exactly 'ok'
 *      (that copy is the actual backup artefact, so it is the one that counts)
 *   5. the repair did not change a single value
 *
 * Run: bun run apps/server/scripts/verify-f212-1.ts
 */

import { createClient, type Client } from '@libsql/client';
import { runMigrationsByHash } from '@trail/db';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DRIZZLE = join(import.meta.dir, '../../../packages/db/drizzle');
const SEED_ROWS = 25;

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

/** A migrations folder holding only the journal entries with idx <= maxIdx. */
function stagedMigrations(root: string, name: string, maxIdx: number): string {
  const dir = join(root, name);
  cpSync(DRIZZLE, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= maxIdx);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return dir;
}

/** integrity_check as a plain string list, so a 100-row failure is visible. */
async function integrity(c: Client): Promise<string[]> {
  const rows = (await c.execute('PRAGMA integrity_check')).rows as unknown as Array<{
    integrity_check: string;
  }>;
  return rows.map((r) => r.integrity_check);
}

/** Distinct label for the first violation, or 'ok'. */
function summarise(lines: string[]): string {
  if (lines.length === 1 && lines[0] === 'ok') return 'ok';
  return `${lines.length} violation(s): ${lines[0]}`;
}

async function seedPre0035(c: Client): Promise<void> {
  await c.execute("INSERT INTO tenants (id, slug, name) VALUES ('t1', 't1', 'T1')");
  await c.execute("INSERT INTO users (id, tenant_id, email) VALUES ('u1', 't1', 'u1@example.test')");
  await c.execute(
    "INSERT INTO knowledge_bases (id, tenant_id, created_by, name, slug) VALUES ('kb1', 't1', 'u1', 'KB', 'kb')",
  );
  for (let i = 0; i < SEED_ROWS; i++) {
    await c.execute({
      sql: `INSERT INTO documents (id, tenant_id, knowledge_base_id, user_id, kind, filename, file_type)
            VALUES (?, 't1', 'kb1', 'u1', 'neuron', ?, 'md')`,
      args: [`doc-${i}`, `doc-${i}.md`],
    });
  }
}

const root = mkdtempSync(join(tmpdir(), 'f212-'));
mkdirSync(root, { recursive: true });

try {
  const upTo0034 = stagedMigrations(root, 'm-0034', 34);
  const upTo0042 = stagedMigrations(root, 'm-0042', 42); // pre-fix: no 0043
  const upTo0043 = stagedMigrations(root, 'm-0043', 43); // with the repair

  // ── Arm A — the production sequence, WITHOUT the repair ───────────
  const aPath = join(root, 'a.db');
  const a = createClient({ url: `file:${aPath}` });
  await runMigrationsByHash(a, upTo0034);
  await seedPre0035(a);
  await runMigrationsByHash(a, upTo0042);

  const aValues = (await a.execute('SELECT DISTINCT confidence FROM documents')).rows;
  check('1 · the data was never wrong — every seeded row reads 0.7', aValues, [{ confidence: 0.7 }]);

  const aNulls = (await a.execute('SELECT count(*) n FROM documents WHERE confidence IS NULL'))
    .rows[0];
  check('1b · and no row matches `confidence IS NULL`', aNulls, { n: 0 });

  const aCheck = await integrity(a);
  check(
    '2 · NEGATIVE CONTROL — without 0043 the snapshot guard still refuses the DB',
    aCheck.length === 1 && aCheck[0] === 'ok',
    false,
  );
  console.log(`      (arm A integrity_check: ${summarise(aCheck)})`);
  a.close();

  // ── Arm B — the same sequence, WITH the repair ────────────────────
  const bPath = join(root, 'b.db');
  const b = createClient({ url: `file:${bPath}` });
  await runMigrationsByHash(b, upTo0034);
  await seedPre0035(b);
  await runMigrationsByHash(b, upTo0043);

  check('3 · with 0043 the live DB passes', await integrity(b), ['ok']);

  // The backup artefact is the VACUUM copy, not the live file. Check that.
  const copyPath = join(root, 'b-copy.db');
  await b.execute(`VACUUM INTO '${copyPath}'`);
  const bValues = (await b.execute('SELECT DISTINCT confidence FROM documents')).rows;
  check('5 · the repair changed no value', bValues, [{ confidence: 0.7 }]);
  b.close();

  const copy = createClient({ url: `file:${copyPath}` });
  check('4 · the VACUUM copy — the actual backup artefact — passes', await integrity(copy), ['ok']);
  const copyCount = (await copy.execute('SELECT count(*) n FROM documents')).rows[0];
  check('4b · and the copy holds every row', copyCount, { n: SEED_ROWS });
  copy.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
