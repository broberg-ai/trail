# F194 — OAuth account-linking (Google/GitHub) with linked-state UI

**Status:** shipping
**Date:** 2026-06-07
**Area:** admin-server (oauth, auth, schema, migrations) + admin SPA (settings-account)
**Depends on:** F35-precursor OAuth (oauth.ts), F186 account-settings panel
**Reference:** xrt81's `auth_identities` pattern (intercom #3760/#3761)

## Motivation

The Settings → "Sådan logger du ind" → **Tilknyt konto** buttons for Google/GitHub
did nothing useful:

1. The button was a disabled stub (fixed in the prior commits — now wired +
   hard-navigates to `/api/auth/<provider>`).
2. But the OAuth callback only does **sign-in-by-email-match**: it finds a
   `control_users` row whose email equals the provider email, else bounces with
   `email_not_registered`. There is **no persistence and no linked-state**, so:
   - The button always shows "Tilknyt konto" — never reflects a connection.
   - If the user's Google/GitHub email ≠ their Trail email (e.g. cb's Google is
     not `cb@webhouse.dk`), clicking links **nothing** — the loop can repeat
     forever with no effect. Same for GitHub.

Christian wants real **account-linking**: while logged in, click "Tilknyt" →
the Google/GitHub account you authenticate with is attached to *your current
account* (regardless of provider email) → the button shows
"Tilknyttet (email) · Fjern" → you can then sign in with that provider.

## Scope

**In:**
- New `oauth_identities` table in control.db: `(id, user_id, provider,
  provider_subject, email, created_at)`, UNIQUE(provider, provider_subject).
- OAuth callback rewrite (the one change xrt81 named):
  - **Link mode** — if a valid `trail-session` cookie is present (user is
    logged in), link the authenticated provider identity to the **current
    session user**, *regardless of email match*, then redirect back to
    `/settings`. (No new session created.)
  - **Login mode** — if no session: resolve user **by identity
    (provider, subject) first**, falling back to email-match; on success
    record/refresh the identity and create a session. (sub is the stable key.)
- `GET /api/auth/me` returns `linkedProviders: [{provider, email}]`.
- `DELETE /api/auth/:provider/identity` — unlink (remove the row). Safe because
  magic-link (email) is always available, so unlinking never locks anyone out.
- SPA: render "Tilknyttet (email) · Fjern" when linked, else "Tilknyt konto".
- `parseProfile` extended to return the provider `subject` (Google `sub`,
  GitHub `id`).

**Non-goals:**
- Apple sign-in (xrt81 has it; we don't need it — note: Apple would require
  `SameSite=None` state cookie for its `form_post` callback + sub-first match).
- Last-login-method guard on unlink (unnecessary — email-link is always on).
- Role/permission changes (orthogonal; see F193).

## Architecture

`oauth_identities` is the source of truth for "which providers are linked to a
user". Link mode vs login mode is decided by **presence of a valid session
cookie on the callback** — no `intent`/`userId` baked into the state cookie
(the state cookie stays a pure CSRF nonce); the authoritative user comes from
the live session, which is safer than trusting a baked id.

```
GET /api/auth/google                 → 302 to Google (state cookie = CSRF nonce)
GET /api/auth/google/callback         →
  verify state==cookie
  exchange code → { email, sub, email_verified }   (reject if !email_verified)
  sessionUser = resolveSession(trail-session cookie)
  if sessionUser:  linkIdentity(sessionUser.id, 'google', sub, email)  → 302 /settings   [LINK]
  else:
    user = findUserByIdentity('google', sub) ?? findUserByEmail(email)
    if !user → 302 /login?error=email_not_registered                                      [reject]
    linkIdentity(user.id, 'google', sub, email); createSession; → 302 /                   [LOGIN]
```

`linkIdentity` is idempotent (UNIQUE(provider, subject)); if the identity is
already bound to a *different* user it refuses (no identity theft).

## Rollout
1. Code + plan-doc (this commit), `tsc` + SPA build green.
2. Deploy trail-admin — boot runs `runMigrations()` → creates `oauth_identities`
   (additive CREATE TABLE IF NOT EXISTS; no data migration, low risk).
3. Verify: link flow end-to-end (cb logs in via magic-link, links Google →
   `/me.linkedProviders` shows google → button shows "Tilknyttet · Fjern" →
   sign out → sign in via Google → identity lookup logs cb in).

## Verification
- `GET /api/auth/me` (cb session) returns `linkedProviders` reflecting reality.
- DB: `oauth_identities` row appears after a link, is idempotent on re-link,
  and is removed by the unlink endpoint.
- Existing magic-link + email-match login paths still work (regression).
