# F203 — Landing has a dead Fly deploy path (CI red on every run since May)

**Status:** backlog · found 2026-08-19

## Open question (decide before doing the work)

**Does trailmem.com's landing stay on GitHub Pages, or move to Fly?**

This is Christian's call, not a technical toss-up — it decides which half of
the repo gets deleted. Everything below is written so either answer is one
small commit away. Nothing should be deleted before the answer is given.

## What was found

While answering components' questions about F196 (deploy self-reporting), the
landing deploy path turned out to be two contradictory stories living in the
same repo.

Measured:

```
curl -sI https://trailmem.com          → server: GitHub.com   (Pages serves the live site)
flyctl apps list | grep trail          → trail-admin, trail-docs, trail-engine-001,
                                          trail-widget (suspended)
                                          — NO trail-landing app exists
apps/landing/fly.toml:5                → app = "trail-landing"
.github/workflows/landing-deploy.yml   → runs `flyctl deploy` against it

gh run list --workflow=landing-deploy.yml
  failure  2026-06-09  37s
  failure  2026-05-27  36s
  failure  2026-05-27  33s
```

So: the workflow has failed on **every run since at least 27 May** — three
months — because it deploys to a Fly app that does not exist. The live site is
fine; GitHub Pages serves it, exactly as this repo's CLAUDE.md HARD RULE says
it should.

## Why this matters more than the failing job itself

The site is not down, so the instinct is to shrug. Two reasons not to:

1. **A permanently-red signal hides a real one.** Every future landing failure
   lands in a list that is already red, next to three months of red. Nobody
   will look. The value of CI is the *change* from green to red, and that
   change has already been spent.
2. **The repo contradicts itself.** CLAUDE.md states landing is GitHub Pages
   and that content must be authored via webhouse.app. `fly.toml` and the
   workflow say it is a Fly app. A future session reading the repo will pick
   whichever half it reads first — and the HARD RULE about *not* writing
   landing content locally exists precisely because that guess went wrong
   before.

## Scope

**In:** make the repo tell one story about how landing ships, and leave no
permanently-red workflow behind.

- **If Pages wins (expected):** delete `apps/landing/fly.toml` and
  `.github/workflows/landing-deploy.yml`; confirm nothing else references a
  `trail-landing` Fly app; confirm the Pages publish path is what actually
  updates the site.
- **If Fly wins:** create `trail-landing` in org `broberg-ai`, region `arn`
  (per the Trail Fly deployment policy), point DNS, and update the CLAUDE.md
  landing HARD RULE so the documented architecture matches reality.

**Non-goals:**

- The F196 deploy self-report work. Related only in that it surfaced this;
  the GIT_SHA fix belongs to F196.3.
- `trail-widget` being suspended — separate question, separate decision.
- Any change to how landing *content* is authored. That HARD RULE stands
  either way.

## Verification

A green build is not proof the site updates — that is the same mistake in a
new coat. The story's AC therefore requires an end-to-end check: change
something in `apps/landing/`, ship it the sanctioned way, then **fetch
`https://trailmem.com` and find the new content in the response**. Only that
proves the pipeline the repo describes is the pipeline that runs.

## Breakdown

- **F203.1** — Resolve the landing deploy path and leave CI green (carries the
  acceptance criteria).

## Dependencies

None technically. Blocked only on the open question above.
