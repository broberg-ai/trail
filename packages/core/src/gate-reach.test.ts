/**
 * F236.2 — every tracked test file must be REACHED by the gate.
 *
 * THE PROPERTY WAS SHARPENED ONCE, BY cardmem, AND IT MATTERED. The first
 * version asked whether a package DECLARES a test script. That is not the thing
 * we want: `"test": "bun test src/"` with a test file in `tests/` declares a
 * script, passes that check, and never runs. Two different properties, and only
 * the second is load-bearing.
 *
 * Measured the moment the sharper one was asked: 28 tracked test files, 26 run.
 * The two unreached were apps/widget's — a package EXCLUDED from the pnpm
 * workspace, whose tests live in `tests/` rather than `src/`. The old guard was
 * blind to both halves: it only counted under `src/`, and it did not know a
 * package can be outside the workspace entirely, where no script can save it.
 *
 * THREE STATES, NOT TWO. A script this file cannot interpret is reported as
 * `unverifiable`, never as covered. "We checked and it is fine" and "we could
 * not check" are different answers, and collapsing them is the failure this
 * repo met all week.
 */
import { expect, test } from 'bun:test';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../..');

async function git(args: string[]): Promise<string[]> {
  const proc = Bun.spawn(['git', ...args], { cwd: ROOT, stdout: 'pipe' });
  return (await new Response(proc.stdout).text())
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.includes('node_modules'));
}

/**
 * Directories pnpm actually includes, READ FROM THE CONFIG — never a hand-copy.
 * The previous version of this guard hardcoded ['apps','packages'] and was
 * therefore correct for a reason living in another file; that omission hid
 * `adapters/*` and scanned three excluded apps.
 *
 * Parsed with a regex rather than by adding a YAML dependency: the file is a
 * six-line list of quoted strings, and pulling in a parser to read it would
 * cost more than it protects. If the file ever grows real YAML structure this
 * must become a parser — the PRECONDITION below is what would notice.
 */
async function workspaceDirs(): Promise<{ include: string[]; exclude: string[] }> {
  const raw = await Bun.file(resolve(ROOT, 'pnpm-workspace.yaml')).text();
  const entries = [...raw.matchAll(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/gm)].map((m) => m[1].trim());
  return {
    include: entries.filter((e) => !e.startsWith('!')),
    exclude: entries.filter((e) => e.startsWith('!')).map((e) => e.slice(1)),
  };
}

function globMatches(pattern: string, dir: string): boolean {
  // Only the shapes pnpm-workspace.yaml actually uses here: "a/*" and "a/b".
  const re = new RegExp(`^${pattern.replace(/\*/g, '[^/]+')}$`);
  return re.test(dir);
}

export type Coverage =
  | { kind: 'covered'; by: string }
  | { kind: 'unreached'; why: string }
  | { kind: 'unverifiable'; why: string };

/**
 * Can the package's `test` script reach this file? Pure, so the rules can be
 * tested against fixtures rather than against whatever the repo looks like
 * today — a diagnosis that moves with the repo is a worse diagnosis.
 */
export function coverage(
  file: string,
  pkgDir: string,
  script: string | undefined,
  inWorkspace: boolean,
): Coverage {
  if (!inWorkspace) {
    return { kind: 'unreached', why: `${pkgDir} is excluded from the pnpm workspace` };
  }
  if (!script) return { kind: 'unreached', why: `${pkgDir} declares no test script` };

  const m = script.match(/^bun test\s*(.*)$/);
  if (!m) return { kind: 'unverifiable', why: `cannot interpret script: ${script}` };

  const paths = m[1].trim().split(/\s+/).filter(Boolean);
  // Bare `bun test` walks the whole package.
  if (paths.length === 0) return { kind: 'covered', by: `${pkgDir} (whole package)` };

  const rel = file.slice(pkgDir.length + 1);
  for (const p of paths) {
    const norm = p.replace(/\/$/, '');
    if (rel === norm || rel.startsWith(`${norm}/`)) return { kind: 'covered', by: `${pkgDir}: ${p}` };
  }
  return { kind: 'unreached', why: `${rel} is outside ${pkgDir}'s test paths (${paths.join(', ')})` };
}

// ── the rules, against FIXED fixtures ────────────────────────────────────────

test('a file under the script’s path is covered', () => {
  expect(coverage('apps/x/src/a.test.ts', 'apps/x', 'bun test src/', true).kind).toBe('covered');
});

test('THE MEASURED CASE — a file OUTSIDE the script’s path is unreached', () => {
  // "test": "bun test src/" with the file in tests/. Declares a script, passes
  // the old guard, never runs.
  const c = coverage('apps/x/tests/a.spec.ts', 'apps/x', 'bun test src/', true);
  expect(c.kind).toBe('unreached');
  expect((c as { why: string }).why).toContain('outside');
});

test('a package outside the workspace is unreached whatever its script says', () => {
  const c = coverage('apps/w/tests/a.spec.ts', 'apps/w', 'bun test tests/', false);
  expect(c.kind).toBe('unreached');
  expect((c as { why: string }).why).toContain('excluded');
});

test('bare `bun test` covers the whole package', () => {
  expect(coverage('packages/y/src/a.test.ts', 'packages/y', 'bun test', true).kind).toBe('covered');
});

test('THREE STATES — a script we cannot read is UNVERIFIABLE, never covered', () => {
  // "we checked and it is fine" and "we could not check" must not look alike.
  const c = coverage('apps/z/src/a.test.ts', 'apps/z', 'bash scripts/test.sh', true);
  expect(c.kind).toBe('unverifiable');
});

// ── the live repo ────────────────────────────────────────────────────────────

test('every tracked test file is reached by the gate', async () => {
  const files = await git(['ls-files', '--', '*.test.ts', '*.test.tsx', '*.spec.ts', '*.spec.tsx']);
  const pkgFiles = await git(['ls-files', '--', '*/package.json', '*/*/package.json']);
  const { include, exclude } = await workspaceDirs();

  // PRECONDITION — the enumeration found something. An empty list would pass
  // by examining nothing, which is the shape this file exists to catch.
  expect(files.length).toBeGreaterThan(20);
  expect(pkgFiles.length).toBeGreaterThan(10);
  // And the workspace config was actually READ — an empty include list would
  // mark every package as outside the workspace and turn this into noise, or
  // (worse) a parser change could silently return nothing.
  expect(include.length).toBeGreaterThan(1);
  expect(exclude.length).toBeGreaterThan(0);

  const pkgs = new Map<string, string | undefined>();
  for (const rel of pkgFiles) {
    const dir = dirname(rel);
    const json = await Bun.file(resolve(ROOT, rel)).json();
    pkgs.set(dir, json.scripts?.test);
  }
  const inWorkspace = (dir: string) =>
    include.some((p) => globMatches(p, dir)) && !exclude.some((p) => globMatches(p, dir));

  const unreached: string[] = [];
  const unverifiable: string[] = [];
  for (const f of files) {
    const dir = [...pkgs.keys()]
      .filter((d) => f.startsWith(`${d}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (!dir) { unreached.push(`${f} — belongs to no package`); continue; }
    const c = coverage(f, dir, pkgs.get(dir), inWorkspace(dir));
    if (c.kind === 'unreached') unreached.push(`${f} — ${c.why}`);
    if (c.kind === 'unverifiable') unverifiable.push(`${f} — ${c.why}`);
  }
  // Reported separately on purpose: an unverifiable file is not a pass.
  expect(unverifiable).toEqual([]);

  // PINNED, NOT MUTED. Two tracked test files genuinely do not run, and the
  // honest thing is neither to fail the whole gate forever nor to quietly
  // exclude them — it is to state exactly which two, so the set cannot grow
  // without going red and cannot shrink without telling us to delete this pin.
  //
  // apps/widget's specs import raw @playwright/test, which this repo forbids
  // (F112: browser automation goes through Cardmem Lens). They were written
  // 20-30 May; the rule landed 15 June — so they did not break a rule, the
  // rule arrived and nobody swept them up. Nothing runs them: the package is
  // excluded from the pnpm workspace and no CI job calls them. They are dead
  // weight that LOOKS like coverage, which is worse than no coverage.
  //
  // Tracked as F237. Removing them, or converting them to Lens manuscripts,
  // makes this assertion fail — which is the point.
  const KNOWN_UNREACHED = [
    'apps/widget/tests/admin-image-carousel.spec.ts — apps/widget is excluded from the pnpm workspace',
    'apps/widget/tests/multi-tenant.spec.ts — apps/widget is excluded from the pnpm workspace',
  ];
  expect(unreached.sort()).toEqual(KNOWN_UNREACHED.sort());
});
