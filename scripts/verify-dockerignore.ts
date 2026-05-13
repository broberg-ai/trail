#!/usr/bin/env bun
/**
 * F177 — verify-dockerignore
 *
 * Catches three classes of Dockerfile / .dockerignore drift before
 * deploy:
 *
 *   1. UNANCHORED globs in .dockerignore that match code-assets a
 *      Dockerfile COPYs in (e.g. `**\/data` excluding
 *      apps/server/src/data/glossary.json).
 *
 *   2. STALE COPY directives where the source path no longer exists
 *      on disk (e.g. `COPY scripts/old-init.sh /init.sh` after
 *      scripts/old-init.sh was renamed).
 *
 *   3. PRE-BUILD-EXPECTED-OUTPUT — Dockerfiles that COPY from `dist/`,
 *      `deploy/`, `out/`, `build/` (build-output paths) without the
 *      repo's package.json having a `ship:<app>` script that runs the
 *      build first. Catches the 2026-05-03 admin stale-dist incident
 *      where `flyctl deploy` was called directly without
 *      `pnpm ship:admin` running the build first.
 *
 * Run: `pnpm verify:dockerignore` or `bun run scripts/verify-dockerignore.ts`
 * CI: invoked from `.github/workflows/build-context-audit.yml`.
 *
 * Exit code: 0 if clean, 1 if any errors. Warnings are reported but
 * don't fail CI (configurable via TRAIL_VERIFY_STRICT=1).
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Glob } from 'bun';

const REPO_ROOT = process.cwd();
const STRICT = process.env.TRAIL_VERIFY_STRICT === '1';

interface CopyDirective {
  /** Source path relative to build context. */
  src: string;
  /** Destination path inside the image. */
  dst: string;
  /** Multi-stage `--from=<stage>` if specified. */
  fromStage: string | null;
  /** Line number in the Dockerfile (for error reporting). */
  line: number;
}

interface DockerfileInfo {
  /** Absolute path to the Dockerfile. */
  path: string;
  /** Build context root — for non-root Dockerfiles, the app's directory. */
  contextRoot: string;
  copies: CopyDirective[];
}

interface DockerignorePattern {
  raw: string;
  /** True if the pattern is anchored to the build-context root (starts with `/`). */
  anchored: boolean;
  /** True if this is a negation (starts with `!`) — overrides earlier matches. */
  negated: boolean;
  /** Sanitised glob for matching (no leading slash, no leading bang). */
  glob: string;
  line: number;
}

interface Issue {
  severity: 'error' | 'warn';
  dockerfile: string;
  copyDirective?: CopyDirective;
  message: string;
  fix?: string;
}

// ── Dockerfile parsing ────────────────────────────────────────

function findDockerfiles(): string[] {
  const candidates: string[] = [];
  // Root Dockerfile (if any).
  for (const name of ['Dockerfile']) {
    const p = join(REPO_ROOT, name);
    if (existsSync(p)) candidates.push(p);
  }
  // apps/*/Dockerfile[.*]
  const appsDir = join(REPO_ROOT, 'apps');
  if (existsSync(appsDir)) {
    for (const app of readdirSync(appsDir)) {
      const appPath = join(appsDir, app);
      if (!statSync(appPath).isDirectory()) continue;
      for (const entry of readdirSync(appPath)) {
        // Real Dockerfiles only — exclude sidecar files like
        // Dockerfile.dockerignore that some setups use.
        if (entry === 'Dockerfile') {
          candidates.push(join(appPath, entry));
        } else if (entry.startsWith('Dockerfile.') && !entry.endsWith('.dockerignore') && !entry.endsWith('.bak')) {
          candidates.push(join(appPath, entry));
        }
      }
    }
  }
  return candidates;
}

function parseDockerfile(path: string): DockerfileInfo {
  const text = readFileSync(path, 'utf-8');
  const lines = text.split('\n');
  const copies: CopyDirective[] = [];
  let stageActive = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('FROM ')) stageActive = true;
    if (!stageActive) continue;

    // `COPY [--from=stage] src... dst` — preserves quoted segments,
    // ignores trailing flags after `--chown=` etc.
    const m = line.match(/^(COPY|ADD)\s+(.+)$/i);
    if (!m) continue;
    const args = (m[2] ?? '').split(/\s+/);
    let fromStage: string | null = null;
    const positional: string[] = [];
    for (const arg of args) {
      if (arg.startsWith('--from=')) {
        fromStage = arg.slice('--from='.length);
      } else if (arg.startsWith('--')) {
        // skip --chown=, --chmod=, --link, etc.
      } else {
        positional.push(arg);
      }
    }
    if (positional.length < 2) continue;
    const dst = positional[positional.length - 1] ?? '';
    const srcs = positional.slice(0, -1);
    for (const src of srcs) {
      copies.push({ src, dst, fromStage, line: i + 1 });
    }
  }

  // Build-context detection: ship-scripts in this repo's root
  // package.json reveal that some apps build from REPO_ROOT
  // (server, admin — flyctl deploy --config apps/X/fly.toml .)
  // and some from the app dir (landing — cd apps/landing && flyctl
  // deploy .). The heuristic that captures both: pick whichever
  // root resolves the MOST COPY src paths on disk. Ties break in
  // favour of REPO_ROOT (the more common case for this repo's
  // Dockerfiles).
  const appDir = join(path, '..');
  const candidates = [REPO_ROOT, appDir].filter((p, i, arr) => arr.indexOf(p) === i);
  let bestRoot = REPO_ROOT;
  let bestHits = -1;
  for (const root of candidates) {
    const hits = copies.filter((c) =>
      !c.fromStage && existsSync(join(root, c.src)),
    ).length;
    if (hits > bestHits) {
      bestHits = hits;
      bestRoot = root;
    }
  }
  return { path, contextRoot: bestRoot, copies };
}

// ── Dockerignore parsing ─────────────────────────────────────

function parseDockerignore(path: string): DockerignorePattern[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf-8');
  const out: DockerignorePattern[] = [];
  text.split('\n').forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    let glob = line;
    let negated = false;
    if (glob.startsWith('!')) { negated = true; glob = glob.slice(1); }
    const anchored = glob.startsWith('/');
    if (anchored) glob = glob.slice(1);
    out.push({ raw: rawLine, anchored, negated, glob, line: idx + 1 });
  });
  return out;
}

// ── Conflict detection ──────────────────────────────────────

/**
 * Universally-ignored files. If a dockerignore pattern matches one
 * of these, it's expected behaviour, not a conflict.
 */
const UNIVERSALLY_IGNORED = [
  /\.DS_Store$/,
  /Thumbs\.db$/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /\.log$/,
];

function isUniversallyIgnored(path: string): boolean {
  return UNIVERSALLY_IGNORED.some((re) => re.test(path));
}

/**
 * For a given COPY src + a given dockerignore pattern, check whether
 * the pattern would exclude any file that the COPY would otherwise
 * include. Returns the first affected file path (relative to context
 * root) or null if no conflict.
 *
 * Strategy: list the actual filesystem entries the COPY src resolves
 * to, then test each against the pattern's glob. Bun's `Glob` handles
 * `*`, `**`, `[...]` matching. For unanchored patterns we match
 * against the relative path from context-root (any depth). For
 * anchored patterns we match against the path stripped of leading
 * dir-prefix.
 */
function findConflict(
  contextRoot: string,
  copySrc: string,
  pattern: DockerignorePattern,
): { affectedFile: string } | null {
  // Resolve COPY src to actual filesystem paths.
  const absSrc = join(contextRoot, copySrc);
  if (!existsSync(absSrc)) return null;
  const isDir = statSync(absSrc).isDirectory();
  const glob = new Glob(pattern.glob);

  const test = (relPath: string): boolean => {
    if (pattern.anchored) {
      return glob.match(relPath);
    }
    // Unanchored: pattern matches anywhere in the path. Test the
    // full relative path AND test each suffix-segment of the path
    // (so `data` matches both `data/x.json` and `src/data/x.json`).
    if (glob.match(relPath)) return true;
    const parts = relPath.split('/');
    for (let i = 1; i < parts.length; i++) {
      const sub = parts.slice(i).join('/');
      if (glob.match(sub)) return true;
    }
    return false;
  };

  if (!isDir) {
    const rel = relative(contextRoot, absSrc).split(sep).join('/');
    return test(rel) ? { affectedFile: rel } : null;
  }

  // Walk the directory and test each file.
  const walked: string[] = [];
  const stack: string[] = [absSrc];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = join(dir, entry);
      let stat;
      try { stat = statSync(child); } catch { continue; }
      if (stat.isDirectory()) {
        // Skip node_modules / .git for performance.
        if (entry === 'node_modules' || entry === '.git') continue;
        stack.push(child);
      } else {
        walked.push(child);
      }
    }
  }
  for (const file of walked) {
    const rel = relative(contextRoot, file).split(sep).join('/');
    if (isUniversallyIgnored(rel)) continue;
    if (test(rel)) return { affectedFile: rel };
  }
  return null;
}

// ── Build-output COPY detection ──────────────────────────────

const BUILD_OUTPUT_SRC_PATTERNS = ['dist', 'deploy', 'build', 'out', '.next'];

function checkPreBuiltCopy(
  dockerfile: DockerfileInfo,
  copy: CopyDirective,
): Issue | null {
  if (copy.fromStage) return null; // multi-stage builds handle their own output
  const first = copy.src.split('/')[0] ?? '';
  if (!BUILD_OUTPUT_SRC_PATTERNS.includes(first)) return null;
  // Check repo root package.json for a ship:<app> wrapper that runs
  // build before flyctl deploy. App name = basename of contextRoot.
  const appName = relative(REPO_ROOT, dockerfile.contextRoot).split(sep).pop() ?? '';
  const rootPkgPath = join(REPO_ROOT, 'package.json');
  if (!existsSync(rootPkgPath)) return null;
  const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
  const scripts = pkg.scripts ?? {};
  const shipKey = `ship:${appName}`;
  if (scripts[shipKey]) return null; // a ship wrapper exists — good
  return {
    severity: 'warn',
    dockerfile: dockerfile.path,
    copyDirective: copy,
    message: `COPY ${copy.src} expects pre-built output, but no \`${shipKey}\` script wraps the build before flyctl deploy.`,
    fix: `Add \`"${shipKey}": "pnpm --filter @trail/${appName} build && flyctl deploy --remote-only --config apps/${appName}/fly.toml ."\` to root package.json, and never invoke \`flyctl deploy\` directly for this app.`,
  };
}

// ── Main ────────────────────────────────────────────────────

function main(): void {
  const dockerfiles = findDockerfiles().map(parseDockerfile);
  if (dockerfiles.length === 0) {
    console.log('No Dockerfiles found.');
    process.exit(0);
  }

  const issues: Issue[] = [];

  for (const df of dockerfiles) {
    // Pick the dockerignore that applies to this build context:
    // app-local first, falling back to repo-root.
    const appLocal = join(df.contextRoot, '.dockerignore');
    const rootLocal = join(REPO_ROOT, '.dockerignore');
    const patterns = parseDockerignore(existsSync(appLocal) ? appLocal : rootLocal);

    for (const copy of df.copies) {
      // 2. Stale-ref check. COPY src can be a glob (e.g. `pnpm-lock.yaml*`
      // matching "pnpm-lock.yaml" OR ".yaml.json"); resolve via Bun.Glob
      // relative to context-root before declaring stale.
      if (!copy.src.startsWith('--') && !copy.fromStage) {
        const abs = join(df.contextRoot, copy.src);
        let resolves: boolean;
        if (copy.src.includes('*') || copy.src.includes('?')) {
          const glob = new Glob(copy.src);
          const scan = Array.from(glob.scanSync({ cwd: df.contextRoot }));
          resolves = scan.length > 0;
        } else {
          resolves = existsSync(abs);
        }
        if (!resolves) {
          issues.push({
            severity: 'error',
            dockerfile: df.path,
            copyDirective: copy,
            message: `COPY ${copy.src} → ${copy.dst}: source path does not exist on disk.`,
            fix: 'Remove the COPY line or update src to the new path.',
          });
          continue;
        }
      }

      // 1. Unanchored-glob conflict check
      for (const pat of patterns) {
        if (pat.negated) continue; // negations don't EXCLUDE
        const conflict = findConflict(df.contextRoot, copy.src, pat);
        if (conflict) {
          issues.push({
            severity: 'error',
            dockerfile: df.path,
            copyDirective: copy,
            message:
              `COPY ${copy.src}: file ${conflict.affectedFile} matches dockerignore pattern "${pat.raw}" (line ${pat.line}). ` +
              `That file will be EXCLUDED from the build context.`,
            fix: pat.anchored
              ? 'Audit the anchored pattern — it explicitly targets this path.'
              : `Anchor the pattern to its intended root (e.g. /${pat.glob}) so it only matches at the repo top level.`,
          });
        }
      }

      // 3. Pre-built-output check
      const buildIssue = checkPreBuiltCopy(df, copy);
      if (buildIssue) issues.push(buildIssue);
    }
  }

  // ── Report ────────────────────────────────────────────────

  const errors = issues.filter((i) => i.severity === 'error');
  const warns = issues.filter((i) => i.severity === 'warn');

  console.log(`\nVerifying build-context for ${dockerfiles.length} Dockerfile(s)…\n`);

  const byDf = new Map<string, Issue[]>();
  for (const issue of issues) {
    const arr = byDf.get(issue.dockerfile) ?? [];
    arr.push(issue);
    byDf.set(issue.dockerfile, arr);
  }
  for (const df of dockerfiles) {
    const dfIssues = byDf.get(df.path) ?? [];
    const rel = relative(REPO_ROOT, df.path);
    if (dfIssues.length === 0) {
      console.log(`  ✓ ${rel} — ${df.copies.length} COPY targets, 0 conflicts`);
      continue;
    }
    const symbol = dfIssues.some((i) => i.severity === 'error') ? '✗' : '⚠';
    console.log(`  ${symbol} ${rel} — ${df.copies.length} COPY targets, ${dfIssues.length} issue(s)`);
    for (const issue of dfIssues) {
      const tag = issue.severity === 'error' ? '✗' : '⚠';
      console.log(`      ${tag}  ${issue.message}`);
      if (issue.fix) console.log(`         fix: ${issue.fix}`);
    }
  }

  console.log(`\nSummary: ${errors.length} error(s), ${warns.length} warning(s).`);
  if (errors.length > 0 || (STRICT && warns.length > 0)) {
    process.exit(1);
  }
}

main();
