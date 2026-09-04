/**
 * F236.2 — every package that HAS tests must be reachable by the gate.
 *
 * The hole, in one sentence: **a package with no `test` script reports the same
 * thing as a package that passes — nothing.** Trail's gate is `turbo run test`,
 * which asks each package for its own script, so a package that never declares
 * one is silently skipped. Measured, and there were two:
 *
 *   apps/admin-server   1 test file, no script — the control plane (login,
 *                       sessions, tenants, invitations, API keys) ran nothing
 *   packages/core       1 test file, no script — 6 tests, 25 assertions,
 *                       written 2 Sept and never once executed by the gate
 *
 * Both were GREEN when finally run. That is the point: nothing was failing, so
 * nothing could reveal them. "Do your tests pass" would have been answered yes.
 *
 * TWO CORRECTIONS FROM cardmem, both of which this file originally got wrong:
 *
 * 1. THE RULE IS STRUCTURALLY INCAPABLE OF GROWING. `unreachable()` takes a
 *    list of packages that HAVE tests and returns a subset of it. There is no
 *    code path where "this package has no test script" can become a finding for
 *    a package with no tests — so the rule cannot drift into "everyone needs a
 *    test script", which would push people to add empty scripts that pass by
 *    running nothing. That was a promise in prose here before; a shape beats a
 *    promise.
 *
 * 2. THE PACKAGE LIST IS A PROPERTY, NOT A COPY OF THE CONFIG. It used to
 *    hardcode ['apps', 'packages'] — a hand-copy of pnpm-workspace.yaml's
 *    globs, i.e. correct for a reason living in another file. Measured: that
 *    file also lists `adapters/*`, which the copy omitted, and excludes three
 *    apps that the copy scanned. Nothing was wrong today, and that is exactly
 *    how this class survives. Now: every tracked package.json that is not the
 *    root. cardmem found the identical defect inside their own version of this
 *    guard.
 *
 * The pure function is tested against a FIXED fixture so a mutation reddens ONE
 * test with a precise diagnosis, rather than three because the live repo moved
 * under it.
 */
import { expect, test } from 'bun:test';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../..');

export interface PackageFacts {
  name: string;
  testFiles: number;
  hasTestScript: boolean;
}

/**
 * The rule. Input is already restricted to packages, and the filter runs on
 * `testFiles > 0` FIRST — so a package with no tests can never appear in the
 * output, whatever anyone later adds below.
 */
export function unreachable(pkgs: PackageFacts[]): string[] {
  return pkgs
    .filter((p) => p.testFiles > 0)
    .filter((p) => !p.hasTestScript)
    .map((p) => `${p.name} (${p.testFiles} test file(s), no test script)`);
}

function countTests(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) n += countTests(p);
    else if (/\.(test|spec)\.tsx?$/.test(entry)) n += 1;
  }
  return n;
}

/** Every tracked package.json that is not the root — the property, not the globs. */
async function livePackages(): Promise<PackageFacts[]> {
  const proc = Bun.spawn(['git', 'ls-files', '--', '*/package.json', '*/*/package.json'], {
    cwd: ROOT,
    stdout: 'pipe',
  });
  const listed = (await new Response(proc.stdout).text())
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.includes('node_modules'));

  const out: PackageFacts[] = [];
  for (const rel of listed) {
    const dir = dirname(rel);
    const pkg = await Bun.file(join(ROOT, rel)).json();
    out.push({
      name: dir,
      testFiles: countTests(join(ROOT, dir, 'src')),
      hasTestScript: Boolean(pkg.scripts?.test),
    });
  }
  return out;
}

// ── the rule, against a FIXED fixture ────────────────────────────────────────

const FIXTURE: PackageFacts[] = [
  { name: 'apps/with-tests-and-script', testFiles: 3, hasTestScript: true },
  { name: 'apps/with-tests-no-script', testFiles: 1, hasTestScript: false },
  { name: 'packages/no-tests-no-script', testFiles: 0, hasTestScript: false },
  { name: 'packages/no-tests-but-script', testFiles: 0, hasTestScript: true },
];

test('the rule names the package that has tests the gate cannot reach', () => {
  expect(unreachable(FIXTURE)).toEqual([
    'apps/with-tests-no-script (1 test file(s), no test script)',
  ]);
});

test('STRUCTURAL — a package with NO tests can never be a finding', () => {
  // Not a promise that we won't add it: `filter(testFiles > 0)` runs first, so
  // there is no path where it could. Proven on a fixture where two such
  // packages exist and one of them also lacks a script.
  const noTestPkgs = FIXTURE.filter((p) => p.testFiles === 0);
  expect(noTestPkgs.length).toBe(2);
  for (const p of noTestPkgs) {
    expect(unreachable([p])).toEqual([]);
  }
});

// ── the live repo ────────────────────────────────────────────────────────────

test('PRECONDITION — the enumeration actually found the workspace', async () => {
  // Without this the assertion below passes by examining nothing, which is the
  // exact shape it exists to catch.
  const pkgs = await livePackages();
  expect(pkgs.length).toBeGreaterThan(10);
  expect(pkgs.filter((p) => p.testFiles > 0).length).toBeGreaterThan(4);
});

test('every package holding test files declares a test script the gate can run', async () => {
  expect(unreachable(await livePackages())).toEqual([]);
});
