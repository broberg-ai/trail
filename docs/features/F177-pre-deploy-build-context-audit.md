# F177 — Pre-deploy build-context audit (`pnpm verify:dockerignore`)

> Statisk validator der parser hver Dockerfile + `.dockerignore` (root + per-app) og fanger TRE bug-classes: (1) unanchored dockerignore-globs der ekskluderer kode-assets, (2) stale COPY-refs hvor source-path er slettet, (3) Dockerfile COPY-fra-build-output uden tilsvarende build-step eller `ship:<app>` wrapper. Kører som `pnpm verify:dockerignore` lokalt + GitHub Actions pre-merge gate. Inspireret af 2026-05-02 v9-incident (dockerignore-`**/data`) + 2026-05-03 admin stale-dist-incident (F97/F101/F22/F176 admin-UI aldrig live på `app.trailmem.com`). F177 ville have fanget begge automatisk pre-merge. Tier: infrastructure / dev-experience. Effort: Small ¾-1¼ dag. Status: Planned.

## Problem

Trail's deploy-pipeline har en hel klasse af build-bugs der manifesterer som:
1. `pnpm typecheck` ✅ — koden compiler.
2. Local dev kører fint — alle filer er på disken, intet ekskluderes.
3. `flyctl deploy` succeeds — Docker bygger image uden errors.
4. Engine boot crash-looper — fil mangler i container ved runtime.

Det er **dyrt** fordi man først opdager det ved Step 4, efter image er pushet og deployet. Diagnosis kræver `flyctl ssh console` + `ls` for at se hvad der faktisk er i imaget, mens man sammenligner med hvad Dockerfile copy'er.

### Den motiverende incident (2026-05-02 v9-deploy)

Engineering-session forsøgte at deploye trail-engine fra v8 → v9 og engine crash-loopede. Root cause:

- **`Dockerfile`** har `COPY apps/server ./apps/server` (typisk pattern).
- **`.dockerignore`** havde `**/data` — INTENDED til at ekskludere root `/data/` runtime-volume-mappen fra build-context.
- **Glob-matchen var unanchored**: `**/data` matchede ALLE `data`-mapper rekursivt, inklusiv `apps/server/src/data/`.
- `apps/server/src/data/glossary.json` er F94 seed-data (20 EN/DA-termer) der ships med koden og loades ved boot.
- Image bygges → glossary.json er ekskluderet → engine boots → ENOENT på require af glossary.json → crash-loop.

Fix `44c23eb` ankrede patternet til `/data` (root-only). Arbejder nu, men en helt klasse af lignende bugs lurer enhver gang:
- nogen tilføjer en ny `.dockerignore` entry uden at tjekke unanchored-effekt
- nogen tilføjer en ny `apps/*/src/data/`-asset uden at vide patternet eksisterer
- nogen refactorer en sti og glemmer `.dockerignore`-konsekvensen

### Den anden motiverende incident (2026-05-03 admin stale-dist)

Engineering-session opdagede at F97 /activity panel + F101 type-pill + F22 anchor-renderer + F176 Settings cadence-UI **aldrig havde været live på `app.trailmem.com`** efter dagens engine-side-deploys. Christian gik manuelt til `app.trailmem.com/activity` og fandt en tom side. Root cause:

- **`apps/admin-server/Dockerfile`** linje 51-55 forventer `apps/admin/dist/` er pre-built før `flyctl deploy`.
- Engineering kørte `flyctl deploy -a trail-admin --config apps/admin-server/fly.toml --remote-only` direkte (uden at køre admin-build først).
- Build-output var stale fra et tidligere deploy.
- Image bygges → stale `dist/` copies ind → admin SPA viser pre-F97-features.
- Server-side endpoints var fine (engine-Dockerfile copier source direkte uden pre-build), så API'en virkede — men SPA'en der konsumerede den havde ingen UI til at vise det.

Fix: kør `pnpm ship:admin` (defineret i root `package.json`) i stedet for direkte `flyctl deploy`. `ship:admin` bundler `pnpm --filter @trail/admin build && flyctl deploy ...` — det er allerede det korrekte deploy-flow, det blev bare ignoreret.

`ship:engine`, `ship:admin`, `ship:landing` ALLE eksisterer i root `package.json` (Christian's pattern fra F33). De er den blessede deploy-vej. Problemet er ikke at konventionen mangler — det er at intet fanger når nogen omgår den ved at kalde `flyctl deploy` direkte.

**Same class af bugs**: deterministisk, statisk-detekterbart, fanges først ved manuel inspektion på live. F177 udvides nu med en check-regel der specifikt fanger "Dockerfile COPY refererer build-output, men deploy-flow har ingen build-step".

### Hvorfor det ikke fanges af eksisterende værktøjer

- **TypeScript**: ser ikke build-context — checker kun source-graph, ikke runtime-resolution.
- **Linter**: ingen lint-rule for "Dockerfile COPY-target vs dockerignore-glob mismatch" findes som standard.
- **Bun runtime**: fejler fint ved boot, men det er for sent — image er allerede pushed.
- **Drizzle migration-validator**: dækker DB-skema-drift, ikke filsystem-build-context.
- **CI build**: succeeds fordi Docker accepterer det — bug'en er semantisk, ikke syntaktisk.

Det her er præcis den slags bug F177 fanger: deterministisk, statisk-detekterbart, men uden dedikeret tooling indtil nu.

## Secondary Pain Points

- **Stale COPY refs**: en Dockerfile siger `COPY scripts/old-bootstrap.sh ./bootstrap.sh` men `scripts/old-bootstrap.sh` blev slettet for to refactorings siden. Build accepterer det (Docker BuildKit ignorerer missing source som fil-ikke-findes-fejl i nogle modes), men resulterer i tom binary eller error i runtime. F177 detection: tjek om hver COPY source-path eksisterer på disken pre-build.
- **Per-app `.dockerignore`-divergens**: hver app kan have egen `.dockerignore`. Nye apps kopierer ofte fra eksisterende — hvis kilde-appen havde en bug, smitter den. F177 normaliserer ved at runne samme check for hver app uafhængigt.
- **Multi-stage builds skjuler problemer**: `FROM ... AS deps` + `COPY --from=deps ...` kan gøre `.dockerignore`-effekter mindre synlige fordi build-context-state varierer per stage. F177 simulerer per-stage.
- **CI-tid på catch-up**: i dag opdages bug'en kun i deploy-fasen. F177 flytter detection til CI pre-merge, hvor fix-cost er minutters arbejde i stedet for "engine er nede, kunden klager".

### Architectural follow-up (out of scope, separat overvejelse)

Naming-kollision mellem **`/data`** (runtime volume mount-point) og **`apps/server/src/data/`** (source-code seed-assets) er den dybere årsag. F177 fanger glob-bugs, men eliminerer ikke risikoen for at lignende collisions opstår fremover. En ren rename `src/data/` → `src/seed/` eller `src/assets/` ville fjerne entire klassen af bugs ved navne-disambiguation. Forslag: separat 0.5-dag oprydning efter F177 lander.

## Solution

Ny CLI-tool `scripts/verify-dockerignore.ts` (Bun) der:

1. **Discovers Dockerfiles**: scanner `apps/*/Dockerfile`, `Dockerfile` (root), `apps/*/Dockerfile.*` (multi-variants).
2. **Parser hver Dockerfile**: ekstraherer `COPY` og `ADD` source-paths (både build-context og multi-stage `--from=`).
3. **Discovers dockerignores**: `.dockerignore` (root) + `apps/*/.dockerignore` (per-app overrides).
4. **Parser dockerignores**: håndterer anchored (`/data`) vs unanchored (`data`, `**/data`) globs, negation (`!keep-this`), glob-stjerner (`*.log`).
5. **Cross-checks**:
   - For hver `COPY src dst`: verificér at `src` ikke matcher nogen ekskluderings-pattern.
   - For hver `COPY src dst`: verificér at `src` faktisk findes på disken (stale-ref-check).
6. **Reporter problemer**: tabel-output med severity (error / warn / info), eksempel på berørt fil, foreslået fix.
7. **Exit-code**: 1 hvis errors, 0 hvis clean.

### CLI-spec

```bash
$ pnpm verify:dockerignore

Verifying build-context for 4 Dockerfile(s)…

✓ apps/landing/Dockerfile         (3 COPY targets, 0 conflicts)
✓ apps/admin-server/Dockerfile    (5 COPY targets, 0 conflicts)
✗ apps/server/Dockerfile          (7 COPY targets, 1 conflict)

  ⚠️  COPY apps/server/src ./apps/server/src
       affected file: apps/server/src/data/glossary.json (12.4 KB)
       matches dockerignore pattern: **/data (line 14 of .dockerignore)
       result: file will be EXCLUDED from build context
       fix:  anchor pattern to /data (matches only root /data dir)
       OR:   rename apps/server/src/data/ to apps/server/src/seed/

✗ Dockerfile (root)               (2 COPY targets, 1 stale ref)

  ⚠️  COPY scripts/legacy-init.sh /init.sh
       source path does not exist on disk: scripts/legacy-init.sh
       fix:  remove or update COPY directive

Summary: 2 conflicts found across 4 Dockerfiles.

Run `pnpm verify:dockerignore --explain` for fix-rationale per pattern.
```

### CI-hook

```yaml
# .github/workflows/build-context-audit.yml
name: Build-context audit
on:
  pull_request:
    paths:
      - 'apps/**/Dockerfile*'
      - '.dockerignore'
      - 'apps/**/.dockerignore'
      - 'apps/*/src/**'

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --filter '@trail/server'
      - run: bun run scripts/verify-dockerignore.ts
```

Lokalt kan curator også køre `pnpm verify:dockerignore` ad hoc (f.eks. som del af `pnpm prepush` git-hook).

## Non-Goals

- **Ikke runtime-image-inspection**. F177 verificerer source-state pre-build, ikke binary efter `docker build`. Hvis nogen runtime-strenger forventer en fil der mangler kun fordi af logic-fejl (f.eks. dynamic `require` med bad path), fanges det ikke her.
- **Ikke automatisk fix.** F177 advarer + foreslår; ændrer aldrig `.dockerignore` eller Dockerfile selv. Fixet kræver stadig curator-tænkning (skal patterns ankres? skal filer renames? er der en tredje vej?).
- **Ikke security-scanning.** F177 tjekker IKKE om `.env`-filer, secrets eller credentials utilsigtet bliver copied. Det er separat F-feature (tag fx `F178 — Secret-leakage detection in build context`).
- **Ikke multi-platform validation.** F177 tjekker logical glob-match, ikke arch-specifikke binary issues.
- **Ikke `RUN`-direktiver.** Vi tjekker COPY/ADD source-paths, ikke ad hoc `RUN curl ...` der downloader filer ved build-time.
- **Ikke Drizzle migrations-validation.** Det er separat orthogonal check.

## Technical Design

### 1. CLI scaffold

```typescript
// scripts/verify-dockerignore.ts
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { Glob } from 'bun';

interface DockerCopyDirective {
  dockerfile: string;
  line: number;
  source: string;
  destination: string;
  fromStage?: string;
}

interface DockerignorePattern {
  file: string;
  line: number;
  raw: string;
  anchored: boolean;
  negation: boolean;
  matcher: (path: string) => boolean;
}

interface Conflict {
  severity: 'error' | 'warn';
  copy: DockerCopyDirective;
  pattern: DockerignorePattern;
  affectedFile: string;
  fixSuggestion: string;
}

interface StaleRef {
  copy: DockerCopyDirective;
  reason: 'path-not-found' | 'path-empty';
}
```

### 2. Dockerfile-parser

Use simple line-by-line parser; only need `COPY` and `ADD`:

```typescript
function parseDockerfile(path: string): DockerCopyDirective[] {
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  const result: DockerCopyDirective[] = [];
  let currentStage: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('FROM ')) {
      const match = line.match(/AS\s+(\w+)/i);
      currentStage = match?.[1];
      continue;
    }
    const copyMatch = line.match(/^(COPY|ADD)\s+(?:--from=(\S+)\s+)?(.+?)\s+(\S+)$/);
    if (copyMatch) {
      const [, , fromStage, source, destination] = copyMatch;
      result.push({ dockerfile: path, line: i + 1, source, destination, fromStage });
    }
  }
  return result;
}
```

### 3. Dockerignore-parser

Use battle-tested `ignore` npm package (handles dockerignore-syntax which mirrors gitignore):

```typescript
import ignore from 'ignore';

function parseDockerignore(path: string): {
  patterns: DockerignorePattern[];
  isExcluded: (file: string) => boolean;
} {
  const ig = ignore();
  const content = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  const lines = content.split('\n').filter(l => l && !l.startsWith('#'));
  ig.add(lines);

  const patterns: DockerignorePattern[] = lines.map((raw, i) => ({
    file: path,
    line: i + 1,
    raw,
    anchored: raw.startsWith('/'),
    negation: raw.startsWith('!'),
    matcher: (p: string) => ig.test(p).ignored,
  }));

  return {
    patterns,
    isExcluded: (file: string) => ig.test(file).ignored,
  };
}
```

### 4. Cross-check

```typescript
async function checkDockerfile(dockerfilePath: string): Promise<{ conflicts: Conflict[]; staleRefs: StaleRef[] }> {
  const dir = dirname(dockerfilePath);
  const directives = parseDockerfile(dockerfilePath);
  const rootIgnore = parseDockerignore(join(process.cwd(), '.dockerignore'));
  const localIgnore = parseDockerignore(join(dir, '.dockerignore'));

  const conflicts: Conflict[] = [];
  const staleRefs: StaleRef[] = [];

  for (const directive of directives) {
    if (directive.fromStage) continue; // multi-stage refs are not from build-context

    const fullPath = join(process.cwd(), directive.source);

    // Stale-ref check
    if (!existsSync(fullPath)) {
      staleRefs.push({ copy: directive, reason: 'path-not-found' });
      continue;
    }

    // Recursively walk source dir, check each file against ignore-patterns
    const files = await walkDir(fullPath);
    for (const file of files) {
      const relativePath = relative(process.cwd(), file);

      for (const ig of [rootIgnore, localIgnore]) {
        for (const pattern of ig.patterns) {
          if (pattern.negation) continue;
          if (pattern.matcher(relativePath)) {
            // File would be excluded — is that intended?
            // If file lives under a COPY-source AND is matched by a non-anchored pattern → likely bug
            if (!pattern.anchored && isCodeAsset(relativePath)) {
              conflicts.push({
                severity: 'error',
                copy: directive,
                pattern,
                affectedFile: relativePath,
                fixSuggestion: suggestFix(pattern, relativePath),
              });
            }
          }
        }
      }
    }
  }

  return { conflicts, staleRefs };
}

function isCodeAsset(file: string): boolean {
  // Heuristic: under apps/*/src/, packages/*/src/, scripts/, or has known
  // code-asset extensions (.json, .yaml, .ts, .js, .md, .txt, .png, .svg)
  const codeExts = ['.json', '.yaml', '.yml', '.ts', '.tsx', '.js', '.jsx', '.md', '.txt', '.png', '.svg', '.sql'];
  return /^(apps|packages|scripts)\/.*\/(src|seed|assets|migrations|data)\//.test(file)
      || codeExts.some(ext => file.endsWith(ext));
}

function suggestFix(pattern: DockerignorePattern, affectedFile: string): string {
  if (!pattern.anchored && pattern.raw.includes('data')) {
    return `anchor pattern to /data (matches only root /data dir)\nOR rename ${dirname(affectedFile)}/ to avoid 'data' name collision`;
  }
  if (!pattern.anchored) {
    return `anchor pattern by prefixing with / (e.g. /${pattern.raw}) OR scope-narrow pattern to specific directory`;
  }
  return `review pattern intent — does it really need to exclude ${affectedFile}?`;
}
```

### 4b. Stale pre-built artifact detection (added 2026-05-03)

Detection-rule that fires for the second motivating incident — Dockerfile COPYs from a build-output path, but no in-Dockerfile build step or matching `ship:<app>` wrapper script exists:

```typescript
const BUILD_OUTPUT_DIR_NAMES = new Set([
  // Conventional bundler/SSG output dirs
  'dist', 'build', '.next', 'out', 'public/build', '.svelte-kit',
  // Trail-specific landing-site convention via BUILD_OUT_DIR=deploy
  // (apps/landing/build.ts → apps/landing/deploy/, copied by
  // apps/landing/Dockerfile L9). Added 2026-05-03 after manual-audit
  // caught that the hardcoded list missed this case — landing's
  // ship:landing wrapper is correct, but F177's static check would
  // have given false-clear on it without 'deploy' in this set.
  'deploy',
]);

interface PreBuiltArtifactWarning {
  dockerfile: string;
  copyDirective: DockerCopyDirective;
  buildOutputPath: string;          // e.g. "apps/admin/dist"
  packageJsonPath: string | null;   // e.g. "apps/admin/package.json"
  hasBuildScript: boolean;
  hasInDockerfileBuild: boolean;
  shipScript: string | null;        // e.g. "ship:admin" if found in root package.json
  severity: 'error' | 'warn';
}

async function checkPreBuiltArtifacts(
  dockerfilePath: string,
  directives: DockerCopyDirective[],
  rootPackageJson: PackageJson,
): Promise<PreBuiltArtifactWarning[]> {
  const warnings: PreBuiltArtifactWarning[] = [];
  const dockerfileContent = readFileSync(dockerfilePath, 'utf-8');
  const hasInDockerfileBuild = /^(RUN\s+(pnpm|npm|yarn)\s+(run\s+)?build|RUN\s+pnpm\s+--filter\s+\S+\s+build)/m.test(dockerfileContent);

  for (const directive of directives) {
    const segments = directive.source.split('/');
    const buildOutSegmentIdx = segments.findIndex(s => BUILD_OUTPUT_DIR_NAMES.has(s));
    if (buildOutSegmentIdx === -1) continue;

    // Walk up from segment-before-buildOutDir to find package.json
    const sourceRoot = segments.slice(0, buildOutSegmentIdx).join('/');
    const pkgPath = findNearestPackageJson(sourceRoot);
    const pkg = pkgPath ? JSON.parse(readFileSync(pkgPath, 'utf-8')) : null;
    const hasBuildScript = pkg?.scripts?.build !== undefined;

    // Look for matching ship:<app> wrapper in root package.json
    const appName = pkg?.name?.replace(/^@trail\//, '') ?? sourceRoot.split('/').pop() ?? '';
    const shipScriptName = `ship:${appName}`;
    const shipScript = rootPackageJson.scripts?.[shipScriptName] ?? null;
    const shipScriptBuildsBeforeDeploy = shipScript?.includes('build') && shipScript?.includes('flyctl deploy');

    if (!hasInDockerfileBuild && hasBuildScript && !shipScriptBuildsBeforeDeploy) {
      warnings.push({
        dockerfile: dockerfilePath,
        copyDirective: directive,
        buildOutputPath: segments.slice(0, buildOutSegmentIdx + 1).join('/'),
        packageJsonPath: pkgPath,
        hasBuildScript: true,
        hasInDockerfileBuild: false,
        shipScript: shipScript ? shipScriptName : null,
        severity: 'error',
      });
    }
  }
  return warnings;
}
```

**Rationale per check-component**:

- **`BUILD_OUTPUT_DIR_NAMES` heuristic**: catches the canonical bundler/SSG output directories. Not exhaustive — extending it for new tools (e.g. Astro's `dist/`, Remix's `public/build/`) is a one-line change. Trail-specific names like `deploy/` (landing-site SSG output) are explicitly listed; if a future app uses a non-conventional dir name set via `BUILD_OUT_DIR=<custom>` env-var in its `ship:<app>` script, a v2 enhancement could parse the script to detect that binding dynamically rather than relying on a hardcoded list. For now: hardcoded is enough — adding new dir-names is one line, and the failure-mode (false-clear instead of false-flag) is acceptable for a static-analysis pre-merge gate.
- **Walk-up to `package.json`**: a Dockerfile that COPYs `apps/admin/dist/` should map to `apps/admin/package.json`. We then check if THAT package has a `build` script (i.e. dist/ is genuinely a build artifact, not a vendored asset).
- **In-Dockerfile build check**: a Dockerfile that runs `RUN pnpm build` itself doesn't need an external wrapper — it's self-contained.
- **`ship:<app>` wrapper check**: looks at root `package.json` for an entry like `"ship:admin": "pnpm --filter @trail/admin build && flyctl deploy ..."`. If the wrapper bundles build+deploy, we infer the deploy-flow is correct as long as it's the path actually used.

**Output example**:

```
✗ apps/admin-server/Dockerfile  (1 stale-build-artifact warning)

  ⚠️  COPY apps/admin/dist /app/apps/admin/dist
       requires pre-built apps/admin/dist (no in-Dockerfile build step found)
       package: apps/admin/package.json (has 'build' script)
       wrapper: pnpm ship:admin (root package.json)
       fix: deploy via `pnpm ship:admin` — direct `flyctl deploy` ships stale dist/
```

**Limitation**: F177 cannot detect at static-analysis-time whether the operator actually USED `pnpm ship:admin` vs `flyctl deploy` directly — that's runtime data. What F177 CAN do is verify that the wrapper EXISTS, and surface it as the canonical deploy-vej. If a future engine refactor introduces `apps/server/dist/`-COPY without adding a corresponding `ship:engine` build-step or in-Dockerfile build, F177 catches that pre-merge.

### 5. Output formatting

Use ANSI colors when running in TTY, plain text in CI:

```typescript
function formatReport(results: Map<string, { conflicts: Conflict[]; staleRefs: StaleRef[] }>): string {
  const lines: string[] = ['Verifying build-context…\n'];
  let totalConflicts = 0;
  let totalStaleRefs = 0;

  for (const [dockerfile, { conflicts, staleRefs }] of results) {
    if (conflicts.length === 0 && staleRefs.length === 0) {
      lines.push(`✓ ${dockerfile}  (clean)`);
    } else {
      lines.push(`✗ ${dockerfile}  (${conflicts.length} conflict(s), ${staleRefs.length} stale ref(s))`);
      for (const c of conflicts) {
        lines.push(`  ⚠️  COPY ${c.copy.source} ${c.copy.destination}`);
        lines.push(`       affected file: ${c.affectedFile}`);
        lines.push(`       matches dockerignore pattern: ${c.pattern.raw} (line ${c.pattern.line} of ${c.pattern.file})`);
        lines.push(`       fix: ${c.fixSuggestion}`);
      }
      for (const s of staleRefs) {
        lines.push(`  ⚠️  COPY ${s.copy.source} — source path does not exist on disk`);
        lines.push(`       fix: remove or update COPY directive`);
      }
    }
    totalConflicts += conflicts.length;
    totalStaleRefs += staleRefs.length;
  }

  lines.push(`\nSummary: ${totalConflicts} conflict(s), ${totalStaleRefs} stale ref(s) found.`);
  return lines.join('\n');
}
```

### 6. Test fixtures

```
test/fixtures/
  unanchored-data-bug/        # reproducerer 2026-05-02 v9 incident
    Dockerfile
    .dockerignore             # contains '**/data'
    apps/server/src/data/glossary.json
    expected-output.txt       # asserts conflict detection

  anchored-data-clean/        # post-fix state
    Dockerfile
    .dockerignore             # contains '/data' anchored
    apps/server/src/data/glossary.json
    expected-output.txt       # asserts clean

  stale-copy-ref/
    Dockerfile                # COPY scripts/missing.sh ./
    expected-output.txt       # asserts stale-ref detection

  multi-stage-from/
    Dockerfile                # COPY --from=builder ...
    .dockerignore             # patterns that don't apply to --from
    expected-output.txt       # asserts skipping --from copies
```

### 7. Exit codes

- `0` = clean, no conflicts or stale refs
- `1` = errors found (build will likely break)
- `2` = warnings only (build may break, depending on glob semantics)

### 8. Package.json wiring

```json
{
  "scripts": {
    "verify:dockerignore": "bun run scripts/verify-dockerignore.ts",
    "verify": "pnpm verify:dockerignore && pnpm typecheck"
  }
}
```

### 9. GitHub Actions integration

`.github/workflows/build-context-audit.yml` (ny fil):

```yaml
name: Build-context audit
on:
  pull_request:
    paths:
      - '**/Dockerfile*'
      - '**/.dockerignore'
      - 'apps/*/src/**'
      - 'packages/*/src/**'
      - 'scripts/**'

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.13
      - run: bun install --frozen-lockfile
      - run: bun run scripts/verify-dockerignore.ts
```

## Interface

### CLI

```bash
pnpm verify:dockerignore                    # check all Dockerfiles
pnpm verify:dockerignore --explain          # include fix-rationale per pattern
pnpm verify:dockerignore apps/server/Dockerfile  # check specific file
pnpm verify:dockerignore --json             # machine-readable output for CI
```

### Programmatic API (for future tools that want to embed)

```typescript
import { verifyDockerignore } from './scripts/verify-dockerignore.ts';

const report = await verifyDockerignore({ rootDir: process.cwd() });
if (report.exitCode !== 0) {
  console.error(report.formatted);
  process.exit(1);
}
```

### CI integration

GitHub Actions workflow runs on PR; merge-blocked if exit-code !== 0.

## Rollout

**Phase 1 — CLI + fixtures (0.5 dag).** Skriv `scripts/verify-dockerignore.ts`, test-fixtures, package.json wiring. Lokal validering med 2026-05-02 v9-incident-fixturen.

**Phase 2 — CI integration (0.25 dag).** GitHub Actions workflow. Test mod en deliberately-broken PR for at se merge-block fungerer.

**Phase 3 — Documentation + buddy-link (0.25 dag).** README-sektion, link fra `docs/DEPLOYMENT-STAGES.md` til F177-rapporten, buddy `trail_save`-flow så flag-engine kan ramme den hvis den er aktiv.

**Total effort:** Small ½-1 dag.

**Backward compatibility:** Værktøjet er additivt — eksisterende Dockerfiles + .dockerignore'r er uændrede. Hvis F177 finder issues på eksisterende kode, fixes de i samme PR der introducerer F177 (eller i parallel quick-fix).

## Success Criteria

- `pnpm verify:dockerignore` exit-code 0 på current main efter 44c23eb-fix.
- Test-fixture for 2026-05-02 v9-incident reproduces conflict detection (assertion: output contains "matches dockerignore pattern: **/data" + "anchor pattern to /data").
- Stale-COPY-ref-fixture detekteres med "source path does not exist on disk".
- `--from=stage` COPY-direktiver springes korrekt over (de er ikke fra build-context).
- CI-job blokerer merge på en deliberately-broken PR (manual verify).
- Total CLI-runtime < 5 sekunder for hele Trail-monorepoet.
- F177 finder INGEN false positives på current main (tested manually før merge).

## Impact Analysis

### Files created

- `scripts/verify-dockerignore.ts` — CLI implementation (~300 linjer Bun-TypeScript)
- `test/verify-dockerignore.test.ts` — unit + integration tests
- `test/fixtures/dockerignore-cases/` — testfile-træer for hver case
- `.github/workflows/build-context-audit.yml` — CI workflow
- `docs/CONTRIBUTING.md` (sektion) — eller udvid eksisterende docs med "running build-context audit"

### Files modified

- `package.json` — tilføj `verify:dockerignore` + `verify` scripts
- `.dockerignore` (potentielt) — hvis F177 finder eksisterende issues på current main efter 44c23eb-fix
- `docs/FEATURES.md` + `docs/ROADMAP.md` — index-rækker (per CLAUDE.md hard rule, sker i samme commit)

### Blast radius

- Ingen runtime-effect — værktøjet er pure dev/CI tooling.
- CI-job kan blokere merge hvis det rapporterer conflict — det er ønsket adfærd, men gør PR-flow strammere.
- False positives har potentiale: hvis et `apps/*/src/data/`-asset er BEVIDST ekskluderet (f.eks. fordi det genereres ved runtime), kræver det en `# allow-build-exclude: <reason>`-kommentar-konvention. Plan-doc'en bygger ikke det her endnu — det skal være output-fokuseret advarsel, så curator kan tilføje en exception.

### Breaking changes

Ingen for runtime. Ny CI-merge-gate kan blokere PRs hvis der er issues; det er en opt-in disciplin der gradvist kan strammes.

### Test plan

- [ ] `pnpm typecheck` clean efter F177 lander
- [ ] Unit: `parseDockerfile` returnerer korrekte directives for multi-stage Dockerfile
- [ ] Unit: `parseDockerignore` håndterer anchored, unanchored, negation, glob-stjerner
- [ ] Unit: `isCodeAsset` returnerer true for `.json` under `src/data/`
- [ ] Integration: 2026-05-02 v9-incident-fixture trigger detection
- [ ] Integration: post-fix state (anchored `/data`) → clean
- [ ] Integration: stale-COPY-ref-fixture trigger detection
- [ ] Integration: multi-stage `--from=` COPY skips correctly
- [ ] Manual: deliberately-broken PR blocks merge in GitHub Actions
- [ ] Manual: clean main passes CI in <5s

## Implementation Steps

1. Skriv CLI-scaffold + parsers (Dockerfile + dockerignore via `ignore` npm-package).
2. Implementér cross-check + stale-ref-detection.
3. Test fixtures inkl. 2026-05-02 v9-incident reproduction.
4. Verify lokalt: `pnpm verify:dockerignore` på current main → exit-code 0 forventet.
5. Skriv `.github/workflows/build-context-audit.yml`.
6. Test workflow på en deliberately-broken PR (pre-merge til main).
7. Update FEATURES.md + ROADMAP.md med F177-row (per CLAUDE.md).
8. Opdater `docs/CONTRIBUTING.md` (eller equivalent) med kort sektion om hvordan man kører verify locally.
9. Optional bonus: `prepush` git-hook der kører `pnpm verify` (typecheck + dockerignore) automatisk.

## Dependencies

- **`ignore` npm-package** — mature dockerignore/gitignore-parser, ~50KB. Allerede transitive-dep i monorepoet (mange tools bruger det).
- **Bun runtime** — Trail's canonical runtime; `Bun.Glob` og built-in fs er nok.
- **F33 Fly deploy** ✅ — F177 er især relevant for Fly-deploys hvor build-context defineres af `flyctl`.

## Open Questions

- **Skal `# allow-build-exclude: <reason>`-kommentar-konvention shippe i Phase 1 eller v2?** Forslag: v2. Phase 1 markerer issues som warnings hvis de er bevidste; v2 introducerer explicit-allow.
- **Skal CI-jobet være required-gate eller advisory?** Forslag: required. Hvis det fanger en real bug (som det ville have gjort 2026-05-02), er merge-block korrekt adfærd. Engineering kan altid override med admin-permission hvis nødvendigt.
- **Skal F177 også checke `Dockerfile.builder` / `Dockerfile.dev`-varianter?** Forslag: ja, scan alle `Dockerfile*` patterns. Ikke kun production-Dockerfiles.
- **Naming-collision-cleanup (rename `src/data/` → `src/seed/`) som follow-up?** Christian's spørgsmål 2026-05-02: "Hvorfor skal glossary.json ekskluderes?" peger på at navne-collision er den dybere fælde. F177 fanger glob-bug; en rename eliminerer hele collision-klassen. Forslag: separat 0.5-dag oprydning efter F177 lander, ikke del af F177.

## Related Features

- **F33 Fly.io deploy** ✅ — F177's hjemmebane.
- **F176 Per-KB lint schedule** (sister-feature) — samme verify-script-pattern (lokal validering før prod).
- **Future F178 (potentielt)** — Secret-leakage detection in build context (orthogonal til F177; F177 sikrer at intended source er med, F178 ville sikre at unintended secrets ikke er med).
- **Naming-cleanup follow-up** — 0.5-dag rename af `apps/server/src/data/` → `apps/server/src/seed/` der eliminerer collision-klassen helt.

## Effort Estimate

**Small ½-1 dag** fordelt over 3 phases:

- Phase 1 CLI + fixtures: 0.5 dag
- Phase 2 CI integration: 0.25 dag
- Phase 3 docs + buddy-link: 0.25 dag
- Phase 4 stale pre-built artifact detection: 0.25 dag (added 2026-05-03)

Inkluderer typecheck, unit-tests, fixture-baseret integration-test, manual CI-gate-verification.

## Inspiration

2026-05-02 trail-engine v9 deploy-incident:

- engineering-session forsøgte F97 + F165.1 redeploy
- engine v9 crash-loopede ved boot fordi `apps/server/src/data/glossary.json` ikke var i image
- root cause: `**/data` (unanchored) ekskluderede både root `/data/` (intended runtime-volume) OG `apps/server/src/data/` (unintended source-asset)
- fix `44c23eb` ankrede patternet til `/data`
- F177 ville have fanget det automatisk pre-merge med output:
  ```
  ⚠️  COPY apps/server/src ./apps/server/src
       affected file: apps/server/src/data/glossary.json
       matches dockerignore pattern: **/data
       fix: anchor pattern to /data
  ```

Plus engineering-session's egen pointe (intercom #966): "Værdi-prop er den klassiske 'fanger en hel kategori af bugs i ét pass' — værd det." F177 er den klassiske CI-quality-gate hvor en lille investering forhindrer en hel klasse af recurring bugs.
