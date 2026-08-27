# F215 — The Web Clipper can only see one tenant

**Status:** planned, not started. Reported by the owner 2026-08-28 with a screenshot.

> "Hvis man er med i flere Tenants så burde der også være en Tenant vælger i
> dette Web Clipper tool. Det virker godt nok med at man skifter tenant på
> sitet men det skal kunne gøres direkte i Web Clipper toolet."

## Measured, not assumed

`apps/web-clipper/src/` contains **zero** occurrences of the word "tenant".
Both of the extension's network calls send only a bearer token:

| Call | Line | Headers |
|---|---|---|
| `GET /api/v1/knowledge-bases` | `Popup.tsx:61` | `Authorization` only |
| `POST /api/v1/knowledge-bases/:id/documents/upload` | `Popup.tsx:107` | `Authorization` only |

With no `X-Trail-Tenant`, the admin proxy falls back to the key's home tenant —
`broberg-ai`. That is exactly what the screenshot shows: CB-M1, Buddy Research,
Buddy sessions, Claude Code, Development Tester, LLM Technical Research … and
the footer's **"10 KB(s)"** matches broberg-ai's ten Trails precisely.

So the Clipper is not filtering, failing, or lacking permission. **It has never
had the concept.** The same key can already reach `sanne-andersen` and
`fd-aalborg` — the Clipper simply never says which one it wants.

## What already exists

F191.6 made the tenant a per-request selector: a `scope=all` key carries the
tenant in the `X-Trail-Tenant` header, verified against that user's memberships,
and an unauthorised slug returns 401. **The header is a selector, never a
grant** — this feature creates no new access, it only lets the Clipper express a
choice the key already has.

What is missing is a way to ASK which tenants those are. The `local-ingest`
skill hardcodes the slugs, which is acceptable in a script and not in a UI — a
revoked membership would keep appearing in a picker until someone shipped a new
extension version.

## Scope

### In

1. **`GET /api/v1/me/tenants`** — the tenants the calling key's user belongs to.
2. **A tenant picker in the popup**, above the KB picker, shown only when there
   is more than one to choose from.
3. **The choice is remembered** in extension storage and **re-validated on open**.
4. **`X-Trail-Tenant` on both calls**, and the KB list re-fetched on change.

### Out

- Clipping into several tenants at once. One page, one destination.
- Creating or managing tenants from the Clipper — that is the Admin SPA's job.
- Any change to what a key is allowed to reach. Selection only.

## The failure this must not ship

A KB id belongs to one tenant. If the tenant changes and the previously selected
KB id is still held, the next clip is sent with a **new tenant header and an old
KB id**. The plausible outcomes are a confusing 404 — or, far worse, a match
against something in the new tenant. Either way the page lands somewhere the
user did not choose, and the Clipper's own confirmation says it worked.

So *changing tenant clears the selected KB* is not tidiness. It is the point,
and it gets its own acceptance criterion and its own mutation.

## Rollout

1. Endpoint first, with its own test — it is the only new server surface.
2. Popup picker behind nothing: a single-tenant key sees no change at all.
3. Lens verification, then a Store update (the Clipper ships unlisted — F208).

## Dependencies

- **F191.6** — `X-Trail-Tenant` selection for scope=all keys (shipped).
- **F208.2** — the KB picker is already a custom control; the tenant picker
  reuses `BauhausSelect` from `@trail/ui` rather than a native `<select>`.
- **F210** — customer tenants are the reason there is now more than one to pick.
