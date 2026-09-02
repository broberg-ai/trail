# F220 — a deploy must not take every customer down

**Card:** trail-F220 · epic · critical

> Owner, 2 September 2026, watching a deploy knock out his own Web Clipper:
> *"Men hvad nu hvis jeg havde solgt 200 licenser af trail ville de så alle være
> døde mens vi skubber admin ud? Det er IKKE holdbart."*

He is right, and the obvious answer is wrong.

## What happened

Deploying `trail-engine-001` returned **502** to his Web Clipper for ~60-90
seconds — first "No KBs found", then "app.trailmem.com answered 502". He was
mid-clip. Deploying `trail-admin` does the same thing to **everyone at once**.

Observed, not projected: machine updated 20:38:08, health passing 20:39:05.

## "Just run two machines" does not work

```
trail-admin        1 machine · vol_vjy5gko53gojgm9v   1 GB  (control.db)
trail-engine-001   1 machine · vol_42kl1epm616n0284  20 GB  (tenant DBs + uploads)
```

**A Fly volume attaches to exactly ONE machine.** A second machine gets its own
volume — so you would run two **diverging** copies of the login database.

That is worse than downtime, and worse in the way this repo keeps meeting: an
account created on machine A is simply **absent** on machine B. Nothing errors.
The system looks like it is working.

**So the state has to leave the machine before a second machine is possible.**

## Admin is the dangerous one — and the cheap one

It is login **and** the proxy every tenant's request passes through. When admin
is down, all 200 are down no matter how many engines exist.

And its database is **1 GB and write-light**: users, tenants, memberships, API
keys. We already use the libSQL client, and `createLibsqlDatabase` takes a URL as
readily as a path. Move `control.db` to a network database and admin becomes
**stateless** → N machines → rolling deploy → **zero downtime**.

Days, not weeks. And it removes the only place where *every* customer falls at
once.

## The engine is a bigger job — and already bounded by design

CLAUDE.md's architecture already says it:

> Stateless engine fleet, multiple tenants per engine … One trail.db per tenant,
> stored on the engine's volume (Phase 1) or on dedicated DB-host machines
> (`{tenant}.db.trailmem.com`, Phase 2+).

With 200 licences across ~10 engines, one deploy touches **one engine's** tenants
— 20, not 200. Still not good enough, but a different order of magnitude, and
Phase 2 is the written plan. This card does not re-decide it.

## The risk that governs the whole migration

`control.db` holds **accounts, memberships and API-key hashes**. This is a naked
cutover of the worst kind if done backwards.

**Prove the new store serves a real login BEFORE the old one stops.** Never
after. And `cb@webhouse.dk` must still be admin in every tenant afterwards —
verified by *logging in*, not by reading a row. That rule exists because a
migration is exactly where it gets broken.

## Verification

Zero downtime is not inferred from a machine count. **Deploy while a request is
in flight and show it did not fail** — the same standard that caught every other
false green this week.

## Owner asked whether moving the login DB is dangerous — 3 September 2026

It is, and the answer changed the recommendation. **Splitting the admin app
comes first; moving `control.db` may never be needed at all.**

### Why the move is the most dangerous single change in the system

| | |
|---|---|
| **A half-copy is invisible** | Rows that failed to migrate look exactly like rows that never existed. The users who are missing find out by not being able to log in. |
| **It creates a NEW single point of failure** | Today one machine can die. Afterwards one *database* can die — and then every machine is down at once. That is a bigger blast radius, not a smaller one. |
| **Latency lands on the hot path** | Every request through the proxy validates a session against `control.db`. Local disk is microseconds; a network DB is milliseconds, on everything. |

**Two numbers decide whether it is viable, and NEITHER IS MEASURED:** how much
data `control.db` actually holds (1 GB is the volume size, not the contents) and
how many lookups per second it serves. Stated here rather than estimated.

### The cheaper thing that gets most of the benefit

`apps/admin-server` does **two** jobs in one process: it serves the SPA
(stateless) and it handles auth + proxy (stateful). Only the second needs the
volume.

**Split them.** The SPA runs N machines and deploys with zero downtime — and it
is the half that changes almost every time. The auth service keeps its volume,
stays single-machine, and is deployed rarely.

| | today | after the split | after moving the DB |
|---|---|---|---|
| downtime on a typical deploy | ~90 s | **0** | 0 |
| risk of locking the owner out | — | **none — the DB is not touched** | real |
| effort | — | days | weeks |

The split is also a prerequisite step *if* the DB ever moves, so it is not
wasted work either way.

### And the honest limit — the engine cannot reach zero this way

A service whose data lives on the machine cannot be deployed without a gap: a
Fly volume attaches to exactly one machine, so while that machine restarts the
data does not exist. Three options, in increasing price:

1. **Shorter gap** — faster boot. Maybe 90 s → 30 s. Cheap, not zero.
2. **Fewer people per gap** — more engines, tenants sharded across them. A deploy
   takes 1-in-N tenants down instead of all. **Already the written architecture.**
3. **Zero** — move every tenant's Trail off the machine. The same dangerous
   migration as `control.db`, except the stake is every customer's knowledge
   rather than the login table.

**Recommendation: (1) split admin, (2) solve the engine with sharding, (3) do not
move any database until a measurement demands it.** Zero downtime on the engine
is not the property worth buying next; one tenant's outage not reaching the other
tenants is worth far more.
