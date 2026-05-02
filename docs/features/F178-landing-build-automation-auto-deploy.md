# F178 — Landing build automation + auto-deploy

> Tre lag der eliminerer hele klassen af "I committed but the live site shows old content"-bugs som ramte i 2026-05-02-session: (1) `pnpm landing:ship` wrapper-script der tvinger korrekt env + build-rækkefølge, (2) Zod-schema validation på post-JSON med fail-loud-on-missing-fields, (3) GitHub Actions workflow der auto-deployer landing-site ved push til main hvis `apps/landing/content/**` eller `apps/landing/public/**` ændres. Tier: infrastructure / dev-experience. Effort: Small ½-1 dag. Status: Planned.

## Problem

2026-05-02-session demonstrerede at landing-site har fire forskellige måder at fejle stille på, og ingen af dem fanges af eksisterende tooling:

### Fejl 1 — Ingen auto-deploy

Christian opdagede at en ny markedsføringsartikel ikke var live efter `git push`. Hans mentale model var at GitHub Pages auto-deployer landing-siden. Empirisk evidens: GHP er ikke aktiveret på `broberg-ai/trail`, og landing-siden hostes på Fly. Sidste deploy var `v4` fra 29. april — fire dage gammel — fordi nogen manuelt skal køre `flyctl deploy` for at en ny commit lander på prod. Resultat: nye artikler "publishes" til git men er usynlige indtil nogen husker at deploye. Dette er den primære fejl-mode, og den ramte direkte fordi Christian troede systemet var auto-deploy'et.

### Fejl 2 — `BUILD_OUT_DIR` defaulter forkert

`apps/landing/build.ts` linje 43: `const OUT_DIR = process.env.BUILD_OUT_DIR ?? "dist"`. Default er `dist/`. Men Dockerfile copyer fra `deploy/`. Hvis udvikler kører `npx tsx build.ts` uden env-var, bygger SSG'en til `dist/` — som ikke deployes. Default-værdien er hostile mod den faktiske deploy-kontrakt. Footgun.

### Fejl 3 — JSON-schema er ikke valideret

Posts er JSON-filer i `apps/landing/content/posts/*.json`. Build-scriptet læser `post.data.{title, excerpt, content, date, author, category, tags, readTime}` — alle nested under `data{}`. Hvis curator (eller en cc-session) flytter felter ud af `data{}` ved et uheld, **build skipper posten stille** (eller renderer den med tomme metadata). Ingen fejl, ingen advarsel, intet exit-code. Posten ser bare ikke ud som forventet på live.

### Fejl 4 — Stale build-output kan committes

`apps/landing/deploy/` er tracket i git. Hvis udvikler edit'er JSON men glemmer at køre `npx tsx build.ts` før `git add deploy/`, committer de **stale HTML der ikke matcher kilden**. Fly-deployet lykkes (Docker bygger), men live serverer gammelt indhold. Først ved manuel inspektion på live opdager udvikleren at noget er galt.

### Hvorfor det rammer hårdt

De fire fejl-modes er additive: de stacker. 2026-05-02-session ramte dem ALLE FIRE i én artikel-publish:
1. Pushed JSON + SVGs men ingen auto-deploy → live var stale (Fejl 1)
2. Manuel deploy fra repo-root fejlede pga. root-`.dockerignore` (separat issue)
3. Lokalt `npx tsx build.ts` skrev til `dist/`, ikke `deploy/` → ingen forskel for prod (Fejl 2)
4. Rewrite af JSON flyttede `date/author/category/tags/readTime` ud af `data{}` → build skipped posten (Fejl 3)
5. Forsøgte at committe stale `deploy/` (Fejl 4) — kom i kraft af at jeg fixede ovenstående

Hvert fix var trivielt isoleret. Men kæden var pinefuld — kostede ~30 min wallclock og ~5 commits før artiklen reelt var live med korrekt indhold.

F178 lukker alle fire fejl-modes med tre defensive lag der hver fanger en distinkt klasse.

## Secondary Pain Points

- **Læse-skrive-konsistens** — landing-CMS skriver til `_data/audit.jsonl`, `_data/server.jsonl`, `_data/site-config.json` runtime; disse runtime-logs skal IKKE committes på hver post-publish, men der er ingen `.gitignore`-regel der filtrerer dem fra. Curator skal manuelt undgå at stage dem.
- **Ingen lokal preview** — udvikler kan ikke nemt verificere at en JSON-redigering renderer korrekt før commit. `npx tsx build.ts` + åbn `dist/trails/.../index.html` i browser virker, men er ikke dokumenteret som workflow.
- **Christian's mentale model er GHP** — F178 lander Fly auto-deploy under git push, hvilket er semantisk det Christian forventede. Ingen mental-model-redesign nødvendigt — vi gør hans antagelse korrekt i stedet for at correcte ham.

## Solution

### Lag 1 — `pnpm landing:ship` wrapper-script

Tilføj ny pnpm-script til `apps/landing/package.json`:

```json
{
  "scripts": {
    "build": "BUILD_OUT_DIR=deploy npx tsx build.ts",
    "ship": "pnpm build && flyctl deploy --remote-only"
  }
}
```

Bruger kører `pnpm --filter trail-landing ship` (eller fra `apps/landing/`: `pnpm ship`). Det:
1. Bygger med korrekt `BUILD_OUT_DIR=deploy` (eliminerer Fejl 2)
2. Stopper hvis build fejler (Zod schema-validation fra Lag 2)
3. Kører `flyctl deploy --remote-only` direkte
4. Eliminerer manual-step-rækkefølge der gav Fejl 4

Manuel-flow til daglig brug. CI-flow (Lag 3) kalder samme `pnpm build` + `flyctl deploy` for konsistens.

### Lag 2 — Zod schema-validation i `build.ts`

Tilføj schema-check ved JSON-parse-tid:

```typescript
import { z } from "zod";

const PostSchema = z.object({
  slug: z.string().min(1),
  status: z.enum(["draft", "published", "archived"]),
  data: z.object({
    title: z.string().min(1),
    excerpt: z.string().min(1),
    content: z.string().min(10),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    author: z.string().min(1),
    category: z.enum(["how-trail-works", "research", "field-notes", "dispatches", "the-1945-concept"]),
    tags: z.array(z.string()).min(1),
    readTime: z.string().regex(/^\d+\s+min\s+read$/),
  }),
  id: z.string().min(1),
  updatedAt: z.string().optional(),
});

function readCollection(name: string) {
  const dir = join(CONTENT_DIR, name);
  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const filePath = join(dir, f);
      const raw = JSON.parse(readFileSync(filePath, "utf-8"));
      const parsed = PostSchema.safeParse(raw);
      if (!parsed.success) {
        console.error(`\n❌ Invalid post: ${filePath}`);
        for (const issue of parsed.error.issues) {
          console.error(`   ${issue.path.join(".")}: ${issue.message}`);
        }
        console.error(`\n   Valid post structure (matches knowledge-that-compounds.json):`);
        console.error(`   { slug, status, data: { title, excerpt, content, date, author, category, tags, readTime }, id, updatedAt }\n`);
        process.exit(1);
      }
      return parsed.data;
    });
}
```

Effekt: hvis post-JSON mangler felter (eller felter er flyttet ud af `data{}` per Fejl 3), failer build med præcist fejl-output:
```
❌ Invalid post: content/posts/niklas-luhmann-zettelkasten-llm-wiki.json
   data.date: Required
   data.author: Required
   data.category: Required
   data.tags: Required
   data.readTime: Required
```

Curator (eller cc-session) ser hvilke felter der mangler og hvor de skal være. Build kan ikke producere stille-stale-HTML.

**Schema-evolution**: hvis vi senere tilføjer optional felter (fx `_lastEditedBy`, `image`), tilføjes de som `.optional()` i schemaet. Ingen breaking change for eksisterende posts.

### Lag 3 — GitHub Actions auto-deploy

Ny fil `.github/workflows/landing-deploy.yml`:

```yaml
name: Landing auto-deploy
on:
  push:
    branches: [main]
    paths:
      - 'apps/landing/content/**'
      - 'apps/landing/public/**'
      - 'apps/landing/build.ts'
      - 'apps/landing/Dockerfile'
      - 'apps/landing/fly.toml'

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        working-directory: apps/landing
        run: pnpm install --frozen-lockfile

      - name: Build static site
        working-directory: apps/landing
        run: pnpm build  # = BUILD_OUT_DIR=deploy npx tsx build.ts

      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly
        working-directory: apps/landing
        run: flyctl deploy --remote-only --config fly.toml
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

      - name: Notify mobile (optional)
        if: success()
        run: |
          curl -X POST "${{ secrets.WEBHOUSE_NOTIFY_URL }}" \
            -H "Content-Type: application/json" \
            -d '{"channel":"trail-deploys","message":"trail-landing deployed: ${{ github.event.head_commit.message }}"}' \
            || true
```

**Trigger-betingelser** er bevidst snævre:
- `apps/landing/content/**` — nye/ændrede posts
- `apps/landing/public/**` — nye/ændrede assets (SVGs, billeder)
- `apps/landing/build.ts` + `Dockerfile` + `fly.toml` — build/deploy-konfig

Ikke trigger på `apps/landing/_data/**` (runtime-logs) eller `apps/landing/deploy/**` (build-output — hvis det committes manuelt skal det IKKE re-trigge en ny build).

**Secret krav**: `FLY_API_TOKEN` skal sættes i repo-settings → Secrets → Actions. Genereres via `flyctl auth token` (Christian gør én gang ved F178 setup).

**Mobile notification (optional)**: hvis `WEBHOUSE_NOTIFY_URL` secret er sat, sendes en push til Christian når deploy er done. Closer hans tidligere ønske ("cms-core havde fixet så vi fik en notifikation"). `|| true` så notify-fail ikke breaker deploy-step.

## Non-Goals

- **Ikke automatisk commit af `deploy/` build-output**. Workflow bygger frisk på CI; den committer ikke build-artefakter tilbage til repo. Det betyder `apps/landing/deploy/` i git bliver ude-af-sync med live efter F178 lander — kunne enten gitignores helt (cleaner) eller kommitteres manuelt af developer (status quo). Forslag: **gitignore deploy/** efter F178 (men out of F178 scope; separat oprydning).
- **Ikke runtime-CMS-features**. Landing-CMS (audit.jsonl, server.jsonl) er Christian's editor-flow; F178 berører det ikke.
- **Ikke landing-site-redesign**. Ren CI/UX, ingen visual ændringer.
- **Ikke per-post preview-deploys**. PR-niveau preview-environments er separate features (kunne være F178.1 hvis behov opstår).
- **Ikke schema-migration for eksisterende posts**. Phase 2 kører Zod på alle eksisterende posts; hvis nogle ikke matcher (legacy fields), shippes de først efter en human-edit-runde. Forventet: 0 problemer på de 9 nuværende posts (alle har samme struktur som `knowledge-that-compounds.json`).
- **Ikke GHP-migration**. Christian's mentale model er GHP, men Fly-arkitekturen er allerede valgt og fungerer. F178 gør Fly opfører sig som auto-deploy som GHP ville.
- **Ikke incremental builds**. SSG'en bygger hele site på hver run (53 pages, ~1-2 sek). Incremental ville være over-engineering på dette skala.

## Technical Design

### 1. `apps/landing/package.json` ændringer

```json
{
  "name": "trail-landing",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "BUILD_OUT_DIR=deploy npx tsx build.ts",
    "build:dev": "npx tsx build.ts",
    "validate": "npx tsx scripts/validate-content.ts",
    "ship": "pnpm validate && pnpm build && flyctl deploy --remote-only"
  },
  "dependencies": {
    "marked": "^15.0.0",
    "@webhouse/cms": "^0.2.0",
    "tsx": "^4.19.0",
    "zod": "^3.23.0"
  }
}
```

`build:dev` bevares som default-`dist/`-build for hurtig iteration uden at røre prod-`deploy/`-mappe. `validate` kan køres standalone (preview før build). `ship` er one-stop til prod-deploy.

### 2. `apps/landing/build.ts` schema-validation

Indsæt PostSchema (Zod) ved toppen af build.ts og opdater `readCollection` til at validere hver post. Hvis fejl: print path + alle issues + correct-shape eksempel, exit 1.

### 3. `apps/landing/scripts/validate-content.ts` (ny fil)

Standalone validator der KUN tjekker schema, uden at bygge. Useful for editor-flow:

```typescript
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PostSchema } from "../build.js"; // exported from build.ts

let errors = 0;
const dir = join(import.meta.dirname, "../content/posts");
for (const f of readdirSync(dir).filter(f => f.endsWith(".json"))) {
  const path = join(dir, f);
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const parsed = PostSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`❌ ${f}`);
    for (const issue of parsed.error.issues) {
      console.error(`   ${issue.path.join(".")}: ${issue.message}`);
    }
    errors++;
  } else {
    console.log(`✓ ${f}`);
  }
}
process.exit(errors > 0 ? 1 : 0);
```

### 4. `.github/workflows/landing-deploy.yml`

Som ovenfor. Single job, ~3-5 min wall-clock total (checkout + install + build + deploy).

### 5. `.gitignore`-tilføjelse

```
# Landing build output — generated by `pnpm --filter trail-landing build`,
# regenerated on every CI deploy. Don't commit.
apps/landing/deploy/
```

**OBS**: dette er en breaking change for nuværende workflow hvor `deploy/` committes. Phased rollout:
- Phase 1 (F178 ship): tilføj script + Zod + CI workflow. `deploy/` forbliver i git for at undgå at brække Christian's eksisterende manual-deploy-flow.
- Phase 2 (separat F178.1 efter 1 uge stabil CI): gitignore `deploy/` + `git rm -r --cached deploy/` + en ren deploy-cycle der bekræfter intet brækker.

### 6. Secrets-setup (én-gangs manuel step)

Christian kører lokalt:

```bash
flyctl auth token  # prints token
gh secret set FLY_API_TOKEN --repo broberg-ai/trail < <(flyctl auth token)
```

Efter det fungerer auto-deploy ved hver push.

## Interface

### CLI

```bash
# From repo root
pnpm --filter trail-landing build       # Validate + build to deploy/
pnpm --filter trail-landing ship        # Validate + build + deploy
pnpm --filter trail-landing validate    # Validate only (no build)

# Or from apps/landing/
pnpm build
pnpm ship
pnpm validate
```

### CI

PR til main → no auto-deploy (kun PR-checks hvis tilføjet senere).
Push direkte til main hvor landing-content/public ændres → auto-build + deploy.

### Schema-fejl-output

Eksempel-output ved invalid post:

```
❌ content/posts/some-post.json
   data.date: Required
   data.category: Invalid enum value. Expected 'how-trail-works' | 'research' | ..., received undefined

Valid post shape:
{ slug, status, data: { title, excerpt, content, date, author, category, tags, readTime }, id, updatedAt }

Build aborted. Fix the post and re-run.
```

## Rollout

**Phase 1 — Local scripts + schema (0.25 dag)**. `package.json` scripts, Zod schema i `build.ts`, validate-script. Test lokalt: `pnpm validate` mod alle 9 nuværende posts → alle ✓. `pnpm build` skriver korrekt til `deploy/`. `pnpm ship` deployer end-to-end.

**Phase 2 — GitHub Actions workflow (0.25 dag)**. Skriv workflow-fil. Christian sætter `FLY_API_TOKEN` secret. Trigger workflow manuelt én gang for at validere det virker. Næste push til main med content-change skal trigge auto-deploy.

**Phase 3 — Documentation + buddy notification (0.25 dag)**. Opdater CLAUDE.md eller lav ny `apps/landing/README.md` med workflow-beskrivelse. Optional: koble notification-step til buddy/Discord så Christian får besked.

**Phase 4 (separat, efter 1 uge stabil CI) — gitignore `deploy/`**. Git rm cached, gitignore add. Forhindrer fremtidige stale-deploy-commits.

**Total effort:** Small ½-1 dag.

## Success Criteria

- `pnpm --filter trail-landing ship` deployer en ny post end-to-end uden manuel env-var.
- En post der mangler `data.date` failer build med tydelig fejl-output før noget pushes til Fly.
- Push til main med ændring i `apps/landing/content/posts/` trigger workflow inden 60 sekunder.
- Workflow ship'er ny version til Fly inden 5 min.
- 0 commits efter F178-shipping hvor live trailmem.com viser stale-content efter en push (det skete i 2026-05-02-session — F178 forhindrer det).
- Christian's mentale model "git push → live" matcher virkeligheden.

## Impact Analysis

### Files created

- `.github/workflows/landing-deploy.yml`
- `apps/landing/scripts/validate-content.ts`
- `apps/landing/README.md` (workflow-doc, optional)

### Files modified

- `apps/landing/package.json` — nye scripts + zod-dep
- `apps/landing/build.ts` — Zod schema + validation i `readCollection`
- `.gitignore` (Phase 4 only) — tilføj `apps/landing/deploy/`

### Blast radius

- Schema-validation kan blokere build hvis nuværende posts er invalid. Mitigation: kør `pnpm validate` først ved F178-shipping; fix evt. legacy-posts før Zod-check enables. Forventet: 0 issues på de 9 nuværende posts (de har alle samme struktur som referencen `knowledge-that-compounds.json`).
- Workflow trigger-paths er konservative — ikke trigger på unrelated repo-changes. Ingen risk for runaway deploys.
- `FLY_API_TOKEN` secret: hvis lækket, angriber kan deploye til trail-landing. Mitigation: Fly token kan revokes og roteres på 1 min via `flyctl auth token`. Lavt-risiko-secret (kun landing-site, ikke engine eller admin).

### Breaking changes

- Eksisterende manual-deploy-flow forbliver kompatibel: `cd apps/landing && flyctl deploy --remote-only` virker stadig efter F178.
- Hvis Phase 4 (gitignore deploy/) lander, brækker det manuelt-build-uden-pnpm-flow. Phase 4 er separat og kan deferres.

### Test plan

- [ ] `pnpm typecheck` clean efter F178 lander (Zod-import + schema-decl skal compile)
- [ ] Unit: `PostSchema.safeParse` returnerer success for hver af de 9 nuværende posts
- [ ] Unit: `PostSchema.safeParse` returnerer failure med præcise issues for et synthetisk invalid post (felt flyttet ud af `data{}`)
- [ ] Integration: `pnpm --filter trail-landing build` skriver til `deploy/` (ikke `dist/`)
- [ ] Integration: `pnpm --filter trail-landing validate` exit-code 0 på clean state
- [ ] E2E: lokal `pnpm ship` deployer en testpost end-to-end + verificerer den live på trail-landing.fly.dev
- [ ] E2E (CI): push en testbranch til main med JSON-edit → workflow fyrer → live opdateret inden 5 min
- [ ] Negative: skub en bevidst-broken JSON → workflow failer på build-step → live IKKE opdateret → curator får tydelig fejl-output i workflow-log

## Implementation Steps

1. Tilføj `zod` dependency til `apps/landing/package.json`.
2. Skriv `PostSchema` i `apps/landing/build.ts` + opdater `readCollection` til at validere.
3. Skriv `apps/landing/scripts/validate-content.ts` standalone-validator.
4. Tilføj `build`, `build:dev`, `validate`, `ship` scripts til `package.json`.
5. Test lokalt: `pnpm validate` på alle 9 posts → alle ✓.
6. Test lokalt: bevidst-broken post → `pnpm validate` failer med præcis output.
7. Skriv `.github/workflows/landing-deploy.yml`.
8. Christian sætter `FLY_API_TOKEN` repo-secret.
9. Test workflow: push en docs-only-change til main → workflow trigger IKKE (path-filter respekteres).
10. Test workflow: push en `apps/landing/content/posts/`-edit → workflow trigger → deploy.
11. Skriv `apps/landing/README.md` med workflow-doc.
12. Phase 4 deferred: `git rm --cached deploy/` + gitignore + en stabil-test-uge før commit.

## Dependencies

- **Zod** — schema-validation library, mature, ~50KB. Allerede dep i monorepoet (`packages/shared/src/schemas.ts` bruger zod).
- **pnpm 9** — already canonical package manager.
- **Fly auth token** — manuel step, én gang.
- **F33 Fly deploy** ✅ — landing er allerede på Fly via F33.
- **F177 Pre-deploy build-context audit** (Planned) — F178 og F177 er sister-features. F177 fanger build-context-fejl på engine; F178 fanger build/deploy-disciplin-fejl på landing. Begge bygger CI-pre-merge gates op for hver app's deploy-flow.

## Open Questions

- **Skal F178 også gælde for engine + admin deploys?** Forslag: nej i scope — engine + admin har deres egen `pnpm ship` (per F33 plan-doc) som kører via flyctl direkte. F178 er specifikt for landing's SSG-build-flow som er distinkt. Hvis engine + admin også skulle have auto-deploy ved push, det bliver F179 (separat, samme pattern).
- **Notification-target**: Christian's idé om "cms får besked når deploy er done" — buddy intercom? Mobile push via webhouse-notify? Discord? Forslag: lavest-friction = buddy-notification-pipeline (cross-session notification der allerede eksisterer). Simple POST.
- **PR preview-deploys?** Out-of-scope for F178 v1, men værd at flagge: en separat workflow kunne builde + deploye til `pr-{N}.trail-landing.fly.dev` for review-flows. Lille feature post-F178 hvis behov.
- **Schema-versioning**: PostSchema er hardcoded med 5 kategorier (`how-trail-works | research | field-notes | dispatches | the-1945-concept`). Hvis Christian vil tilføje en kategori, skal Zod-schema opdateres. Dokumenteres i README. Alternativt: lade `category` være string + soft-validate mod en kategori-liste i config.

## Related Features

- **F33 Fly deploy** ✅ — landing er på Fly via F33.
- **F177 Pre-deploy build-context audit** (Planned) — sister-feature; F177 fanger Dockerfile-glob-konflikter på engine, F178 fanger SSG-build-flow-fejl på landing.
- **F176 Per-KB lint schedule** (in progress) — verify-script-pattern matchet (F178's `validate-content.ts` følger samme princip: small standalone script der asserter invariant uden at køre fuld pipeline).
- **F47 / F50 / buddy-notification-pipeline** — F178's optional mobile-notify step kobler ind på eksisterende cross-session-notification.

## Effort Estimate

**Small ½-1 dag** fordelt over 4 phases:

- Phase 1 local scripts + schema: 0.25 dag
- Phase 2 GH Actions workflow: 0.25 dag
- Phase 3 docs + notify: 0.25 dag
- Phase 4 (separat) gitignore deploy: 0.25 dag

Inkluderer typecheck, unit-tests af PostSchema, manual end-to-end fra `pnpm ship` til verificeret-live, deliberately-broken-PR-test af workflow.

## Inspiration

2026-05-02-session ramte alle fire fejl-modes i én artikel-publish (Niklas Luhmann landing post). Christian's reaktion: *"Men det plejer jo at virke, den er jo på GHP og den er live nu, det tager bare lidt tid"* — hans mentale model var auto-deploy. Faktum var at landing-siden ikke var blevet redeployet i 4 dage. F178 gør hans antagelse korrekt i stedet for at correcte den.

Specifik incident-data fra 2026-05-02:

- **Tidsforbrug**: ~30 min wallclock fra "publishing artikel" til "verifieret korrekt indhold live på trailmem.com"
- **Antal commits krævet**: 5 (ddad760, ff30dd1, 379aa30, plus 2 feedback-rewrite-cycles)
- **Antal fejl-modes ramt**: 4 (no auto-deploy, BUILD_OUT_DIR default, JSON-schema-drift, stale deploy-commit)

F178 reducerer dette til: `git push → 5 min CI → live`. Én-trins.
