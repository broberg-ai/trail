---
title: The Web Clipper extension
slug: web-clipper
summary: Install the browser extension, point it at your Trail, and clip any web page into a knowledge base with one click. Covers setup, the API token, what the extension can and cannot see, and what each error message means.
order: 33
audience: both
category: Patterns
---

The Web Clipper is a browser extension that saves the page you are reading
straight into a Trail knowledge base. One click, no copy-paste, and the page
arrives as a Source that Trail compiles into Neurons like any other upload.

It is idle until you click it. It does not follow your browsing.

> **Availability.** The extension is not in the Chrome Web Store yet — it is
> being submitted. Until then it installs from a build folder, described below.
> A Safari version follows as a signed Mac app, because Safari does not accept
> bare web extensions.

## Install (Chrome, Edge, Brave)

Any Chromium browser will load it.

1. Build the extension, if you have the repository:
   ```bash
   cd apps/web-clipper && pnpm build
   ```
   This produces `apps/web-clipper/dist`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `dist` folder.
5. Pin Trail Web Clipper to the toolbar from the puzzle-piece menu.

**Choose `dist` itself, not the folder above it.** The folder above holds the
source, which is TypeScript — a browser cannot run it, so the extension loads
but its background script never starts and the panel opens empty. There is no
error to click on; it simply does nothing. The source folder no longer contains
a `manifest.json`, so Chrome now refuses it outright with *"Manifest file is
missing or unreadable"* rather than half-loading it.

**If the extension disappears later**, the folder it was loaded from is gone —
`dist` is a build artefact, not committed, and a clean removes it. Chrome drops
an unpacked extension whose folder no longer exists, usually noticed after a
restart. Rebuild and load it again. A store install removes this problem for
good.

## Point it at your Trail

Open the extension and click **Settings**. Two buttons pick the server for you:

| Button | Address | When |
|---|---|---|
| **Use cloud** | `https://app.trailmem.com` | the default — works whether or not your own machine is running |
| **Use local** | `http://127.0.0.1:58031` | only while your own Trail engine is running |

Choose **local** and a clip is lost whenever that server is down. That is why
the cloud is the default.

## Get an API token

The token is what proves a clip is yours. **The extension ships without one**,
deliberately — a token baked into an extension would be a published credential.

1. Open the Trail you chose above.
2. Go to **Settings → Developer**.
3. Click **Generate new key**.
4. **Copy it immediately** — it is shown once and never again.
5. In the extension: **Settings → API Token**, paste, **Save & Connect**.

The token must belong to the server you selected. A token from a local engine
will not work against the cloud, and the other way round — they are separate
systems with separate accounts. The extension will say so if you mix them up.

## Clip a page

1. Open an article.
2. Click the Trail icon.
3. Pick a knowledge base and, if you like, add tags.
4. **Clip**.

The status line shows which Trail the clip will land in **before** you click, so
a clip never quietly goes somewhere you did not intend.

The page arrives as a Source. From there it follows the normal path: Trail
extracts it, compiles it, and the resulting Neurons appear in the
[curation queue](/docs/concepts-queue) for review.

## What the extension can see

It asks for the narrowest set of permissions that still allows clipping:

| Permission | Why |
|---|---|
| `activeTab` | read the page you are on — **only at the moment you click** |
| `scripting` | run the extraction code on that page, on that click |
| `storage` | remember your server address and token, on your own device |
| access to `app.trailmem.com` and `127.0.0.1` | the two Trail servers it may upload to |

There is **no** background script running on the pages you visit. The extractor
is injected when you click and is gone afterwards. If you configure a different
Trail server, your browser asks your permission for that specific address at
that point, rather than everyone granting it up front.

Your token and server address stay in the browser's local extension storage on
your own machine. The token is sent to exactly one place: the Trail server you
configured, as the credential for your own upload.

## When something goes wrong

The extension tells you what actually failed rather than showing an empty panel:

| Message | What it means | What to do |
|---|---|---|
| `Not configured — add your API token in settings` | no token yet | see **Get an API token** |
| `Can't reach <address>` | the server did not answer | is it running? is the address right? |
| `<address> refused the API token (401)` | the server answered and rejected the token | the token is revoked, or belongs to the other server — generate a new one |
| `Content script did not respond` | the page did not answer in time | reload the page and clip again |

An extension that shows an **empty panel with no message at all** is a different
problem: its background script failed to start. Open `chrome://extensions`, look
for the red **Errors** button on the Trail card, and check that the folder you
loaded is `dist`.

Browser-internal pages (`chrome://…`), the extension store itself, and PDF
viewers cannot be clipped. Browsers do not let extensions read them, and no
setting changes that.

## Related

- [Sources & programmatic upload](/docs/concepts-sources) — the API the clipper
  uses, if you want to send pages from your own code instead.
- [The curation queue](/docs/concepts-queue) — where a clip goes before it
  becomes part of your knowledge.
