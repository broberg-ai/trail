# F222 — machines must be replaceable

**Card:** trail-F222 · epic · critical

> Owner, 3 September 2026: *"jeg kan ikke basere en chat på data i trail hvis
> den er nede i 90 -> 30 sekunder uden at man kan få et svar ved reboots eller
> deploys, det holder ikke — maskiner og admin teknik skal afkobles fra
> databaserne komplet."*

## This overrules F220, and the owner was right

F220 concluded: split the admin app, shard the engine, **do not move any
database**. That optimised for migration safety and under-weighted the thing
that actually decides it — **Trail is becoming a dependency other products
call.** A dependency that returns nothing for 90 seconds during a deploy is not
one you can build a chat on. *"Shorter outage"* is not an answer to *"must not
be unavailable"*.

## The measurement that defines the job

Engine volume, 3 September 2026:

```
/data/broberg-ai        180 MB
/data/sanne-andersen    2.3 GB    ← uploads/t-sanne-andersen = 2.2 GB / 2525 files
/data/fd-aalborg        7.0 MB
```

**The databases are the smaller half.** 2.2 of the 2.3 GB is *files*. Moving the
DB and leaving the images on the volume decouples nothing — the machine is still
not replaceable, and the work *looks* finished.

> **Both stores move, or neither counts.**

## Why Turso — four measured reasons

**1. FTS5 survives.** All retrieval is SQLite FTS5 (`documents_fts` +
`chunks_fts`, `tokenize='porter unicode61'`, with triggers). Postgres means
rewriting search from zero — and F219 showed *today* how subtle that code is:
five drifted implementations, a hyphen bug that returned nothing for months, and
a ranking effect that hid the correct answer below the cut. Rewriting it during
an infrastructure migration ships two bugs at once. Turso is libSQL, a SQLite
fork; FTS5 is intact.

**2. The client is already ours.** `packages/db` uses `@libsql/client`, which
Turso's own docs name as the Drizzle/ORM path. The connection becomes a URL plus
a token — not a rewrite.

**3. One database per tenant is Turso's native model.** Our architecture already
is one `trail.db` per tenant. Turso is built for that shape — many small
databases, per-database tokens. It maps 1:1 instead of being forced.

**4. The object-storage half is already built.** `packages/storage` is ONE
interface with ONE implementation (`LocalStorage`), instantiated in exactly one
place (`apps/server/src/lib/storage.ts:10`). And `R2BackupProvider` already does
S3-compatible multipart upload via `@aws-sdk/lib-storage` — precisely the
mechanism the seam's `appendChunk`/`finalize` need, proven in production on the
backup path.

## The risks, stated now rather than discovered later

### A. FTS5 churn vs embedded-replica sync — the one most likely to bite US

Turso's own docs warn that *"large structural changes (btree splits) or dirty
write-ahead logs can trigger unexpectedly high data transfers"*, with a **4 kB
minimum sync unit per write**. An FTS5 index rebuilt on every ingest is exactly
that kind of churn.

This must be **measured on a real KB** before anything is committed to. It is the
specific way this migration goes wrong for us rather than for a generic app.

### B. Region / GDPR — **not verified**

Sanne's KB holds health-adjacent client data, and the house rule is `arn`
(Stockholm). Turso's locations page 404s and I could not confirm the region list.

**This is a hard gate, not a detail.** If there is no EU region, Sanne's tenant
does not move, and that changes the whole plan.

### C. A new dependency on the hot path

Today one machine can fail. Afterwards one *provider* can fail, and every machine
goes with it. The mitigation is real — libSQL is open source and self-hostable
(`sqld`) — but it has to be an exit we have **actually tried**, not one we assume.

### D. Cold start

An embedded replica must sync before it serves. For a 1.96 GB tenant that is not
free. The design answer is a per-machine **ephemeral** replica — *not* a Fly
volume, which would put us back on one machine — with the health check gating
traffic until sync completes.

## Two designs, and the spike decides between them

| | remote-only | embedded replica |
|---|---|---|
| read latency | network per query | local file (µs) |
| cold start | none | full sync before serving |
| sync complexity | none | real, and FTS5 churn is the risk |
| machines | any number, instantly | any number, after warm-up |

A chat answer runs ~12 searches per question across N KBs. Whether that is
acceptable over the network is **a number, not an opinion** — F222.2 measures it.

## Ordering, and it is not arbitrary

1. **Files first.** Biggest chunk of state, lowest risk (immutable blobs — copy,
   verify by hash, switch), clean seam already. Moving the DB first would gain
   nothing while 2.2 GB stays on the box.
2. **The spike.** Decide remote-only vs embedded replica with a measurement.
3. **Tenant databases.**
4. **`control.db` last.** Smallest, highest blast radius — done only once the
   pattern has been proven twice.
5. **Prove it.** Deploy while traffic is in flight.

## No naked cutover, anywhere

Every step runs both stores, proves the new one on real traffic, and only then
removes the old one. And `cb@webhouse.dk` must still be admin in every tenant
afterwards — **verified by logging in, not by reading a row.** A migration is
exactly where that gets broken.
