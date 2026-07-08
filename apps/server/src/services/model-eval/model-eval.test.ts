/**
 * F202.1 — CI-gateable unit tests for the eval lab's deterministic parts:
 * recall scoring, model-set resolution, and the store round-trip. The full
 * runIngestComparison() integration needs a live LLM (proven manually via
 * scripts/model-eval.ts), so it is NOT exercised here — these guard the logic
 * that must never silently break.
 */
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { scoreRecall, type Fact } from './recall.js';
import { resolveModels } from './models.js';
import { openEvalStore, insertEvalRun, listEvalRuns } from './store.js';

const LEDGER: Fact[] = [
  { id: 'F1', needle: 'wolverine' },
  { id: 'F2', needle: 'Gastrocnemicus' },
];

test('scoreRecall: both needles present → 2/2', () => {
  const r = scoreRecall('The wolverine roams. Gastrocnemicus is a calf muscle.', LEDGER);
  expect(r.found).toBe(2);
  expect(r.total).toBe(2);
  expect(r.missingIds).toEqual([]);
});

test('scoreRecall: one needle present → 1/2 with the missing id', () => {
  const r = scoreRecall('The wolverine roams the northern forest.', LEDGER);
  expect(r.found).toBe(1);
  expect(r.foundIds).toEqual(['F1']);
  expect(r.missingIds).toEqual(['F2']);
});

test('scoreRecall: no needles → 0/2', () => {
  const r = scoreRecall('A page about something else entirely.', LEDGER);
  expect(r.found).toBe(0);
  expect(r.missingIds).toEqual(['F1', 'F2']);
});

test('resolveModels("all") includes the prod default, excludes claude-cli, includes a lab extra', () => {
  const all = resolveModels('all');
  const ids = all.map((m) => m.id);
  expect(ids).toContain('mistral-small-latest'); // prod default
  expect(ids).toContain('deepseek/deepseek-v4-flash'); // lab extra
  expect(all.some((m) => m.backend === 'claude-cli')).toBe(false); // not runnable in-process
  // euSafe only for Mistral-direct backend
  expect(all.find((m) => m.id === 'mistral-small-latest')?.euSafe).toBe(true);
  expect(all.find((m) => m.id === 'deepseek/deepseek-v4-flash')?.euSafe).toBe(false);
});

test('resolveModels(subset) resolves a mix of prod + lab ids', () => {
  const picked = resolveModels(['mistral-small-latest', 'deepseek/deepseek-v4-flash']);
  expect(picked.map((m) => m.id)).toEqual(['mistral-small-latest', 'deepseek/deepseek-v4-flash']);
  expect(picked[0]!.backend).toBe('mistral');
  expect(picked[1]!.backend).toBe('openrouter');
});

test('resolveModels throws on an unknown id (no silent drop)', () => {
  expect(() => resolveModels(['not-a-real-model'])).toThrow(/Unknown model id/);
});

test('store round-trip: insert an eval run → read it back', () => {
  const dbFile = resolve(import.meta.dir, `../../../.tmp-eval-store-${process.pid}.db`);
  const db = openEvalStore(dbFile);
  try {
    insertEvalRun(db, {
      id: 'run-1',
      ranAt: '2026-07-08T00:00:00.000Z',
      source: 'tiny.md',
      sourceChars: 42,
      model: 'mistral-small-latest',
      backend: 'mistral',
      euSafe: 1,
      recallFound: 1,
      recallTotal: 2,
      costUsd: 0.0133,
      durationMs: 1200,
      neurons: 3,
      turns: 5,
      failed: 0,
      error: null,
      missingIds: JSON.stringify(['F2']),
    });
    const rows = listEvalRuns(db, 'tiny.md');
    expect(rows.length).toBe(1);
    expect(rows[0]!.model).toBe('mistral-small-latest');
    expect(rows[0]!.recallFound).toBe(1);
    expect(rows[0]!.recallTotal).toBe(2);
    expect(rows[0]!.euSafe).toBe(1);
    expect(rows[0]!.missingIds).toBe(JSON.stringify(['F2']));
  } finally {
    db.close();
    rmSync(dbFile, { force: true });
    rmSync(`${dbFile}-wal`, { force: true });
    rmSync(`${dbFile}-shm`, { force: true });
  }
});
