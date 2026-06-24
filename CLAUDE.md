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

## Scheduled dispatch (buddy F062) — how auto-ingest reaches this session

buddy is a central "cron as a service". Recurring jobs are registered with
`mcp__buddy__schedule_job` (+ `list_jobs`, `cancel_job`, `pause_all` = fleet
emergency-stop). Two kinds: `interval` (fire every period) and `probe` (poll an
HTTP endpoint, dispatch ONLY when it reports pending work, deduped). The job's
`command` is delivered to a target cc session **as an intercom turn**
(`<channel type="intercom" from="buddy-dispatch">`).

**THE BINDING RULE:** when a `from="buddy-dispatch"` intercom lands carrying a
`/command` (e.g. `/local-ingest sanne-andersen`), it is a **directive to run
that command immediately** — not an FYI. Execute it that turn.

**$0 invariant:** dispatch only ever targets a RUNNING interactive cc session
(intercom), or `auto_launch` opens an interactive Max session (iTerm `ccb`,
never headless `claude -p`). Honours `pause_all`.

**Trail's registered jobs (F191.8 — local-ingest auto-dispatch):** two probe
jobs, both 120s, target session `trail`:
- broberg-ai → `/local-ingest broberg-ai`
- sanne-andersen → `/local-ingest sanne-andersen`

Each probes the tenant-wide `GET /api/v1/documents?awaitingLocalCompile=true`
(`{documents, ids}`; key in `.env.local-ingest`, `X-Trail-Tenant` header). When
a dropped source parks, buddy dispatches `/local-ingest <tenant>` here; the
skill compiles it $0 and the engine emits a `source_compiled` SSE event so the
Ingest Station banner self-clears. Manage/inspect via `list_jobs`; re-register
(after key rotation etc.) via `schedule_job` with the contract above.

## Dogfooding — save Trail development into Trail

Trail is used to store Trail's own development knowledge. Every non-trivial
decision, bug diagnosis, convention, or rejected approach you make in this
session should land as a Neuron in the Trail admin KB for this repo — so
future cc sessions can search/chat over past reasoning instead of re-
deriving it.

**Three transports, pick by who's making the decision to write** (from F39):

| Transport | When cc uses it |
|---|---|
| `mcp__buddy__trail_save(...)` | Call at natural milestones: feature ship, bug diagnosed, architectural choice made. You write the finished takeaway; buddy routes it verbatim to Trail (no summarising). **Preferred when buddy is live.** |
| `mcp__trail__write(command="create", ...)` | When you want to author the Neuron yourself mid-turn (e.g. a specific design note that needs a particular shape). Only available when Trail's MCP is configured in the cc session's `.mcp.json`. |
| `POST /api/v1/queue/candidates` with `Authorization: Bearer $TRAIL_INGEST_TOKEN` | Scripts, CI hooks, anything non-interactive. `kind: "external-feed"`, path `/neurons/sessions/trail/`. |

**What deserves a Neuron** (not every turn):
- "Why X over Y" — architectural choices + the alternatives rejected and why.
- Bug fixes where the root cause is non-obvious (the commit message covers what; the Neuron covers why it's subtle).
- Conventions established mid-session ("all new LLM calls must go through spawnClaude, not fetch — see F90.1 ingest.ts").
- Interop quirks with peer sessions (trail-sound, cms-core).

**What doesn't**:
- Typo fixes, routine git ops, `pnpm typecheck` runs.
- Things already documented in F-docs or ROADMAP.md.
- Code-behaviour that well-named identifiers already explain.

**Target path**: `/neurons/sessions/trail/` under the Trail KB Christian uses
for this repo. Tags: feature number if applicable (F90, F91), area (ingest,
queue, ui), kind (decision, bug-fix, convention).

**Path convention** (decided 2026-06-02): Neuron paths are
`/neurons/<kind>/<source>/` — `kind` ∈ sessions, intercom, adr, caught-bugs,
concepts, entities, heuristics, sources, queries; `source` = the repo/peer the
knowledge came from (`trail`, `buddy`, `upmetrics`, …). **No org segment** — the
whole KB is already the broberg-ai tenant, so a `/broberg-ai/` segment is
redundant. Don't reintroduce it.

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

## Project layout

> **Canonical section per F057 multi-project convention.** Skills (`feature.md` and friends) read from this table when proposing where a change lives. Every cardmem-compatible repo MUST have a `## Project layout` section in its `CLAUDE.md` with the same columns: `Area | Path | Notes`.

| Area | Path | Notes |
|---|---|---|
| Server | `apps/server/` | Bun + Hono. REST + MCP at `POST /mcp` + bot adapters. Dev port `7474`. Entry: `apps/server/src/index.ts`. |
| Web (SPA) | `apps/web/` | Vite 5.4 + Preact 10 + TypeScript. Dev port `3019`. Entry: `apps/web/src/app.tsx`. Vite proxies `/health` + `/api/*` to the server. |
| Daemon | `apps/agent/` | Local-side automation (launchd-managed, `127.0.0.1:7475`). Forwards `card_moved` to buddy, scaffold-write, project sync. |
| Feedback widget | `apps/feedback-widget/` | Embedded vanilla JS SDK for capturing ideas from third-party sites. Phase 4. |
| Schema | `packages/db/` | Drizzle schema + migrations. Local SQLite (`./local.db`), prod libSQL on Fly volume with Litestream → Tigris. |
| Shared types | `packages/shared/` | Zod schemas + shared TS types. Used on every boundary (MCP args, API bodies, env). |
| MCP tools | `packages/mcp-tools/` | Tool definitions registered with the server. One file per tool under `src/tools/`. |
| GitHub integration | `packages/github/` | Octokit + GitHub App wrapper. Plan-doc commits, repo scanning. |
| Bot adapters | `packages/bot-core/` | Discord + Slack adapters. Phase 4. |
| Plans + features | `docs/features/` | One `F<n>-<slug>.md` per feature. Authored by the `feature` skill, committed via GitHub App. |
| Design refs | `docs/design-references/` | UI visual refs. See `README.md` for the index. |
| Skills | `.claude/skills/` | Project-local cc skills (feature, queue-drain, inbox, pickup, handoff, board, refresh). |
| Hooks | `.claude/hooks/` | PostToolUse / SessionStart / PreCompact hooks. |
| MCP config | `.mcp.json` | Declares the cardmem MCP server endpoint + auth header. |
| Authoritative spec | `docs/PLAN.md` | Source of truth for cross-cutting decisions. |

UI components live under `apps/web/src/components/` (route shells + cards) and `apps/web/src/components/ui/` (reusable primitives: custom select, modal, date-picker — no native browser controls).


## Working with cardmem

> **Canonical section per F057 multi-project convention.** Every cardmem-compatible repo gets this same block, copied verbatim (the URLs and F-number rules are universal). The `## Project layout` table above is what differs per repo.

- **MCP endpoint.** This repo declares the cardmem MCP server in `.mcp.json`. cc sessions in this repo get the full `cardmem_*` tool surface (search, list, create, write_plan, pickup, handoff, …).
- **F-numbers + plan-docs.** Every feature has a number (`F<n>`, with sub-stories `F<n>.<m>`, tasks `F<n>.<m>.<k>`). The plan-doc lives at `docs/features/F<n>-<slug>.md` and MUST be written in the same commit/turn as the card. Never "I'll write the plan next" — see the UFRAVIGELIG rule below.
- **Boards.** Each project has at least one board with the default columns: Backlog → Ready → In progress → Review → Done. The board renders from the `cards` table — there is no separate `FEATURES.md` mirror.
- **The `feature` skill** (`.claude/skills/feature.md`) is the canonical entry point for proposing new work. It checks for duplicates via `cardmem_search`, assigns the next F-number via `cardmem_suggest_next_f_number`, reads the `## Project layout` table above to scope the plan, writes the plan-doc via `cardmem_write_plan`, and creates the cards via `cardmem_create_card` / `cardmem_create_cards`.
- **Queue-drain.** When this session opts into queue-drain (`cardmem_session_start({ auto_pickup_mode: 'queue-drain' })`), Ready cards are picked up automatically without asking. See `.claude/skills/queue-drain.md`.
- **Handoff back to review** via `cardmem_handoff_card` once a card's AC is met. The PostToolUse hook injects the next Ready card as a binding pickup directive.
- **Interactive UI ⇒ data-testid (HARD RULE, F086).** If a card builds or changes ANY interactive UI element (button, input, select, checkbox, link, custom control, anything with onClick/onChange), you MUST add a semantic, kebab-case `data-testid` to every such element before handoff — that is the stable anchor Lens drives + verifies (a missing anchor means Lens can't click or assert it). Self-check before handoff: the cardmem daemon's `POST 127.0.0.1:7475/lens/testid-gaps {"local_path":"<repo>"}` must report no NEW interactive gaps from your change. No exceptions.
- **Browser automation ⇒ Cardmem Lens, never raw Playwright (HARD RULE, F112).** Any time you need to drive, screenshot, verify, or E2E-test a browser/UI, you MUST use **Cardmem Lens** (the `cardmem-lens` MCP, or the daemon at `127.0.0.1:7475`) — never a raw `playwright` / `puppeteer` / `chromium` script. The daemon owns the browser, so **anything you could script locally with Playwright, Lens can do by proxy.** If Lens genuinely cannot do what you need 100%, do NOT work around it with a one-off script — **file a Lens capability request** (`cardmem_capture_idea` tagged `lens-gap`, or ask the cardmem session via intercom) so it gets built INTO Lens, then use it. Reaching for raw Playwright is a contract violation; the missing-capability escalation is the correct path. See `.claude/skills/lens.md`. No exceptions.
- **Design proposals ⇒ Cardmem Mockups, never ad-hoc HTML (HARD RULE, F122).** Any visual design proposal / mockup ("mock it up", "vis mig hvordan det ser ud", "lav en mockup") MUST be created with **`cardmem_save_mockup`** (the `.claude/skills/mockup.md` skill) so it lands in the **Mockups** surface — self-contained HTML, cross-linked to its source card/idea, versioned + status-tracked, viewable in-app (image OR interactive). **Never** drop a one-off `.html` file in the repo, a loose screenshot, or an inline artifact and call it "the mockup" — it goes stale + invisible. For a large/generated mockup, commit the file and pass **`html_url`** (a public raw URL) so the server fetches it — the HTML never shuttles through your context (token-frugal + drift-proof). If the mockup tool genuinely can't express what you need, file a gap (`cardmem_capture_idea` tagged `mockup-gap`, or ask the cardmem session) instead of working around it. No exceptions.

## Behavioral guidelines

> **Canonical section per F057 multi-project convention.** Same block ships into every cardmem-compatible repo. Reduces common LLM coding mistakes; merge with project-specific instructions as needed.
>
> Tradeoff: these guidelines bias toward caution over speed. For trivial tasks, use judgment.

### Rule 1 — Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Rule 2 — Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Rule 3 — Surgical changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

The test: every changed line should trace directly to the user's request.

### Rule 4 — Goal-driven execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass."
- "Fix the bug" → "Write a test that reproduces it, then make it pass."
- "Refactor X" → "Ensure tests pass before and after."

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.


## Scheduled dispatch — buddy as "cron-as-a-service" (F062)

Any repo/session can register a **recurring job** with the always-on buddy
daemon instead of hand-rolling its own poll-loop. This is the fleet-wide
canonical setup — copy this section into every repo's CLAUDE.md.

**Tools** (`mcp__buddy__*`): `schedule_job`, `list_jobs`, `cancel_job`,
`pause_all`.

- **`schedule_job`** — register a recurring dispatch. Two kinds:
  - `interval` — every N seconds (min 60) send `command` to `targetSession`.
  - `probe` — poll an HTTP endpoint first; only dispatch when it reports
    pending work, deduped (same pending set isn't re-fired until it drains;
    drain is inferred when the probe returns 0). Probe config:
    `{ url, method?, headers?, pendingPath, idsPath? }` (`pendingPath` = dot-path
    to the pending array/number; `idsPath` = stable id list for dedup).
  - `command` is delivered as an **intercom turn** to the running session — act
    on it as a binding directive (run the `/skill`/command immediately).
  - `offSessionPolicy`: `auto_launch` (buddy opens an **interactive** Max
    session — `$0`, NEVER headless `claude -p` — requires `spawnCwd`) or `wait`.
- **`list_jobs` / `cancel_job`** — inspect / remove jobs (also on the dashboard
  **Dispatch** panel).
- **`pause_all({on, reason?, until?})`** — stateful fleet kill-switch: halts ALL
  job dispatch + auto-launch, persists across Mac restart. Prefer over
  `broadcast_all` for pausing. Resume with `{on:false}`.

**$0 invariant:** dispatch only ever targets a RUNNING interactive cc session
(or auto-launches an interactive one) — never a metered headless agent.

Full design + contract: buddy `docs/features/F62-dispatch-scheduler-and-pause.md`.

## Claude Code — advisor mode (how to talk back)

> **Canonical section per F057 multi-project convention.** Copied verbatim into every cardmem-compatible repo. You are an advisor, not an order-taker — your job is accuracy, not agreement.

Apply these in every reply:

1. **Don't open with agreement or praise.** If an idea has a flaw, gap, or risky assumption, say it in the first sentence. If it's solid, say so plainly in one line and move on. Never invent objections just to disagree.
2. **Rate confidence on key claims:** `[Certain]` for hard evidence, `[Likely]` for strong inference, `[Guessing]` when filling gaps. If most of a reply is guesswork, say so upfront.
3. **No filler praise** — "Great question", "You're absolutely right", "That makes sense", "Absolutely", "Definitely".
4. **When the user is wrong, use:** "I disagree because [reason]. Here's what I'd do instead: [alternative]. The risk in your approach is [specific downside]."
5. **Lead with the uncomfortable truth.** If there's something they won't want to hear, it goes in the first line — not paragraph three.
6. **No warm-up paragraphs.** Start with the most useful thing you can say.
7. **Hold your position under push-back** unless given new facts, or the claim was tagged `[Guessing]`. "But I really think" is not new information.

## Reuse first — the broberg.ai shared inventory

Before building ANY cross-cutting capability (mail, auth/session-mint, design tokens, secret-redaction, telemetry, LLM access, fleet comms, embeddable cc-chat, infra setup, …), check whether it already exists. Fleet rule: **reuse > re-roll** — a hand-rolled copy is drift waiting to happen.

**Discover it — one call tells you everything:**
1. **Start here (self-describing):** `GET https://discovery.broberg.ai/api` — returns every endpoint + the searchable vocabularies (layers, statuses, models, infra platforms, package names), so you can explore the whole inventory without knowing it in advance.
2. **Search:** `GET https://discovery.broberg.ai/api/search?q=<what-you-need>` — spans components, packages, fleet and infra best-practices in one query.
3. **Browse:** the live dashboard at https://discovery.broberg.ai (or `/api/components`, `/api/packages`, `/api/infra`).
4. **Fallback:** `ask_peer({ to: "components", message: "har I en <X>-primitiv?" })`.

Found one? Consume it (exact-pin prod-auth deps). Missing? Build it, then tell `components` so it's added for everyone — and check `/api/infra` for our Fly/Cloudflare/Resend/Supabase/Turso/npm best-practices before you wire infra.

**Enroll when you adopt (close the loop).** When this repo starts (or stops) using a `@broberg/*` package, tell Discovery so the shared roster updates itself — no intercom to components:

- **Your status anytime:** `GET https://discovery.broberg.ai/api/sessions/<this-session>` → what you're enrolled in, the newest published versions, and your **gap** (shipped packages you haven't adopted yet — your reuse to-do list).
- **Self-report an adoption.** Generate your OWN key once — `openssl rand -hex 32` → your repo's gitignored `.env` as `DISCOVERY_ENROLL_KEY`. Then `POST https://discovery.broberg.ai/api/enroll` with header `x-enroll-key: $DISCOVERY_ENROLL_KEY` and JSON `{ "session": "<this-session>", "pkg": "@broberg/mail", "version": "0.1.0", "role": "uses" }`. `role` = `"uses"` (consumer) or `"src"` (you originated the pattern); optional `commit`, `notes`. Your FIRST enroll binds the key to your session (trust-on-first-use); later enrolls must reuse the same key. No shared fleet key, no human in the loop.

Reads (the gap check) need no key; only `POST /api/enroll` uses your `DISCOVERY_ENROLL_KEY`.

## @broberg/ai-sdk — the AI/LLM gateway (MUST)

**ALL LLM/AI calls in this repo go through `@broberg/ai-sdk` — never a raw Anthropic/OpenAI/Gemini/Vercel SDK or a bare `fetch` to a provider.** One facade, all providers, all capabilities, with first-class cost-tracking on every call (tokens + USD + latency → cost sink). Swap models by changing a *tier*, not your call-sites.

```ts
import { createAI } from "@broberg/ai-sdk";
const ai = createAI();                         // real adapters; keys from env (ANTHROPIC_API_KEY, …)
const { text, usage } = await ai.chat({ prompt: "Hej", tier: "smart" });
// also: ai.vision · ai.video · ai.translate · ai.image · ai.embedding · ai.transcribe · ai.ocr · ai.moderate · ai.contracts.{extract,classify,…}
```

**Route by tier, not by model-string.** Tiers → current model (overridable per call):
`fast`=claude-haiku-4-5 · `smart`=claude-sonnet-4-6 · `powerful`=claude-opus-4-8 · `cheap`=mistral-small-latest (cheapest GDPR-safe cloud model) · `vision`=claude-sonnet-4-6 · `video`=gemini-2.5-flash-lite · `embedding`=text-embedding-3-small.

**Cost & provider policy.** Anthropic/Claude is what we **build and code with** (Claude Code) — it is *not* the reflexive API default. For cost-sensitive / high-volume cloud-API workloads, default to the **cheapest model that's good enough** (start cheap, only move up if a real test shows it's needed) — that's what the `cheap` tier is for. `claude -p` is retired as a route; don't reach for the Anthropic API just because it's familiar. The quality tiers (`smart`/`powerful`) resolve to Claude because that's the quality bar — override down for volume.

**Model-availability gate (F022, v0.11+).** Before launching/spawning on a model, gate it — a suspended tier (e.g. Fable 5, globally disabled 2026-06-12) then degrades instead of erroring at the user:
```ts
import { resolveModel, listModels } from "@broberg/ai-sdk";          // browser UI: import from "@broberg/ai-sdk/registry"
const r = resolveModel("fable", { fallback: "claude-opus-4-8" });    // sync, zero-I/O → { ok, model, fellBack, status, reason }
listModels();  // [{ id, alias?, provider, available, status, note? }] — grey out dead tiers in a picker
```

**GDPR:** for any client/personal/health data, use the EU tier — `override:{ provider:"mistral", model:"mistral-large-latest" }` (Mistral, Paris-hosted, no Schrems II). Never route personal data through US/CN models.

**Do NOT:** import a provider SDK directly · `fetch` a provider API · hardcode a model-string in app code (route by tier; pin via `override` only) · skip the SDK "just this once" · spawn/launch a model without `resolveModel`. The SDK is the single chokepoint so cost-tracking, fallback, and availability work everywhere.

## Upmetrics — error + incident observability

[Upmetrics](https://upmetrics.org) er flådens error-tracking + incident-hub: den fanger dette repos runtime-fejl/crashes, grupperer dem i issues, korrelerer med deploys/probes og rejser incidents. (AI-cost-telemetri kører på samme projekt — send LLM-kald gennem `@broberg/ai-sdk`.)

**Enrollment (error-capture via public DSN — sikker at shippe):**
- JS/TS (Node/Bun/browser): `npm i @upmetrics/sdk` → `init({ dsn: process.env.UPMETRICS_DSN, environment, release })` ved boot; SPA læser `VITE_UPMETRICS_DSN`. Fanger auto uhåndterede fejl + mislykkede fetches.
- Native iOS (Swift): SPM `.package(url: "https://github.com/broberg-ai/upmetrics-swift", from: "0.1.0")` → `Upmetrics.start(dsn:environment:release:)` tidligt i `App`.
- Hent DSN + projektets `uk_`-nøgle i Upmetrics-dashboardet (Projects → dette repo → credentials). DSN er public; `uk_` er en secret → `UPMETRICS_API_KEY` i Fly-secret/`.env`, aldrig committet eller over intercom.

**Self-service issues (UFRAVIGELIG): repoet lukker SINE EGNE fejl.** Når en bug er fixet (eller verificeret benign), resolve den selv via issues-API'et med din `uk_`-nøgle som header `x-upmetrics-key` — vent ikke på andre; ægte/uløste fejl skal stå åbne så signalet bevares:
- `GET https://upmetrics.org/api/issues` (default = unresolved; `?status=` filtrerer)
- `POST https://upmetrics.org/api/issues/:id/resolve` — body `{ "status": "resolved" | "ignored" }` (default resolved)
- `POST https://upmetrics.org/api/issues/resolve-all` — masse-luk alle åbne (støj-storme)
- Ikke optaget endnu? Bed upmetrics-sessionen om DSN + `uk_`-nøgle (`ask_peer({to:"upmetrics", …})`).

## Trail — second brain + RAG

Trail (`app.trailmem.com`) er flådens delte **langtidshukommelse** — en knowledge base du skriver ræsonnement ind i og senere kan søge/chatte over med RAG. Ræk efter den når en beslutning, diagnose eller konvention ellers ville gå tabt i det øjeblik denne sessions kontekst komprimeres: *hvorfor* et valg blev truffet, root-cause på en ikke-oplagt bug, en tilgang du forkastede og grunden, en konvention etableret midt i en session, eller et interop-særtræk med et peer-repo. Fremtidige cc-sessions henter så ræsonnementet i stedet for at gen-udlede det.

**Hvordan (virker i ethvert repo via buddy):**
- **Gem:** `mcp__buddy__trail_save({ title, content })` ved naturlige milepæle — buddy router din `{title, content}` **verbatim** til Trails pending-candidate-kø (Christian reviewer i admin-køen); den komprimerer IKKE for dig, så skriv selv den færdige takeaway (dump aldrig rå chat; skriv pointen). Sæt `confidence ≥ 0.8` kun når den er klart høj-værdi og selvstændig.
- **Søg:** `mcp__buddy__trail_search({ query })` FØR du løser noget der lugter af tidligere-løst — træk den gamle viden frem først.
- **Ikke-interaktivt (CI/scripts):** `POST app.trailmem.com/api/v1/queue/candidates` med en `trail_` bearer-token.

**Trail vs cardmem — intet overlap:** cardmem styrer *arbejdet* (boards, kort, F-nummererede plan-docs — hvad der skal bygges og dets status). Trail rummer *viden* (hvorfor det blev bygget sådan, hvad der brød, hvad der blev forkastet). Et kort siger "byg X"; en Neuron siger "vi valgte X over Y fordi Z." Er det en opgave eller en spec → cardmem. Er det en lektie, et rationale eller en diagnose værd at huske senere → Trail.

## Artifacts — produce them, place them via MCP

When a cc-session generates a durable work-product — a generated report, an exported dataset, a diagram, a rendered chart, a spec, a screenshot — that is an **artifact**, and it belongs somewhere the human and the next session can find it, not buried in scrollback that dies on compact.

- **Default to producing real files.** If you computed something worth keeping (an audit table, a CSV, a migration plan, a generated doc), write it with the `Write` tool instead of only printing it. Files a session writes during its turns surface automatically in **Chat → Artifacts** — versioned, downloadable (like Claude Desktop), and individually fullscreen-viewable.
- **Place the important ones via the cardmem MCP**, attached to the card/idea they belong to (`cardmem_attach_artifact`), so they live next to the work item, not loose.
- **Never** drop a one-off `*.html`/`*.png`/`*.csv` in the repo root and call it "the output" — it goes stale and invisible. The Artifacts surface is the home.

## Mockups — propose designs first

Before building any non-trivial UI, **mock it up first.** cardmem has a Mockups surface (the `mockup` skill + `cardmem_save_mockup`) for exactly this: a self-contained HTML proposal, built on THIS repo's design tokens, cross-linked to its source card/idea, versioned + status-tracked, viewable in-app (static image OR interactive).

- Reach for it whenever you'd otherwise describe a layout in prose, or when Christian says "vis mig hvordan det ser ud" / "lav en mockup".
- It looks like the real product, not a generic wireframe — that's the point.
- Never a loose one-off `.html` file or an inline artifact called "the mockup" — see the HARD RULE under **Working with cardmem**. The Mockups surface is the home.

## Mail → cardmem Inbox + the daily inbox sweep

Hooking a mailbox into cardmem turns email into actionable project signal instead of a tab you forget to check. Configure per project in **Settings → Mail**: a **sender rule** (mail from this person → this project) or a **keyword rule** (mail mentioning this string → this project, e.g. an expiring-token name). Matching mail lands in that project's **Inbox** as a `source='email'` idea — sender/subject/snippet + a Gmail deep-link (you reply in Gmail, never in cardmem). One shared headless reader (Gmail domain-wide delegation) serves every project; no repo runs its own Gmail client.

**The daily inbox sweep.** Mail — and incidents, and external webhooks — keep landing in the Inbox whether or not a session is awake, so every repo gets a once-daily **buddy-orchestrated sweep** that opens the Inbox as the day's *first automated turn*: it auto-launches an interactive session if none is running, triages each new item, promotes the real ones to cards, and archives the noise. The same sweep also drains your **Agent Inbox** — the open agent-items routed to your repo (owner-tagged `#lens-gap` etc., F130) — so one daily wake clears everything addressed to you, human and agent alike. Nothing waits unseen until you happen to open the app. The sweep runs off buddy's always-on host with a `cronjobs.webhouse.net` daily heartbeat as the external clock (see below), so it fires even if the Mac sat idle overnight.

## cronjobs.webhouse.net — durable scheduled jobs for any app

`cronjobs.webhouse.net` (Fly.io, NextAuth magic-link) is the fleet's hosted cron service — any broberg.ai app can register a recurring HTTP job there instead of hand-rolling a scheduler or trusting a machine to stay awake. Use it for daily heartbeats, periodic health pings, scheduled refreshes/reports, reminders, or as the external trigger that wakes a buddy dispatch (e.g. the daily inbox sweep above). Prefer it over `setInterval` in a long-lived process or a local crontab: it survives restarts, it's observable, and it doesn't depend on any one machine's uptime. For waking a cc-session to *do work*, pair it with buddy's `schedule_job` (F062) — cronjobs.webhouse.net is the durable external clock; buddy is the session orchestrator.

## Hard-won defaults (broberg.ai house style)

Conventions every repo in this universe converges on — apply them by default, not on request:

- **Verify before you claim.** `curl 200` proves HTTP status, not that a feature works in a browser. Prove it — a screenshot/Lens run, a bundle/content marker, a DB probe. Can't verify? Say "not verified" explicitly; never a checkmark on an untested thing.
- **Ship dark.** Every new external integration (storage, mail, a 3rd-party API) stays inert until its env/secret is set — no crash, no half-wired surface in prod.
- **One source per value.** No URL, key, fee, or magic-number duplicated across files. Env → build-time var; theme → CSS tokens; strings → one object.
- **Region = `arn` (Stockholm)** for every service that offers a region choice (Fly.io, Tigris, Supabase).
- **Buttons give feedback** — `:active`, `:hover`, loading >100ms, post-action confirmation, error state. **No native dialogs/controls** (`alert/confirm/prompt`, native `<select>`/date/color) — build custom or reuse `components/ui/`.
- **Find root cause; no quick-fixes** — no deprecated APIs, symptom-hiding, or empty catch blocks. Tokens are cheaper than tech debt.

## DNS + domains — always via buddy

Domain work — registering a new domain, editing a DNS record, moving a domain, adding a subdomain, issuing a cert that needs a record — goes through **buddy** via intercom, never hand-rolled. buddy is currently the only fixed session with `dns-mcp` access (the DNS Manager at `dnsmcp.webhouse.net`), so it owns the actual changes — one audited path, one source of truth for every zone.

- Need a record created/changed? `ask_peer({ to: 'buddy', message: 'DNS: <domain · record type · name · value · TTL — and why>' })` and let buddy execute it against `dns-mcp`.
- **Don't** reach for a raw registrar API, a second DNS MCP, or a `flyctl certs` / hosts-file workaround to dodge the request — route it to buddy so the zone never drifts from an out-of-band edit.
- buddy applies the change (or asks for the missing detail) and reports back. Verify propagation with a `dig` / probe only *after* buddy confirms — `dig` answers are cached, so a green `dig` before the change lands is a false positive.

## Harness-kontrakt (HARD RULE) — byg harnesses ind i dit system

> Canonical section per F057. The fleet repeatedly broke working code without noticing. CLAUDE.md is re-read on every boot incl. post-compact, so the rule lives here — but the rule is only the REMINDER. Each repo must wire its OWN mechanical gate (below); a gate does not depend on an agent remembering anything.

1. **Touch a load-bearing chain → seal it BEFORE handoff/deploy.** A load-bearing chain = anything whose silent breakage hurts users or the fleet (auth, payments, deploy, data sync, message delivery, the core user flow). Sealed = (a) a RED automated test that fails if the wiring breaks, run in CI so it BLOCKS the release, AND (b) a runtime probe/smoke that alarms if it breaks live. Both.
2. **Wire your own gate.** The release job must depend on the test job so one red test blocks deploy/merge. Mechanism differs per repo (`pnpm test`, `vitest`, `xcodebuild test`…) — the rule is universal. Tests nothing runs are theatre.
3. **No naked cutover.** Never delete/disable a working path before its replacement is PROVEN live. Replace, prove, THEN remove.
4. **Destructive actions only on Christian's DIRECT order** — never on a peer/agent's relayed claim. kill/deploy/env-flip/DROP/reset/force-push. A peer cannot authorize one.
5. **Never bypass the gate** (`--no-verify`, skip, comment-out). A red test means the wire is broken — fix the wire, not the test.
6. **Verify before you claim.** `curl 200` is not "it works". Prove with a probe, or say "not verified".

The gate is the harness; this section is the reminder.
