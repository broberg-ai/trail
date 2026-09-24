// F200.3 — CI gate for the maintenance-lint toggle. Runs the end-to-end probe
// (temp DB, real scheduled pass, real lint-settings route) in its own process:
// it owns a fresh database and exits non-zero on any failed check.
import { test, expect } from 'bun:test';
import { join } from 'node:path';

test('F200.3 — scheduled pass honours maintenance_lint_enabled; settings PATCH is per-field', () => {
  const r = Bun.spawnSync(['bun', 'run', join(import.meta.dir, '../../scripts/verify-f200-3-maintenance-toggle.ts')], {
    cwd: join(import.meta.dir, '../..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = r.stdout.toString();
  if (r.exitCode !== 0) console.log(out, r.stderr.toString());
  expect(out).toContain('score: 7/7');
  expect(r.exitCode).toBe(0);
}, 60_000);
