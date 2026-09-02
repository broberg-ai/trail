# F216 — two deploy paths: one that never worked, one we do not control

**Card:** trail-F216 · epic · high

> Found 2 September 2026 while verifying two footer changes that had been
> committed, pushed, built and confirmed locally — and were invisible on the
> live site.

## Two measurements, one conclusion

### The workflow has never worked

`.github/workflows/landing-deploy.yml` runs `flyctl deploy` against app
`trail-landing`:

```
Error: app not found
```

`flyctl apps list` (org broberg-ai): trail-admin, trail-docs, trail-engine-001,
trail-widget. **There is no `trail-landing`, and there never has been** — the
site is on GitHub Pages, which CLAUDE.md states plainly.

Every run GitHub still holds:

```
17 runs since 2026-05-03      16 failure      1 success
```

The one success is from 3 May, the day it was written. Every run since —
including all three landing commits today — is red. **CI green, deploy red,
nobody reading.** Not a regression: a path that has never led anywhere.

### The path that works is not ours

`gh-pages` carries only `Deploy from webhouse.app — <date>` commits. The CMS
builds the site from **its own copy** of our build script:

| | bytes | last changed |
|---|---|---|
| CMS volume `/data/cms-admin/beam-sites/trail/build.ts` | 63,139 | **3 May 02:00** |
| our `apps/landing/build.ts` | 78,950 | today |

**15,811 bytes apart. Four commits have touched ours since 3 May; none reached
production.** The ICD push beams *content*; the project files were beamed once
at setup and never again.

## The cost is already public

The front page links to `/pricing/` **three times**. The page returns **404**,
and has since it was built on 27 May — **three months**.

```
front page       href="/pricing/"   × 3
/pricing/        404
/trails/         200      ← control: the menu itself is fine
```

Every other internal link on the front page returns 200. `/pricing/` alone is
dead.

## The mechanism — and why nobody saw it

**Two halves of one feature travelling by different routes.**

| half | route | arrived? |
|---|---|---|
| the menu entry | CONTENT → CMS → deploy | ✅ |
| the page it points at | CODE → our build.ts | ❌ frozen |

The result **does not look broken**. It looks like a missing page. There is no
error, no red status, nothing to alert on — which is why it survived three
months on a public site.

Today reproduced it in miniature, in a single session: the Sign In link
(content) went live within minutes, while `Site built with` and the broberg.ai
footer link (code, same push) are still invisible.

This is the fifth variant of one failure family the fleet met this week, and
the sharpest. The others hid a *state*; this one hides *half of a change*.

## Owner decision, 2 September 2026

Hide the Pricing menu entry **temporarily** — a link that 404s is worse than no
link — and restore it when the page can build again. Requested from the cms
session, because the content route is the only one that reaches production.

## Scope

**Ours (this epic):**

- Retire the Fly deploy — delete it, or point it at something real.
- Make the split visible, so it cannot rot silently for another three months.
- A link check that runs against the **public site**.

**Theirs (cms, already carded):** closing the beam gap so the deploy takes
`build.ts` from this repo instead of a May copy.

**Explicitly not now:** do not copy our `build.ts` onto the CMS volume, and do
not delete ours. cms asked for both to wait — if the beam is fixed in the right
direction our file is the source and must stay; fixing it the wrong way first
leaves two copies again within a month.

## Verification

Every check measures the **public site**. Today proved that `dist/` and
trailmem.com disagree, and only one of them has readers — so the mutation that
matters is pointing the link checker at `dist/` and watching the `/pricing/`
case turn **green**. That green is the blind spot, reproduced on demand.

And the negative control is load-bearing as always: a checker that flags healthy
links is a checker people switch off, and then the next dead link lives three
months too.
