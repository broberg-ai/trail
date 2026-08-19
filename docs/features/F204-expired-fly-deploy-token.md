# F204 — CI deploys have been dead since May (the Fly deploy token expired)

**Status:** backlog · found 2026-08-19 · **critical**

## Correction first

This supersedes the cause recorded on **F203**. That card said landing's CI was
red because the `trail-landing` Fly app does not exist. That is true about the
app, but it is **not** why the jobs fail: they never get that far. All three
deploy jobs die at authentication, before any app is addressed.

The missing `trail-landing` app is still a real and separate problem — F203
keeps it, minus the wrong cause.

## What was found

```
gh run view <latest docs|landing|widget> --log-failed
  ==> Verifying app config
  ✓ Configuration is valid
  Error: Authenticate: token validation error
  ##[error]Process completed with exit code 1.

gh secret list
  FLY_API_TOKEN    2026-05-03T01:49:08Z

flyctl apps list
  trail-docs     broberg-ai   suspended   last deploy 2026-05-14
  trail-widget   broberg-ai   suspended   last deploy 2026-05-14

curl -sI https://docs.trailmem.com  →  HTTP/2 200, server: Fly
```

The `FLY_API_TOKEN` GitHub secret was set on **3 May 2026** and no longer
validates. Fly deploy tokens expire; this one did, and from that moment every
automatic deploy failed identically.

`suspended` on the two apps is ordinary idle auto-stop, not damage — the docs
site answers 200 because a request wakes it. It is serving **14 May code**.

## Why it went unnoticed for three and a half months

The failure looked like the normal state. There was no green run to contrast
against — by the time anyone glanced at the list, every row was red, so a red
row carried no information. This is the same failure shape components spent
the week chasing elsewhere: **a signal that fails in a way nobody is
surprised by stops being a signal.**

The engine and admin were unaffected and therefore hid the problem further:
they ship through the local `pnpm ship:engine` / `ship:admin` path, so the
surfaces Christian looks at most kept updating normally.

## Scope

**In:**

1. Mint a fresh Fly deploy token scoped to org `broberg-ai` and set it as the
   `FLY_API_TOKEN` GitHub secret.
2. Store it in the cardmem Secrets Vault (Trail's vault is currently empty),
   so the next expiry is a lookup rather than a re-issue.
3. Prove a deploy actually completes — a green job is necessary but not
   sufficient; fetch the live site and find the newly-shipped content.
4. Make the next expiry loud instead of silent: the fleet already runs
   `cronjobs.webhouse.net` as a durable external clock, so a periodic check
   that the newest run of each deploy workflow is green belongs there.

**Non-goals:**

- The landing Pages-vs-Fly decision — that stays on F203.
- Deploying the accumulated changes. Rotating the token and shipping three
  and a half months of undeployed work are **two separate decisions** (see
  below).

## Blast radius — requires Christian's direct order

Rotating the token does not just repair a job; it **re-arms automatic
deployment**. The very next push would ship roughly three and a half months of
never-deployed changes to three live surfaces at once, unattended.

So the order matters:

1. Rotate the token.
2. Look at what would actually ship (`git log` since 2026-05-14 for
   `apps/docs`, `apps/widget`, `apps/landing`).
3. Deploy deliberately — one surface at a time, verified — rather than
   letting the first unrelated push carry all of it.

Neither step happens on a peer's say-so or on this plan's say-so.

## Dependencies

None. F203 is adjacent, not blocking.
