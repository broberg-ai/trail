# F209 — Ambient clips the article you are reading

**Owner:** trail · **Status:** **DROPPED 2026-08-23, same day it was planned.**
Cards archived (`trail-F209` + three stories). No code was written.

> **Christian, 2026-08-23:** *"Vi dropper den feature, vi har web clipper i
> browser, den er perfekt til det den skal."*
>
> **He is right, and the argument against it is in this document's own Phase 1
> section.** A server-side fetch has no session, so paywalls, internal wikis,
> Notion and mail all return a sign-in wall — and that is a large share of what
> anyone actually clips. The extension already solves exactly that by reading
> the DOM inside the user's authenticated browser, which no server can imitate.
> F209 Phase 1 would have shipped a second, weaker path to the same feature, and
> Phase 2 — the version that would have matched the extension — depends on a
> per-browser setting that is off by default.
>
> The gain was never extraction quality. It was avoiding a per-browser
> extension. That is a real cost, but it is paid once per browser and the Chrome
> one is already built and submitted.
>
> **Kept as a record so this is not re-proposed from scratch.** If it returns,
> the entry point is Phase 2 (ask the browser for its own rendered DOM over
> AppleScript), NOT Phase 1 — and the measurements below still hold:
> `ScreenWatcher` captures one frame of the frontmost window, and `FocusWatcher`
> reads the window title but not the URL.
>
> **Untouched by this decision:** clipping NON-browser surfaces — a PDF in
> Preview, a Figma board, a Slack thread — where there is no DOM and the
> extension can never reach. That stays as idea `01a02ea2`, unarchived, and it
> is a separate question from this one.

**Superseded status below — kept verbatim as it was written.**

**Original status:** planned, 2026-08-23
**Origin:** Christian, 2026-08-23 — *"Ambient Mac app, kan den ikke få integreret
Web Clipper funktionalitet også … vi har jo lavet det sådan at den kan aflæse
hvilken app og skærm vi er på."* Then, after the scope discussion:
*"du kan fortsætte med at løfte Ambient op til at kunne clippe en artikel i en
browser."*

Scope is the **browser** case only. The universal "clip any native app" idea
(PDF in Preview, Figma, Slack) stays in the backlog as idea `01a02ea2` — it is
a bigger decision because it widens F201.5's egress guarantee.

## The idea, and the part of it that does not work

The instinct is right and the payoff is large: **one app, every browser, no
store.** Safari, Chrome, Arc, Firefox, Orion — no extension per browser, no
review queue per browser, no three publishing pipelines. It sidesteps the whole
of F208.

The proposed mechanism does not work, and this was measured before planning:

- `ScreenWatcher` grabs **one frame of the frontmost window** and runs Vision
  OCR on it. An article is three or four screenfuls. OCR would deliver the
  visible third, with navigation, cookie banner and sidebar mixed into the body.
  The extension runs Readability across the whole DOM and returns the complete
  article. *"Use OCR to clip the page"* is strictly worse than what already
  ships.
- `FocusWatcher` (`kAXFocusedWindowAttribute` + `kAXTitleAttribute`) reads app
  name, bundle id and **window title**. It does **not** read the URL. That is
  the gap everything below depends on.

So Ambient must not *read* the page. It must identify **which page**, and let
something that can parse HTML do the parsing.

## Reuse

Checked against Discovery before writing this (F217), three queries —
`readability article extraction`, `html to markdown`, `url fetch scrape`:

- **No `@broberg/*` package does article extraction.** Nothing to adopt.
- `@broberg/lens-engine` (the Playwright capture engine behind cardmem-lens) is
  the only near-miss. It owns a real browser, which is the right instrument for
  a JS-rendered page — but it produces **screenshots**, not text. Recorded as a
  possible escalation for Phase 2's JS-heavy pages, not adopted now: pulling a
  browser engine into the ingest path for every clip is a large cost for a
  minority of pages.
- Trail's server has **no** URL fetcher today. `sourceUrl` in
  `apps/server/src/routes/uploads.ts` is metadata attached to an uploaded file;
  nothing fetches it. Readability exists only inside `apps/web-clipper`.

**Decision: build it, using the two libraries the extension already uses**
(`@mozilla/readability` + `turndown`), and extract the shared configuration into
a package so there is exactly one definition of "what an article is". Two
extractors would drift, and the drift would be invisible: the same URL clipped
two ways would produce two different Sources and nobody would see why.

## Architecture

```
Ambient (Swift)                    Trail server
────────────────                   ─────────────
hotkey / menu "Clip this page"
  ↓
resolve frontmost browser + URL
  ↓  POST { url, title, tags }
                          →   fetch the URL
                              extract via @trail/article-extract
                              create Source (existing ambient-source path)
                              compile → Neurons
```

**What already exists and is reused, not rebuilt:**

- `TrailClient.saveSource(...)` → `POST /api/v1/knowledge-bases/:kb/ambient-source`.
  Ambient is already authenticated against it, and the endpoint already creates a
  Source and kicks off background compilation. The clip becomes another producer
  for that path rather than a new pipeline.
- `FocusWatcher` already resolves the frontmost app and its bundle id — the half
  that decides *which browser to ask*.

**What is new:** URL resolution per browser, a server-side fetch+extract, and a
shared extraction package.

## Phases

### Phase 1 — URL out, server fetches (`F209.1`–`F209.3`)

Ambient sends the address; the server retrieves and extracts it. Simple, needs
no new permission beyond the Accessibility grant Ambient already holds.

**Known limit, stated up front rather than discovered:** a server-side fetch has
no session. Anything behind a login or paywall — an internal wiki, Notion, mail,
much of the press — returns a login page, and a login page extracts into a
plausible-looking Source that is worthless. **The failure must be loud**: if the
extraction yields too little text, or the page looks like a sign-in wall, the
clip is REFUSED with a message that says why, not saved as a stub.

### Phase 2 — the authenticated page (`F209.4`, not yet carded)

Safari and Chrome can both be asked, over AppleScript, for the DOM **as rendered
in the user's logged-in session** (`do JavaScript "document.documentElement.outerHTML"`).
That closes exactly the gap Phase 1 leaves, and it is the thing that would make
Ambient equal to the extension rather than a lesser cousin.

It is Phase 2 because it needs a per-browser user setting (*Allow JavaScript
from Apple Events*, off by default in both) and that is a real onboarding step,
not a silent capability. Do not start here.

## Non-goals

- Clipping native apps (PDF viewer, Figma, Slack). Idea `01a02ea2`; it widens
  the F201.5 egress guarantee and that is a decision, not a follow-up.
- Replacing the Web Clipper extension. The extension reads the DOM inside the
  user's authenticated session, which no server can imitate; Phase 1 explicitly
  does not cover what it covers. **Both ship.**
- Selection-clipping, highlights, auto-tagging. Not in the extension either.

## Open questions

1. **Which browsers on day one?** Safari and Chrome are certain. Arc and Brave
   are Chromium and likely answer the same AX/AppleScript shapes — unverified.
   What happens in an unsupported browser: refuse with a clear message, or fall
   back to the window title and save a bare bookmark? **Refusing is the
   proposal** — a Source containing only a title is the kind of thing that looks
   like it worked.
2. **Which knowledge base does a clip land in?** The extension asks every time.
   Ambient has no popup. Options: a configured default KB, the F201.7 KB-routing
   work, or a small confirmation panel. Unresolved.
3. **Attribution.** The extension's Sources carry `connector: mcp:claude-code`
   lineage via the clipper; an Ambient clip should be distinguishable in the
   Queue. Proposal: a new connector id in `packages/shared/src/connectors.ts`.

## Verification

The load-bearing claim is *"the article I was reading is now in Trail"*, and the
ways it can fail silently are all in the extraction:

- **Negative control first.** Clip a page that requires a login and assert the
  clip is REFUSED. A green run here that produces a Source is the bug — the
  Source would contain a sign-in page and read as success.
- **Strict equality on a marker**, not `contains`: clip a page carrying a known
  sentence, read the stored Source back from a fresh fetch, and assert that
  sentence survived intact. `contains` passes on truncated and on
  old-content-still-attached.
- **Same URL, both paths.** Clip one article with the extension and with
  Ambient; the extracted text must match. That is the test that keeps the two
  extractors from drifting, and it is the reason the extraction is shared code.
- **The URL is the one on screen.** Two browser windows open, two tabs each:
  the clip must carry the FRONTMOST tab's URL. A resolver that returns "a URL
  from that browser" passes a naive test and clips the wrong page.
