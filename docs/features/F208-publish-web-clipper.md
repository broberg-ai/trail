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
- Firefox. A `.xpi` and a `browser_specific_settings.gecko` block already exist
  from April; Chrome ignores the block and it stays. Publishing to AMO is a
  separate decision.
- Rewriting the clipper's UI. The popup already reports "Not configured"
  honestly; this epic changes where it points, not how it looks.

## Breakdown

- **F208.1** — Default to the cloud Trail, local still selectable
- **F208.2** — Ask for the narrowest permissions clipping actually needs
- **F208.3** — Privacy policy live at a stable URL
- **F208.4** — Package and submit the unlisted listing
