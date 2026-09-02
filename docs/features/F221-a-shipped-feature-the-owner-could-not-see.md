# F221 — a shipped feature the owner could not see

**Card:** trail-F221 · epic · high

> Owner, 2 September 2026: *"Underligt hvorfor du aldrig fix Trail size
> leveret - er det meget svært for dig?"* — about F217, which had been
> built, deployed and verified live eight hours earlier.

## Measured before assuming

The obvious reading was that the feature was missing. It was not.

| probe | result |
|---|---|
| `GET /api/v1/knowledge-bases` | every KB carries `size`, with real numbers |
| deployed bundle `index-BQMGUYye.js` | contains `trail-size-` |
| Lens on `https://app.trailmem.com/` | renders **"Admin Chat … 11.2 MB"** |

The feature was live the whole time. What was wrong is that his browser was
not showing him the live version — and nothing could tell him that.

## The defect

Every response from the admin app carried **no `Cache-Control`, no `ETag`
and no `Last-Modified`** — `index.html` and the hashed bundle alike:

```
HTTP/2 200
content-type: text/html; charset=UTF-8
content-length: 0
date / server / via / fly-request-id
```

That is the complete header set. With no directive and no validator, each
browser applies its own heuristic and has nothing to revalidate against.

**A stale SPA and a current one are indistinguishable** — from the user's
chair, and from a `curl`.

## The fix is two opposite rules

| path | directive | why |
|---|---|---|
| `/assets/*` | `public, max-age=31536000, immutable` | Vite content-hashes the filename, so a given URL can never change meaning |
| `index.html` | `no-store, must-revalidate` | the ONE file whose URL is stable while its contents move every deploy |

**Getting only the first right is exactly what produces a permanently stale
app.** The pairing is the whole point, which is why the acceptance criteria
assert that the two directives *differ*.

**Why `no-store` rather than `no-cache`:** without an `ETag` or
`Last-Modified` there is nothing for a revalidation to compare, so
"revalidate" hands the browser a full 200 anyway. The document is ~1 KB; the
hashed bundle it points at carries the weight and is cached for a year.

## What this does not prove

That his specific browser was serving a stale copy. Only he can confirm that,
and a hard reload settles it. What **is** proven is that the app gave every
browser permission to decide — the condition that makes the symptom possible
and makes it undiagnosable when it happens.

## The shape, for the seventh time this week

> "The feature is missing" and "the feature is there and you are looking at
> yesterday's copy" arrive as the same observation.

This one had a second cost. I had reported F217 as verified live, and it
**was**. So the report and his experience were both true and contradicted each
other — which is worse than a plain wrong claim, because there is nothing in
either account to pull on.

## Scope

**F221.1 — the headers.** Two opposite directives, asserted against the live
app after deploy.

**Not in scope:** an `ETag` on `index.html`. It would turn the fetch into a
304 instead of a 200, saving about a kilobyte per page load. Worth doing if
the shell ever grows; not worth a second mechanism today.
