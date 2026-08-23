# F208 — Publish the Web Clipper to the Chrome Web Store (unlisted)

**Status:** in progress · asked for 2026-08-23

## Why it disappeared (and why publishing is the actual fix)

Christian: *"den er forsvundet fra mit panel i Chrome."*

Measured, not guessed:

```
apps/web-clipper/dist            did not exist
.gitignore:83                    dist          ← gitignored build artifact
package.json (web-clipper)       clean: rm -rf ... dist
Mac restarted                    2026-08-19
```

Chrome had it loaded **unpacked from `apps/web-clipper/dist`**. That folder is a
local build artifact — gitignored, and removed by `clean`. Chrome silently drops
an unpacked extension whose folder is gone, and the loss is noticed at the next
browser or machine restart.

So this is not a bug to fix once. It is a property of running an extension from
a build directory: **it will disappear again** on the next clean, the next
`pnpm clean`, the next machine. A store install survives all three. That is the
strongest argument for publishing, and it is Christian's actual complaint.

Rebuilt it today so it works again in the meantime.

## Decisions (Christian, 2026-08-23)

1. **Unlisted.** Installable by anyone with the link, not searchable. It is a
   tool for his own knowledge base; a public listing would demand a story for
   strangers and invites a harder review of the broad permissions for no gain.
2. **Cloud by default.** `https://app.trailmem.com`, with the local dev server
   still selectable in settings. Today the extension is hardwired to
   `http://127.0.0.1:58031` — so a clip is lost whenever the Mac's dev server
   is not running, and for anyone else it points at nothing.

## What publishing actually requires

Named plainly, because three of these are not code:

| Requirement | State |
|---|---|
| Developer account (one-time **$5**, Google account) | **Christian's** — nobody else can pay it |
| Privacy policy at a public URL | **missing** — `trailmem.com/privacy` is 404 (F208.3) |
| Store zip from a clean build, version off `0.0.1` | to build (F208.4) |
| 1280×800 screenshot, 128px icon, listing copy | icon exists; the rest to make |
| Permission justification for `<all_urls>` | to reduce or justify (F208.2) |
| Review | days to weeks; broad permissions lengthen it |

## The permission question (F208.2)

The manifest asks for `host_permissions: ["<all_urls>"]` and registers a content
script on every page at `document_idle`. Chrome renders that to the user as
**"Read and change all your data on all websites"** — the scariest string in the
install dialog, and the thing store review looks hardest at.

Clipping happens when the user clicks the toolbar button. That is precisely what
`activeTab` exists for, and `scripting.executeScript` can inject the extractor on
that click instead of running it on every page the user visits. If that works,
the broad permission and the always-on content script both go away — a real
privacy improvement, not only a review convenience.

This must be **measured, not reasoned about**: load the built extension, clip a
real page with the reduced set, and see. If a broad permission genuinely turns
out to be necessary, the manifest stays as it is and the plan records the case
that forced it — an unjustified `<all_urls>` is not left in by default.

### What the narrowing was blamed for, wrongly (2026-08-23)

Right after the permissions were narrowed, the popup opened blank. It was
diagnosed three times without measuring anything — stale hashed filenames, then
the narrowed permissions themselves, then rebuilding beneath a loaded extension
— and on the second guess the whole narrowing was **reverted**. None of the
three was the cause.

The cause was in the error the browser had been showing the entire time:

```
Service worker registration failed. Status code: 11
"service_worker": "src/background/main.ts"      <- raw TypeScript
```

`src/background/main.ts` appears only in the SOURCE manifest; the built one says
`service-worker-loader.js`. So the browser had been pointed at
`apps/web-clipper/`, not `apps/web-clipper/dist/`. Confirmed arithmetically
rather than by eye: Chrome derives an unpacked extension's id from the absolute
path it was loaded from (first 16 bytes of `sha256(path)`, each hex nibble
mapped `0..f` to `a..p`), and the id on screen resolved to the source folder:

| path | id |
|---|---|
| `…/apps/web-clipper` | `naekfdonaambbcgbokomilidoeblcfma` ← the one on screen |
| `…/apps/web-clipper/dist` | `hapdkbiohbjfopmcadpaniipkhldijic` |

The narrowing was therefore restored. Two things are worth keeping from this:

- **A wrong folder and a wrong permission set fail identically** — an empty
  panel, no message. Nothing in the panel distinguishes them, which is why
  guessing between them was cheap and wrong three times running.
- **The reminder was already written and did not work.** Every doc said `dist`.
  So the fix is mechanical, not editorial: the source manifest is now
  `manifest.config.json`, which leaves no `manifest.json` in the source folder,
  and the browser refuses it outright — *"Manifest file is missing or
  unreadable"* — instead of half-loading it into a silent failure. `pnpm build`
  also prints the absolute folder to load. The wrong folder is now unloadable
  rather than merely discouraged.

## Security note — what nearly shipped

Until yesterday this extension carried a **real full-access Trail API key** in
its source (F207). Publishing it a week ago would have shipped that credential
into the Chrome Web Store, where it could not have been quietly deleted. It is
now rotated, removed, and a commit-time + CI gate stands in front of a repeat.

The store zip therefore gets its own check: the F207 scanner is run over the
**extracted contents of the zip**, not the source tree, because the zip is what
strangers receive.

Related: the clipper is the natural first consumer of **F205**'s restricted
partner keys — an upload-only key bound to one knowledge base is exactly the
right credential for it, instead of a personal token that can do everything.
Not a blocker (F205.2's endpoint is not built yet), but it is where this should
land.

## Non-goals

- A public, searchable listing. Explicitly decided against.
- Firefox and Edge. A `.xpi` and a `browser_specific_settings.gecko` block
  already exist from April; Chrome ignores the block and it stays, so a Firefox
  build stays cheap if it is ever wanted. Edge is skipped deliberately: it can
  install straight from the Chrome Web Store, so a second listing buys nothing
  but a second review queue.
- Rewriting the clipper's UI. The popup already reports "Not configured"
  honestly; this epic changes where it points, not how it looks.

## Safari (decided 2026-08-23)

Christian clips in **Chrome and Safari**, and holds an Apple Developer
membership already — so Safari is in scope, as **F208.5**.

Safari refuses a bare web extension: it must be wrapped in a native Mac app
(`xcrun safari-web-extension-converter`, present here with Xcode 26.3). But
there are two ways to ship that app, and the cheaper one fits this decision far
better:

| Route | Review | Fits "unlisted"? |
|---|---|---|
| **Developer ID + notarised** | none | yes — ship in minutes, update instantly |
| Mac App Store | full review per update | poorly — no real unlisted tier for Mac |

**Developer ID is the route.** One blocker, measured today:

```
security find-identity -v -p codesigning
  "Apple Development: Christian Broberg (2U79XQP6RM)"
  "Apple Development: Christian Broberg (WPC2C5BBAU)"
  "Apple Distribution: WebHouse (7NAG4UJCT9)"      ← App Store only
```

There is **no `Developer ID Application` certificate**, and that is the one
required to distribute a Mac app outside the App Store. It is free to create
with the existing membership — but on a company account only the Account Holder
can create it, so it is Christian's step, not one a session can take.

The Safari build must come from the **same `dist/`** Chrome uses. A hand-kept
second copy of the extension is how two browsers quietly stop behaving the same.

## Breakdown

- **F208.1** — Default to the cloud Trail, local still selectable
- **F208.2** — Ask for the narrowest permissions clipping actually needs
- **F208.3** — Privacy policy live at a stable URL
- **F208.4** — Package and submit the unlisted listing
- **F208.5** — Safari: wrap as a Developer ID-signed Mac app (no App Store review)
