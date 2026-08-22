# F206 — E2E test setup + a CI gate that actually blocks

**Status:** in progress · asked for 2026-08-22

## Why now

Two facts, measured today:

```
find apps packages -name '*.test.ts'   →  7 files
pnpm test                              →  5 tasks, 5 successful, 17.1s   (GREEN)
ls .github/workflows/                  →  build-context-audit, docs-deploy,
                                          landing-deploy, widget-deploy,
                                          fly-token-health
                                          — nothing runs the tests
```

So the tests exist, they pass, and **nothing enforces them.** The repo's own
CLAUDE.md states the rule this violates:

> *"Wire your own gate. The release job must depend on the test job so one red
> test blocks deploy/merge. Tests nothing runs are theatre."*

The trigger is F205.1, which just added an **auth boundary** — a partner key
that must be refused on search, on Neuron reads, on key minting, and on other
knowledge bases. That is precisely a load-bearing chain whose silent breakage
hurts someone: a future refactor that widens partner access would look exactly
like a passing build.

Turning the gate on is unusually cheap right now because the suite is already
green. That will not stay true; the longer this waits, the more likely the
first red is somebody else's.

## Scope

**F206.1 — a reusable E2E harness.**
`verify-f205-partner-scope.ts` hand-rolled a temp database, migrations, a
tenant, a user, two knowledge bases, a legacy key and an app boot before it
could assert anything. That is ~40 lines of setup standing between a developer
and their first assertion, and it is the reason the next E2E test does not get
written. The harness returns `{ app, trail, seed, mintKey, cleanup }` so a new
test starts at the assertion.

End-to-end here means **the real thing**: `createApp()`, the real router, the
real `requireAuth`, real migrations, real SQL. Nothing about the auth
middleware is mocked — a mocked auth test would have passed happily against
the master-key bug F205.1 exists to remove.

**F206.2 — the gate.**
A CI workflow runs `pnpm typecheck` + `pnpm test` on every push to `main` and
every pull request, and the three deploy workflows depend on it.

## Design notes

**Why `bun test` and not a new framework.** `packages/db`, `packages/shared`
and `packages/ambient-gate` already run `bun test` through `turbo run test`.
Adding vitest/jest would mean two runners, two configs and two ways to be
green. The harness is a plain module; the tests are plain `bun test` files.

**Why the deploy workflows must depend on the test job, not just "CI exists".**
A separate green-or-red CI run that nobody has wired to anything is the same
theatre in a new costume — see F204, where three months of red carried no
information because nothing depended on it. The deploy jobs run the tests
first and deploy only on success.

**Why frozen-lockfile.** A green run must describe the dependency set we
committed. `pnpm install` without `--frozen-lockfile` can resolve something
newer than the lockfile and report green for a tree that does not exist in
the repo.

**Mutation-checking is part of the deliverable, not a nicety.** Every AC below
that asserts "the test catches X" is only satisfied by breaking X and watching
it go red. A test that cannot fail is indistinguishable from no test, and this
epic exists precisely because we have been fooled by signals that could not
fail in the direction that mattered.

## Non-goals

- Backfilling E2E coverage across the whole API. This lands the harness and
  one real consumer of it (F205.1's assertions). Coverage grows per feature.
- Browser/UI end-to-end. That is Cardmem Lens's job (F112) and stays there.
- A staging environment or ephemeral deploy previews.
- Turning the gate into a required GitHub branch-protection rule — that is a
  repo-settings change and belongs to its own decision.

## Verification

- `pnpm test` picks up the new test file and stays green.
- Breaking the partner gate open makes it go **red under `pnpm test`**, not
  merely under the standalone script.
- The CI workflow's newest run on `main` is green, read back with
  `gh run list` rather than assumed from the YAML being valid.
- A deliberately failing test on a branch blocks the deploy job — observed,
  then reverted.

## Dependencies

None. `bun` is already the runner; `turbo run test` already exists.

## Breakdown

- **F206.1** — Reusable E2E harness + the F205 probe rewritten on top of it
- **F206.2** — CI gate: typecheck + test on push/PR, deploys depend on it
