---
name: trail
description: >-
  GENERATED SEED — extracted from apps/admin/src/index.css. Correct it; do not assume it is right.
colors:
  bg: "#FAF9F5"
  bg-card: "#FFFFFF"
  bg-sunk: "#F4F2EB"
  fg: "#1A1715"
  fg-muted: "rgba(26, 23, 21, 0.70)"
  fg-subtle: "rgba(26, 23, 21, 0.40)"
  fg-faint: "rgba(26, 23, 21, 0.20)"
  border: "rgba(26, 23, 21, 0.10)"
  border-strong: "rgba(26, 23, 21, 0.20)"
  accent: "#E8A87C"
  accent-soft: "rgba(232, 168, 124, 0.16)"
  accent-fg: "#1A1715"
  danger: "#C2410C"
  success: "#15803D"
  hover: "rgba(26, 23, 21, 0.04)"
  active: "rgba(26, 23, 21, 0.08)"
  logo-outer: "#1A1715"
  graph-node: "#1a1715"
  graph-accent: "#e8a87c"
rounded:
  sm: "6px"
  DEFAULT: "8px"
  lg: "12px"
  xl: "16px"
---
## This file was generated, and it is a starting point

Every value above was read out of `apps/admin/src/index.css` — 19 colour(s) and 4 radius token(s). Nothing here was chosen; it is a description of what this repo already looks like, written
down so there is something to correct.

**What to do with it.** Read the palette and delete what is not really part of it — a generated
list cannot tell a brand colour from a one-off. Then write the parts a stylesheet cannot know:
what the page shell is, which header a new route uses, whether buttons are round or square, and
which of these colours means "action" as opposed to "we happened to use it once".

**What this seed does NOT contain.** The extractor is a heuristic — which declarations
in a stylesheet are *tokens* is a judgement, not a fact — so it reports its own misses rather
than letting them read as absences. These are still in your stylesheet and still work:

- **2** · value is neither a colour nor a length this extractor can express (--graph-line, --graph-accent-line)
- **4** · shadow — DESIGN.md has no shadow namespace yet (--shadow-sm, --shadow-md, --shadow-lg, --shadow-xl)
- **2** · motion — DESIGN.md has no motion namespace yet (--ease, --dur)
- **3** · font family — DESIGN.md has no fontFamily namespace yet (--font-sans, --font-mono, --font-serif)

A seed silent about this would look complete, and the next reader would conclude the project
has no shadows rather than that nobody extracted them.

**We picked this file, and we might have picked wrong.** 3 other stylesheet(s) in
this repo also declare colours: docs/design/trail_app/src/styles.css (17 colours), apps/onboarding/src/styles.css (19 colours), apps/docs/public/styles.css (15 colours). If one of those is the real design
system, point this file at it and re-run — the choice is a judgement, and you are the only one
who can settle it.

## Why this file matters

`DESIGN.md` is the source a cardmem session is handed at start-up, so a rule written here reaches
the next agent without anyone remembering to open a file. It is also what the drift lint measures
against: a raw colour used where a token above exists becomes a finding rather than a
conversation with the owner.

## Overview

_Replace this with what the product actually looks like, in a sentence or two._

## Anti-patterns

*Applies to every change — these are not per-surface preferences. Each one below has been
shipped, reported by the owner, and fixed; they are here because they came back.*

### The wiggle — the page must NEVER scroll sideways at phone width

Christian's name for it, and he has reported it four times. **Wide content — a table, a
code block, a diagram, a revealed secret — scrolls inside its own `overflow-x: auto`
container. The page body does not move.**

Two traps make it hard to see from a desk:

- **`documentElement.scrollWidth` cannot see it.** Measured on Settings → Secrets: it
  read 393 on a 393px viewport while the content was 588px wide. Assert on element
  right-edges versus `innerWidth`, or on `max(documentElement.scrollWidth, body.scrollWidth)`.
- **A `width: 100%` table cannot shrink below its content's min-width.** One
  `white-space: nowrap` cell therefore sets the width of the whole page.

**What is mechanically checked, and what is not — the half worth knowing.** The Lens DOM
critic raises a `wiggle` finding (severity high, one per run, naming the widest offender)
on any capture at ≤820px **that passes `critic: "dom"`**. A high finding folds the F095
gate to fail, and the auto-review skill passes the critic on every verify — so a card
going THROUGH the gate is covered. **A `lens_capture` you write by hand is not**, because
the daemon's critic default is `off`. Content inside a deliberate horizontal scroller is
not flagged.

So: verify every new surface with a Lens run at phone width **and pass the critic**. Then
the gate tells you instead of the owner's thumb.

### A button label never wraps to a second line

Add `white-space: nowrap`. If it still does not fit, shorten the label — never let it
break. The portal's "Afslut preview" wrapping to two lines is the reported case; it reads
as broken, not as tight.

### No native dialog, and no native form control

`window.alert` / `confirm` / `prompt`, `<select>`, `<input type="date">`, `type="color"`,
`type="range"`. They ignore every token on this page, break dark mode, and render in the
OS's style rather than the product's. Reuse `components/ui/` or build it there. The one
exception is `beforeunload`, which the browser owns.
