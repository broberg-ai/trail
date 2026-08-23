# Chrome Web Store — listing for Trail Web Clipper

**Everything below is copy-paste ready.** Fields are in the order the Developer
Dashboard asks for them. Nothing here is a placeholder — where a value is a
decision rather than text, it is marked **DECISION**.

- **Publisher:** cb@webhouse.dk · publisher id `ebca6e54-f6f9-4cb8-907b-5e2f099d67e8`
- **Package:** `apps/web-clipper/trail-web-clipper-0.1.0.zip` (38 KB, built by
  `pnpm --filter @trail/web-clipper package`, which refuses to produce a zip
  containing a credential or broad host permissions)
- **Privacy policy URL:** `https://www.trailmem.com/privacy/` (live, verified 200)

---

## Store listing tab

### Name (max 75)

```
Trail Web Clipper
```

### Summary (max 132) — shown under the name in the store

```
Clip the page you are reading straight into your Trail knowledge base. One click, article text only, nothing running in the background.
```

*(131 characters.)*

### Description (max 16,000)

```
Trail Web Clipper saves the page you are reading into your Trail knowledge base with one click.

It clips the ARTICLE, not the page. Mozilla's Readability extracts the body text and discards navigation, banners, cookie notices and related-article boxes. What is left is converted to markdown, so headings, lists, links and quotes survive — the structure is what lets Trail build the content into what you already know, instead of receiving a lump of text.

WHAT IT DOES

• Pick which knowledge base the clip lands in, from a list fetched live from your own Trail.
• Add tags if you want to. It does not invent them.
• The status line shows which Trail the clip will go to BEFORE you click, so a clip never quietly goes somewhere you did not intend.
• After clipping, it shows the source address as a receipt.

IT IS IDLE UNTIL YOU CLICK IT

There is no background script running on the pages you visit. The extension asks for "activeTab" and "scripting" — permissions that grant access to the single page you are on, in the single moment you press the button. The extraction code is injected on that click and is gone afterwards.

It cannot follow your browsing. Not because we promise not to, but because we did not ask for permission to.

YOU CHOOSE THE SERVER

By default the extension uploads to app.trailmem.com. The server address is a setting, not a constant: point it at your own Trail — including one running on your own machine — and the clipped page never reaches us at all.

The only things stored on your device are the server address and your API token. The token is sent to exactly one place: the Trail server you configured, as the credential for your own upload.

REQUIREMENTS

You need a Trail account and an API token (Settings → Developer in your Trail).
Setup, server choice and what each error message means:
https://docs.trailmem.com/web-clipper/

Browser-internal pages (chrome://…), the Web Store itself and PDF viewers cannot be clipped. Browsers do not let extensions read them.
```

### Category

**DECISION** — `Productivity`. (`Developer Tools` is the alternative; Productivity
matches "save what you read", and the audience is not exclusively developers.)

### Language

`English (United States)`

### Visibility

**Unlisted.** Deliberate, not temporary: installable by anyone with the link,
not findable by search. This is a tool for people who know what an API token is.

---

## Privacy practices tab — the part review scrutinises

### Single purpose

```
Trail Web Clipper has one purpose: when the user clicks its toolbar button, it extracts the article text of the page they are currently viewing and uploads it to the user's own Trail knowledge base server.
```

### Permission justifications

**`activeTab`**
```
Used to read the content of the page the user is currently viewing, at the moment they click the extension's toolbar button. This is the page the user has explicitly chosen to clip. No page is read at any other time.
```

**`scripting`**
```
Used to inject the article-extraction script into the current tab when the user clicks the toolbar button. The extension deliberately declares no content_scripts, so no code of ours runs on pages the user merely visits — the extractor is injected on the click and does not persist.
```

**`storage`**
```
Used to remember two values on the user's own device: the address of the Trail server they chose, and their API token for that server. Nothing else is stored, and neither value is transmitted anywhere except to the user's own configured Trail server.
```

**Host permission — `https://app.trailmem.com/*` and `http://127.0.0.1:58031/*`**
```
These are the two Trail servers the extension uploads to: the hosted service, and a Trail engine running on the user's own machine. The extension needs to make requests to whichever the user selected in order to list their knowledge bases and upload the clip. If the user configures a different Trail server, the browser asks their permission for that specific address at that point, via optional_host_permissions.
```

**Remote code**
```
No. All code is contained in the package. The extension does not load or execute any script fetched at runtime.
```

### Data usage disclosures

| Question | Answer |
|---|---|
| Collects **website content**? | **Yes** — the text of a page, only when the user clicks clip |
| Collects **authentication information**? | **Yes** — the user's own Trail API token, stored locally on their device |
| Personally identifiable information | No |
| Health, financial, location, web history, user activity | No |
| Sold to third parties | **No** |
| Used for purposes unrelated to the single purpose | **No** |
| Used to determine creditworthiness / lending | **No** |

All three certification checkboxes can be ticked truthfully.

---

## Screenshots — 1280×800, at least one required

**These need the extension running in Chrome.** Suggested set, in order:

1. **The popup, connected** — knowledge-base menu open, status bar showing
   `N KB(s) · app.trailmem.com`. This is the whole product in one frame.
2. **The popup over a real article** — so the reader sees it is clipping what
   they are reading.
3. **Settings** — the two server buttons (Use cloud / Use local) and the token
   field, which is the "you choose the server" claim made visible.

Do not screenshot a page with anything private in it — the store listing is
public even when the extension is unlisted.

---

## What is NOT ready

- **Screenshots** — must be captured from a running install.
- **Small promo tile (440×280)** — optional; the listing publishes without it.

## Submission is a browser step

Uploading the zip and pressing Submit happens in the Chrome Web Store Developer
Dashboard, signed in as cb@webhouse.dk. That is Christian's click — there is no
API credential in this repo that could do it, and creating one would itself be
a dashboard step.

`https://chrome.google.com/webstore/devconsole`
