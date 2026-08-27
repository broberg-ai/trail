# F211 — The local admin was unreachable: a blank page, then a 404, then a loop

**Status:** Partly fixed 2026-08-27 · **Reported by:** Christian, in the product
("http://127.0.0.1:58031/ ingen UI")

## What he saw

A black page with the constellation background and nothing else. No error, no
login form, no hint. Reloading did not help.

## What it actually was — three faults in a chain

Each one alone would have been survivable. Together they left no way in, and
none of them said anything on screen.

### 1. The admin SPA was pointed at the wrong server

Measured: the running Vite had `API_URL=http://127.0.0.1:58021`. That is the
**engine**. The admin SPA needs the **control plane** (`apps/admin-server`) —
login, tenants, memberships — which was not running at all.

### 2. A missing session degraded into a crash instead of a redirect

The engine's `/api/auth/me` (`apps/server/src/routes/auth.ts:339`) answers
**200** with `{"user": null}` when there is no session. The SPA's own handling
is correct and was never reached:

```ts
fetchAuthMe().then(setMe).catch(() => { /* redirect to /login */ })
```

A 200 does not throw, so `.catch` never fired. `me` was set to an object with
no `tenants` field, `me` is truthy, `<TopNav me={me}>` rendered — and
`top-nav.tsx:60` did `me.tenants.length`. Uncaught TypeError, the whole SPA
died, and what was left on screen was the canvas behind it.

**This is the house failure mode in its purest form: a missing value
degrading into a confident-looking nothing.** The engine's `/me` also carries
none of `organizationId`, `tenant`, `tenants`, `engineUrl` — the fields the
admin's `AuthMe` type requires — so even a VALID session would have crashed
the same way.

### 3. The way out was unreachable, and then looped

- `app.get('/api/auth/dev-login')` was declared at index.ts:195, **after**
  `app.route('/api/auth', oauthRoutes)` at :190. Those routes mount
  `/:provider`, which matches the literal segment `dev-login` and answers
  `404 unknown provider`. The route existed and could never run.
- With that fixed, `/login` looped: Vite proxied only `/api`, so it answered
  `/login` with the SPA, which saw 401, redirected to `/api/auth/dev-login`,
  got 302'd back to `/login` — forever.

## What was fixed (verified)

| Fix | Proof |
|---|---|
| `dev-login` declared BEFORE the oauth `/:provider` mount | `302 → /login`; negative control: `/api/auth/facebook` still `404 unknown provider` |
| Vite proxies `/login`, `/logout`, `/invite` to the control plane | `<title>Sign in to Trail</title>` through the proxy |
| The control plane runs locally | `:3031` up; `/api/auth/me` → **401**, not 200 |
| The page renders | Lens `pass` — "page loaded with no uncaught error"; the login form is on screen |

Local dev now: control plane on `:3031`, admin SPA on `:58033` with
`API_URL=http://127.0.0.1:3031`, engine on `:58021`.

## What is NOT fixed — F211.1

**The engine's `/api/auth/me` still answers 200 with `{user: null}`.** This was
worked around by pointing the SPA at the control plane, not repaired. Point any
client at the engine's `/me` again and it gets the same silent nothing.

And `top-nav.tsx` still reads `me.tenants.length` with no guard, so any `/me`
response missing that field takes the whole page down rather than degrading.

Both need doing. The 200 is the root cause; the guard is the seatbelt. Fixing
only the guard would hide "you are not signed in" behind an empty-looking admin,
which is why the 200 is the primary.

## Non-goals

- Reworking how the launcher chooses `API_URL`. The default in
  `vite.config.ts` (`http://localhost:3031`) is already correct; the running
  process had been started with an override.
- Prod. `app.trailmem.com` serves the SPA from the control plane itself, so
  routes 2 and 3 cannot arise there — this is a local-dev repair.
