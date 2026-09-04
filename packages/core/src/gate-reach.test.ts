/**
 * F236.2 — every package that HAS tests must be reachable by the gate.
 *
 * The hole, in one sentence: **a package with no `test` script reports the same
 * thing as a package that passes — nothing.** Trail's gate is `turbo run test`,
 * which asks each package for its own script, so a package that never declares
 * one is silently skipped. cardmem's gate walks explicit directories instead
 * and cannot have this door at all; ours can, and did, twice:
 *
 *   apps/admin-server   1 test file, no script — the control plane (login,
 *                       sessions, tenants, invitations, API keys) ran nothing
 *   packages/core       1 test file, no script — 6 tests, 25 assertions,
 *                       written 2 Sept and never once executed by the gate
 *
 * Both were GREEN when finally run. That is the point: nothing was failing, so
 * nothing could reveal them. "Do your tests pass" would have been answered yes.
 *
 * This test asks the question that actually finds it: not whether tests pass,
 * and not whether tests exist, but whether the command the gate runs REACHES
 * them.
 */
import { expect, test } from 'bun:test';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../..');

function testFilesUnder(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) n += testFilesUnder(p);
    else if (/\.(test|spec)\.tsx?$/.test(entry)) n += 1;
  }
  return n;
}

function packages(): { name: string; dir: string }[] {
  const out: { name: string; dir: string }[] = [];
  for (const group of ['apps', 'packages']) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      if (existsSync(join(dir, 'package.json'))) out.push({ name: `${group}/${name}`, dir });
    }
  }
  return out;
}

test('PRECONDITION — the scan actually found the workspace', () => {
  // Without this the assertion below passes by examining nothing, which is the
  // exact shape it exists to catch. Same lesson as the drift guard next door.
  const pkgs = packages();
  expect(pkgs.length).toBeGreaterThan(10);
  const withTests = pkgs.filter((p) => testFilesUnder(join(p.dir, 'src')) > 0);
  expect(withTests.length).toBeGreaterThan(4);
});

test('every package holding test files declares a test script the gate can run', async () => {
  const unreachable: string[] = [];
  for (const p of packages()) {
    const count = testFilesUnder(join(p.dir, 'src'));
    if (count === 0) continue;
    const pkg = await Bun.file(join(p.dir, 'package.json')).json();
    if (!pkg.scripts?.test) unreachable.push(`${p.name} (${count} test file(s), no test script)`);
  }
  expect(unreachable).toEqual([]);
});

test('NEGATIVE CONTROL — a package WITHOUT tests is not required to declare one', () => {
  // The rule must not turn into "every package needs a test script", which
  // would push people to add empty scripts that pass by running nothing —
  // trading an invisible gap for a green one.
  const pkgs = packages();
  const noTests = pkgs.filter((p) => testFilesUnder(join(p.dir, 'src')) === 0);
  expect(noTests.length).toBeGreaterThan(0);
});
