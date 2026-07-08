/**
 * F202.1 — persistence for eval runs.
 *
 * Writes to the existing model-lab SQLite DB (apps/model-lab/data/model-lab.db)
 * in a NEW additive `eval_runs` table, so the model-lab UI (F202.2) can read
 * comparison history without disturbing the legacy `runs`/`turn_logs` tables.
 * Path is overridable so tests write to a throwaway file.
 */
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** apps/server/src/services/model-eval → apps/model-lab/data/model-lab.db */
export const DEFAULT_EVAL_DB = join(import.meta.dir, '../../../../model-lab/data/model-lab.db');

export interface EvalRunRow {
  id: string;
  ranAt: string;
  source: string;
  sourceChars: number;
  model: string;
  backend: string;
  euSafe: number; // 0 | 1
  recallFound: number | null;
  recallTotal: number | null;
  costUsd: number;
  durationMs: number;
  neurons: number;
  turns: number;
  failed: number; // 0 | 1
  error: string | null;
  missingIds: string | null; // JSON array of fact ids
}

export function openEvalStore(path: string = DEFAULT_EVAL_DB): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_runs (
      id            TEXT PRIMARY KEY,
      ran_at        TEXT NOT NULL,
      source        TEXT NOT NULL,
      source_chars  INTEGER NOT NULL DEFAULT 0,
      model         TEXT NOT NULL,
      backend       TEXT NOT NULL,
      eu_safe       INTEGER NOT NULL DEFAULT 0,
      recall_found  INTEGER,
      recall_total  INTEGER,
      cost_usd      REAL NOT NULL DEFAULT 0,
      duration_ms   INTEGER NOT NULL DEFAULT 0,
      neurons       INTEGER NOT NULL DEFAULT 0,
      turns         INTEGER NOT NULL DEFAULT 0,
      failed        INTEGER NOT NULL DEFAULT 0,
      error         TEXT,
      missing_ids   TEXT
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_eval_runs_source ON eval_runs(source)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_eval_runs_model ON eval_runs(model)');
  return db;
}

export function insertEvalRun(db: Database, r: EvalRunRow): void {
  db.query(
    `INSERT INTO eval_runs
       (id, ran_at, source, source_chars, model, backend, eu_safe, recall_found, recall_total,
        cost_usd, duration_ms, neurons, turns, failed, error, missing_ids)
     VALUES
       ($id, $ran_at, $source, $source_chars, $model, $backend, $eu_safe, $recall_found, $recall_total,
        $cost_usd, $duration_ms, $neurons, $turns, $failed, $error, $missing_ids)`,
  ).run({
    $id: r.id,
    $ran_at: r.ranAt,
    $source: r.source,
    $source_chars: r.sourceChars,
    $model: r.model,
    $backend: r.backend,
    $eu_safe: r.euSafe,
    $recall_found: r.recallFound,
    $recall_total: r.recallTotal,
    $cost_usd: r.costUsd,
    $duration_ms: r.durationMs,
    $neurons: r.neurons,
    $turns: r.turns,
    $failed: r.failed,
    $error: r.error,
    $missing_ids: r.missingIds,
  });
}

export function listEvalRuns(db: Database, source?: string): EvalRunRow[] {
  const rows = source
    ? db.query('SELECT * FROM eval_runs WHERE source = ?1 ORDER BY ran_at DESC').all(source)
    : db.query('SELECT * FROM eval_runs ORDER BY ran_at DESC').all();
  return (rows as Record<string, unknown>[]).map((x) => ({
    id: x.id as string,
    ranAt: x.ran_at as string,
    source: x.source as string,
    sourceChars: x.source_chars as number,
    model: x.model as string,
    backend: x.backend as string,
    euSafe: x.eu_safe as number,
    recallFound: (x.recall_found as number | null) ?? null,
    recallTotal: (x.recall_total as number | null) ?? null,
    costUsd: x.cost_usd as number,
    durationMs: x.duration_ms as number,
    neurons: x.neurons as number,
    turns: x.turns as number,
    failed: x.failed as number,
    error: (x.error as string | null) ?? null,
    missingIds: (x.missing_ids as string | null) ?? null,
  }));
}
