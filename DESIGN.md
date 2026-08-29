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
