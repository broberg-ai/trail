/**
 * F236 — every column schema.ts declares must exist after the migrations run.
 *
 * WHY THIS GUARD EXISTS, and it came from fd-sundhed via cardmem: a generated
 * artifact is a COPY, and a copy drifts. Their sentence is the whole argument —
 * *"unknown shouts, stale shouts, but a stale file that matches itself lies with
 * a green word."*
 *
 * Trail has that exact shape in its schema. Migrations 0044-0047 were written
 * BY HAND rather than generated from schema.ts, so the two can disagree, and
 * nothing in the build would notice: the ORM keeps typechecking against a
 * column the database does not have, and the failure surfaces at runtime as a
 * silent wrong answer — the failure family this repo met four times in one
 * night.
 *
 * The check runs against a FRESH database built by the real migration runner,
 * not against the SQL text. Reading the .sql files would prove that a string
 * mentions a column, not that applying them produces it.
 */
import { expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import * as schema from './schema.js';
import { createLibsqlDatabase } from './index.js';

const DB = '/tmp/schema-drift-test.db';

async function freshDb() {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
  const trail = await createLibsqlDatabase({ path: DB });
  await trail.runMigrations();
  return trail;
}

const NAME = Symbol.for('drizzle:Name');
const COLUMNS = Symbol.for('drizzle:Columns');

/** Every declared table, as { table: [column, ...] }. */
function declared(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const v of Object.values(schema) as unknown[]) {
    const t = v as Record<symbol, unknown>;
    if (!t || typeof t !== 'object') continue;
    const name = t[NAME] as string | undefined;
    const cols = t[COLUMNS] as Record<string, { name?: string }> | undefined;
    if (!name || !cols) continue;
    out.set(
      name,
      Object.values(cols)
        .map((c) => c?.name)
        .filter((n): n is string => Boolean(n)),
    );
  }
  return out;
}

async function actual(trail: Awaited<ReturnType<typeof freshDb>>, table: string) {
  const info = await trail.execute(`SELECT name FROM pragma_table_info('${table}')`);
  return new Set(info.rows.map((r) => String((r as { name: string }).name)));
}

test('every column schema.ts declares exists after the migrations run', async () => {
  const trail = await freshDb();
  const decl = declared();

  // PRECONDITION — the reflection must actually have found the schema. An empty
  // map would make the loop below pass without examining anything, which is the
  // green-for-no-reason shape this file exists to prevent.
  expect(decl.size).toBeGreaterThan(20);
  const totalCols = [...decl.values()].reduce((n, c) => n + c.length, 0);
  expect(totalCols).toBeGreaterThan(200);

  const drift: string[] = [];
  for (const [table, cols] of decl) {
    const have = await actual(trail, table);
    if (have.size === 0) {
      drift.push(`TABLE MISSING: ${table}`);
      continue;
    }
    for (const c of cols) if (!have.has(c)) drift.push(`${table}.${c}`);
  }
  // Print both sides on failure: "which column" is the whole diagnostic.
  expect(drift).toEqual([]);
});

test('NEGATIVE CONTROL — the check can actually SEE a missing column', async () => {
  // Without this, "no drift" is indistinguishable from "the comparison never
  // compared anything". Ask for a column nobody has ever declared.
  const trail = await freshDb();
  const have = await actual(trail, 'knowledge_bases');
  expect(have.has('min_image_entropy')).toBe(true); // a real one, hand-written
  expect(have.has('a_column_nobody_declared')).toBe(false);
});
