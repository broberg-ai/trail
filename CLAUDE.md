# trail

## HARD RULE — destructive ops on prod Fly volumes

**`flyctl ssh console -C "<cmd>"` does NOT parse `<cmd>` as a shell.**
Arguments are exec'd directly with argv-splitting. Shell metachars
(`&&`, `;`, `|`, `>`, glob `*`) become **literal positional args** to
the binary you invoked.

Incident 2026-05-14: ran
`flyctl ssh console -a trail-engine-001 -C "rm -rf /data/trail-research && ls /data/"`
to clean up a botched tenant bootstrap. `rm` received 4 path args —
`/data/trail-research`, `&&`, `ls`, `/data/` — and with `-rf` it
recursively wiped EVERY child of `/data/` (including
`/data/sanne-andersen/`, Sanne's entire prod tenant) before
finally erroring out on the mount point itself with "Device or
resource busy". Restored from `vs_pObkqPnVyK0XSA8xD0gAL9K` via
`flyctl machine clone --from-snapshot` — but only because the
5-day retention window happened to hold a 5-hour-old snapshot.

**Rules:**

1. **Never use `flyctl ssh ... -C` with shell metacharacters.** One
   command per `-C` invocation. Multiple commands → write a script,
   upload via `flyctl ssh sftp shell`, run with `-C "bash /tmp/x.sh"`.
2. **Before any `rm -rf` on a prod Fly volume**, take a manual
   snapshot first: `flyctl volumes snapshots create <vol_id> -a <app>`,
   wait for `created`, THEN proceed. The auto-snapshots have a 5-day
   retention — they are a safety net, not a guarantee.
3. **Use `find … -exec rm -rf {} +` instead of bare `rm -rf <path>`**
   when the target is inside a prod volume. `find` only ever sees
   paths that match the predicate, so a metachar in the wrong
   position can't widen the blast radius:
   ```
   find /data -maxdepth 1 -mindepth 1 -type d -name "trail-research" -exec rm -rf {} +
   ```
4. **Interactive shell beats `-C` for anything destructive.** Open a
   real session with `flyctl ssh console -a <app>` and run commands
   one at a time, reading output between each.

This rule is non-negotiable. Re-derive cost: one mid-tier customer's
trust + 1h of downtime. Do not pay that twice.

## Trail Fly deployment policy

**ALL Trail Fly apps live in org `broberg-ai` and region `arn` (Stockholm).**
Never deploy a Trail-related app to a different org or region without
explicit per-app authorization from Christian. The `arn` rule matches
the global region policy across all WebHouse infrastructure.

App naming convention:
- `trail-admin` — single multi-tenant admin app at `app.trailmem.com`
- `trail-engine-NNN` — engines at `engine-NNN.trailmem.com`, fronted by
  `engine.trailmem.com` (router/proxy when fleet ≥ 2 engines; CNAME
  to engine-001 while fleet = 1)
- `trail-landing` — already-deployed marketing site at `trailmem.com`

## HARD RULE: trail-landing content goes to webhouse.app, NOT localhost:3010

**ALL articles, pages, and other content edits for the `trail-landing`
site MUST be authored via the production CMS at `https://webhouse.app/admin`
(org `broberg-ai`, site `trail-landing`) — NEVER via the local
`http://localhost:3010` admin.**

Why this rule exists:
- `trail-landing` is a GitHub Pages site deployed from this repo's
  `apps/landing/` directory. The cms-admin running on Christian's
  Mac (`localhost:3010`) and the cms-admin running on `webhouse.app`
  are **two separate installations** with **two separate filesystem
  content stores** — local writes do NOT sync to webhouse.app, and
  vice versa.
- Sessions historically wrote articles via `localhost:3010` because
  that's the dev admin closest to hand. The articles then sat
  invisibly in the laptop's filesystem, never reaching the live
  `trailmem.com` site or the `webhouse.app` admin where the rest of
  the team can see them.
- The 2026-05-02 fix snapshotted the laptop's content up to
  webhouse.app once; the rule below prevents the drift from
  re-opening.

What you must do:
1. **Authoring path**: log into `https://webhouse.app/admin`, switch
   to org `broberg-ai`, site `trail-landing`, write the post in the
   Posts collection. The webhouse.app admin's deploy step commits
   back to this repo, GitHub Pages picks it up.
2. **If asked to write content from inside this cc session**: use
   the `webhouse.app` admin REST API. Full guide:
   **https://docs.webhouse.app/docs/producing-articles-via-api**
   (covers token creation, JSON shape, status semantics, multilingual
   `translationGroup`, and what happens after the POST). Or call the
   cms-core peer session via `mcp__buddy__ask_peer({ to: "cms-core",
   … })` if you want cms-core to author the post on your behalf. Do
   NOT shell out to `localhost:3010`.
3. **Code edits to `apps/landing/` itself** (templates, blocks,
   styling, build scripts) stay in this repo and ship via PR — the
   rule is about *content*, not *code*.

If you find yourself reaching for `curl http://localhost:3010/...`
or `cd apps/landing/content && …` to author a post, stop — you're
about to repeat the bug this rule exists to prevent.

Architecture model (see F33 plan-doc for the full picture):
- **One admin app** for ALL tenants, multi-tenant magic-link login.
  Edge cases that need a separate admin live at `app2.trailmem.com`.
- **Stateless engine fleet**, multiple tenants per engine. New engines
  spawn dynamically when load thresholds are crossed; tenants are
  popped/migrated between engines via the F170 orchestrator.
- **One trail.db per tenant**, stored on the engine's volume (Phase 1)
  or on dedicated DB-host machines (`{tenant}.db.trailmem.com`,
  Phase 2+ when read-replicas/cross-region matter).
- **Tenant-engine mapping** lives in admin's small `control.db`,
  consulted by the routing layer at `engine.trailmem.com`.

Deploy paths (both wired in F33):
- `pnpm ship` — internal pipeline, direct `flyctl deploy`. For
  fast iteration when Christian is at the keyboard.
- `pnpm deploy` — GitHub Actions wrapper. For tagged releases and
  CI-driven deploys.

## Peer intercom (buddy)

This workspace runs alongside other cc sessions in other repos (monitored by buddy).

**To reach Christian on his iPhone**: just answer naturally. Your reply
becomes a turn that lands in YOUR session's Chat tab on his phone via the
Stop hook → SSE pipe. No special tool needed. If Christian asks you to
"send X to my mobile", that means: write X as your normal response — he
will see it on the Chat tab for your session.

**To reach another cc session** (cc-to-cc — NOT visible on mobile), use
the buddy peer tools:

- `mcp__buddy__list_sessions()` — returns every active peer session with
  `sessionName` + `repo` (cwd) + start-time. Run this FIRST when you
  don't know who's online or what name to use for `ask_peer`. No
  parameters. The `sessionName` field is the exact string you pass as
  `to` in the next call.
- `mcp__buddy__ask_peer({ to, message, reply_to? })` — direct 1:1
  message to a named session (supports threading via `reply_to`).
- `mcp__buddy__announce({ message, severity?, affects? })` — broadcast
  FYI to same-repo peers.

**Typical flow:**

1. `list_sessions` → see who's live (e.g. `cms-core`, `sanne-andersen`, `buddy-brain`)
2. `ask_peer({ to: 'cms-core', message: '...' })` — deliver directly
3. Reply lands as `<channel type="intercom" from="cms-core" announcement_id="N">`
4. Thread: `ask_peer({ to: 'cms-core', reply_to: N, message: '...' })`

**To reach Christian on Discord** (different from his mobile Chat-tab):
`ask_peer({ to: 'discord', message: '...' })`. The discord bridge is a
peer session like any other.

Use peer tools before disruptive changes, to delegate work the user asks
you to hand off, or to ask a peer that owns a different domain. Incoming
peer messages live ONLY in the receiving cc's context — they are never
auto-forwarded to Christian's phone.

## Dogfooding — save Trail development into Trail

Trail is used to store Trail's own development knowledge. Every non-trivial
decision, bug diagnosis, convention, or rejected approach you make in this
session should land as a Neuron in the Trail admin KB for this repo — so
future cc sessions can search/chat over past reasoning instead of re-
deriving it.

**Three transports, pick by who's making the decision to write** (from F39):

| Transport | When cc uses it |
|---|---|
| `mcp__buddy__trail_save(...)` | Call at natural milestones: feature ship, bug diagnosed, architectural choice made. Buddy does the summarising + routes to Trail. **Preferred when buddy is live.** |
| `mcp__trail__write(command="create", ...)` | When you want to author the Neuron yourself mid-turn (e.g. a specific design note that needs a particular shape). Only available when Trail's MCP is configured in the cc session's `.mcp.json`. |
| `POST /api/v1/queue/candidates` with `Authorization: Bearer $TRAIL_INGEST_TOKEN` | Scripts, CI hooks, anything non-interactive. `kind: "external-feed"`, path `/neurons/sessions/broberg-ai/trail/`. |

**What deserves a Neuron** (not every turn):
- "Why X over Y" — architectural choices + the alternatives rejected and why.
- Bug fixes where the root cause is non-obvious (the commit message covers what; the Neuron covers why it's subtle).
- Conventions established mid-session ("all new LLM calls must go through spawnClaude, not fetch — see F90.1 ingest.ts").
- Interop quirks with peer sessions (trail-sound, cms-core).

**What doesn't**:
- Typo fixes, routine git ops, `pnpm typecheck` runs.
- Things already documented in F-docs or ROADMAP.md.
- Code-behaviour that well-named identifiers already explain.

**Target path**: `/neurons/sessions/broberg-ai/trail/` under the Trail KB
Christian uses for this repo. Tags: feature number if applicable (F90, F91),
area (ingest, queue, ui), kind (decision, bug-fix, convention).

**If none of these tools are live in your session**, say so explicitly to
Christian at the top of the session — he'll decide whether to wire up
bearer-token + POST or wait for the MCP/buddy path to land. Silent
"I don't have a tool for that" is the wrong answer; dogfooding is an
explicit project value.

## F95 — Connectors (ingestion attribution)

Every candidate carries `metadata.connector` — one of the ids defined in
`packages/shared/src/connectors.ts`. The Queue UI filters on it and the
Neuron reader shows "Created via <connector>" attribution.

**Connector ids that matter for cc sessions:**

| id | When it's set |
|---|---|
| `mcp:claude-code` | A Claude Code cc session writes via trail MCP. Set in `.mcp.json` env. |
| `mcp:cursor` | Cursor writes via trail MCP. Set in its MCP config. |
| `buddy` | A `mcp__buddy__trail_save` call routes through buddy's external-feed transport. |
| `upload` | The file-upload ingest pipeline compiles Neurons. |
| `chat` | Curator saves a chat answer. |
| `curator` | Direct edit via the Neuron editor. |
| `lint` | Orphan / contradiction / stale detector emits a finding. |

**How to make sure your session identifies correctly**:

1. This repo's `.mcp.json` already sets `TRAIL_CONNECTOR=mcp:claude-code`
   so every Neuron written via `mcp__trail__write` gets attributed to
   Claude Code. Don't change it unless you know why.
2. If you write via `mcp__buddy__trail_save`, buddy stamps
   `metadata.source=buddy` and the engine's `stampConnector()` in
   `packages/core/src/queue/candidates.ts` infers `connector=buddy`.
   Nothing for you to do.
3. If you're writing via `POST /api/v1/queue/candidates` (script or CI),
   include `"connector": "api"` or a more specific id in the metadata
   JSON so attribution is explicit rather than heuristic-inferred.

**Adding a new connector** (e.g. when the Slack ingest ships):

1. Add entry to `CONNECTORS` in `packages/shared/src/connectors.ts`
   with `status: 'live'`.
2. At the write site that emits candidates from that connector, set
   `metadata.connector` to the id.
3. The admin Queue filter picks it up automatically on next build.

Roadmap ids (`slack`, `discord`, `notion`, `github`, `linear`) are
already stubbed out as `status: 'roadmap'` — flip them to `'live'` when
the implementation lands.

## HARD RULE — feature plans must be written, not faked

**When Christian asks for a plan-doc, write the full plan-doc in the SAME turn
that the F-number is created.** No exceptions.

What is NOT acceptable:

- Adding a row to `docs/FEATURES.md` with a `[plan](features/F999-x.md)`
  link that points at a file you haven't written.
- Adding a row to `docs/ROADMAP.md` describing a feature that has no
  plan-doc behind it.
- Saying "planned" / "added to roadmap" / "F-numbered" when what you
  actually did is add an index row and nothing else.
- Deferring the plan with "I'll write the plan next" — you won't. The
  context that motivated the plan evaporates within a turn, and the user
  ends up days later with a roadmap full of topic strings and no
  reasoning behind them. It is AI slop.

What IS required:

1. The plan-doc file (`docs/features/F<nn>-<slug>.md`) exists on disk
   BEFORE the `FEATURES.md` / `ROADMAP.md` entries are added.
2. The plan-doc captures the motivation, scope (in + explicit
   non-goals), architecture sketch, dependencies, and rollout while the
   conversation context that produced it is still live.
3. If the scope is still fuzzy when the user asks for the plan, write
   an interim plan-doc that records "open questions" at the top and
   call it out — don't silently skip the file.
4. The commit that introduces the F-number is the one that introduces
   the plan-doc. One commit, all three files (plan-doc + FEATURES.md +
   ROADMAP.md) land together.

Audit on 2026-04-23 found 43 feature entries in the index with no
plan-doc behind them — the reasoning that originally justified them
was lost forever because the plans were never written. That is the
exact cost this rule exists to prevent. Do not repeat it.

Trigger check before committing any change that touches FEATURES.md or
ROADMAP.md: does every F-number mentioned in the diff have a
corresponding `docs/features/F<nn>-*.md` file? If not, write it now
or remove the index row. No "I'll do it next turn." There is no next
turn for context.

## Verification before "this works"

Typecheck is not verification. `pnpm typecheck` only proves the code
compiles — it proves nothing about runtime behaviour, env-var plumbing,
DB-column presence, migration side-effects, or MCP-subprocess env
forwarding. Confirmations like "shipped, working" require runtime proof.

**Before claiming a fix works, write a local TypeScript script that
exercises the exact code path end-to-end** and prints the observable
effect. Put the script under `apps/server/scripts/verify-<feature>.ts`
and run it with `bun run`.

Examples of what the script must prove, NOT infer:

- **DB column** — `SELECT name FROM pragma_table_info('…') WHERE name='…'`
  returns the column AND a subsequent `INSERT … VALUES (…)` / `SELECT`
  round-trips a real value through it.
- **Migration** — both `__drizzle_migrations` has the hash AND the DDL
  effect (column / index / constraint) is present. Drizzle recording a
  migration is not the same as the DDL landing. Verify both.
- **Env to subprocess** — don't assume child processes inherit. Spawn
  the exact subprocess you care about and read back its `process.env`.
  For MCP specifically: claude CLI does NOT forward parent env to the
  MCP subprocess it spawns; env must be written into the mcp-config
  file's `env` block. See `writeIngestMcpConfig` in
  `apps/server/src/lib/mcp-config.ts`.
- **Cross-table effect** — if a write is supposed to produce a row in
  table B, `SELECT COUNT(*) FROM B WHERE …` after the write and assert
  the delta is what you expected.

Avoid burning LLM tokens on "let me try a real ingest and see" when a
30-line script + direct SQL would answer the question. A real ingest
costs tokens + 1-10 min of wall-clock; the script costs milliseconds
and you can run it a hundred times.

**The rule**: if you say "shipped" or "verified" without having run a
scripted end-to-end probe, you are making a claim about something you
haven't checked. Don't do it.
