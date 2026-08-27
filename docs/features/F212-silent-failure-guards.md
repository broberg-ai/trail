# F212 — Silence is not health: backups have failed for 3 months, and nothing said so

**Status:** ready · **Priority:** critical · **Opened:** 2026-08-27

> **Correction, same day.** The first version of this doc said the live
> `documents` rows "hold NULL" and treated that as data corrosion to be
> backfilled. **That was wrong, and it was the interesting part.** The data was
> never corrupt for a single row. The measurement that settled it is below
> under *Root cause*; the earlier wording is corrected rather than deleted
> because a future session finding "NULL value in documents.confidence" in a
> log will otherwise reach for the same wrong conclusion.

## Motivation

On 2026-08-27 `trail-engine-001` crash-looped for ~75 minutes with
`SQLITE_FULL`. The volume was 10 GB and 99.8 % full. Extending it to 20 GB
brought prod back without deleting anything.

That was the symptom. Digging into *why the disk filled* uncovered three
separate silent failures, each of which had been running for months, and
each of which was invisible for the same structural reason: **the only
thing that would have reported the failure was the failure itself.**

### Failure 1 — there was no backup. None. Anywhere.

Measured from the live manifest (`/data/backups/manifest.json`, 397 KB,
pulled off prod 2026-08-27):

```
total snapshots: 74
by status:   failed 68 · pruned-remote 5 · snapping 1
with remoteUrl: 0
first failure: 2026-06-03T01:20:44Z
last  failure: 2026-08-26T08:01:06Z
```

Every one of the 68 failures carries the same error:

```
snapshot: snapshot integrity_check != 'ok' for /data/backups/staging/<id>.db:
  [{"integrity_check":"NULL value in documents.confidence"} × 100]
```

The five `pruned-remote` entries are the only snapshots that ever reached
R2 — 9, 16, 23, 27 and 30 May — and retention has since deleted all five
from the bucket. `/data/backups/local/` is **empty**.

So, stated plainly: **until this card lands there is no recoverable backup
of either production database — not on the volume, not in R2.**
`broberg-ai/trail.db` (163 MB) and `sanne-andersen/trail.db` (31 MB) exist
in exactly one place each. The 2026-05-14 incident that wrote the `rm -rf`
rule at the top of `CLAUDE.md` was survived *only* because a 5-hour-old Fly
volume snapshot happened to fall inside the 5-day retention window. That is
the entire safety net we have been running on, and it is the one the rule
itself calls "a safety net, not a guarantee".

## Root cause — the data was fine; the guard was reading the wrong thing

Migration 0035 (F182.1, landed early June — the manifest's last success is
30 May and its first failure 3 June) ran:

```sql
ALTER TABLE `documents` ADD `confidence` real DEFAULT 0.7 NOT NULL;
```

SQLite does **not** rewrite existing rows on `ADD COLUMN`. The stored
records stay short and the default is materialised at read time. So at SQL
level everything was always correct — reproduced on a seeded DB:

```
live rows where `confidence IS NULL` : 0
SELECT DISTINCT confidence           : 0.7
PRAGMA integrity_check               : "NULL value in documents.confidence" × every old row
```

`PRAGMA integrity_check` inspects the **raw record**, finds no value where
the schema says NOT NULL, and reports a violation that does not exist at
the SQL level. `snapshotDb` treats a non-`ok` check as corruption and
refuses the snapshot.

**Which column types actually trigger it** — measured by adding one column
at a time to a seeded table:

| ALTER | integrity_check |
|---|---|
| column present at `CREATE TABLE` | `ok` |
| `integer NOT NULL DEFAULT 0` | `ok` |
| `integer NOT NULL DEFAULT 1` | `ok` |
| `integer NOT NULL DEFAULT false` | `ok` |
| `text NOT NULL DEFAULT 'cites'` | `ok` |
| **`real NOT NULL DEFAULT 0.7`** | **violation on every pre-existing row** |

Twelve columns across six tables were added by `ALTER … NOT NULL` in this
schema's history, and `documents.confidence` is the **only** `real` one.
That is why this is a one-line repair rather than a sweep, and it is why
the failure began precisely when 0035 landed and not at any of the eleven
earlier ALTERs.

Rows inserted *after* the ALTER carry the column physically and are clean —
so the violation count was frozen at "however many Neurons existed in early
June", which is also why nothing about it looked like it was getting worse.

**The fix** is to make the old rows physically carry the value:

```sql
UPDATE `documents` SET `confidence` = COALESCE(`confidence`, 0.7);
```

An UPDATE rewrites each record in full. Values do not change, re-running is
a no-op, and afterwards both the live DB and its `VACUUM INTO` copy return
exactly `ok`. Shipped as migration `0043_confidence_row_rewrite.sql`.

**The integrity check itself is NOT being relaxed.** It stays a hard gate.
Weakening it would have made the backups green again in one line while
producing snapshots of a database nobody was checking — the failure mode
this card exists to close, re-created in the fix for it.

## Why the disk filled — the causal chain nobody drew

`runBackupPass` (`apps/server/src/services/backup/pass.ts`) deliberately
leaves the staged file on disk when a pass fails, so an admin can retry
manually. Sound in isolation. But:

1. the failure is at the **snapshot** step, so what is left is the
   uncompressed `.db`
2. retention only ever prunes snapshots with status `uploaded`
3. nothing else swept staging

68 failures × ~110 MB = the **7.4 GB** of `/data/backups/staging` measured
tonight. The two `trail.db` files *combined* are 194 MB. The disk was never
a capacity problem; it was the backup failure rendered as disk space.

### Failure 2 — the disk filled with no warning

| path | size |
|---|---|
| `/data/backups/staging` | 7.4 GB |
| `/data/sanne-andersen` | 2.3 GB |
| `/data/broberg-ai` | 173 MB |
| **both `trail.db` combined** | **194 MB** |

Nothing watched the number climb from ~40 % in June to 99.8 % in August.
The first notification anyone got was users hitting a dead app.

### Failure 3 — no deploy had succeeded since 23 August, no restart since 4 July

Every deploy from 23 Aug onward failed in the Docker build on a missing
`scripts/install-hooks.sh` (fixed 2026-08-27 in both Dockerfiles). Nobody
noticed, because a failed deploy leaves the *previous* version running —
and a running app looks identical to a deployed app.

In the sanne session's words, worth keeping: **"a component that has not
been restarted in a long time is not 'stable', it is UNMEASURED."** The
engine had been up since 4 July on already-open file handles, which is
exactly why the process never noticed the disk had no room left. Two months
without a working deploy looked exactly like two months with one.

## The pattern all three share

Each failure *was* reported — to a log nobody reads, into a manifest field
nobody queries, as an exit code in a CI run nobody opened. The system was
not silent by accident: **reporting a failure into a channel with no reader
is the same as not reporting it.**

So the fix is not "add logging". Every one of these conditions must reach a
surface that is looked at *without anyone choosing to look* — the fleet's
existing alarm path (Upmetrics issues + intercom), not a new dashboard.

## Scope

### In scope

- **F212.1** — make a snapshot possible again: migration 0043, and prove a
  real backup uploads *and restores*.
- **F212.2** — a failed backup must alarm, and must not leave its staging
  file behind. Sweep the 7.4 GB already there.
- **F212.3** — disk-usage threshold alarm + deploy-freshness alarm.

### Explicit non-goals

- **Not** a new monitoring product or dashboard. Alarms ride the Upmetrics
  issue API this repo already self-services against.
- **Not** changing the backup provider, cadence, or retention policy. The
  design is fine; it has simply never run to completion since May.
- **Not** relaxing `integrity_check`, for the reason given above.
- **Not** a multi-region or PITR story. Getting *one* working nightly copy
  off the machine is the whole bar here.
- **Not** touching F182's confidence *semantics* — only the physical row
  encoding that blocks snapshots.

## Architecture sketch

```
lint-scheduler ──▶ runBackupPass ──▶ snapshotDb ──▶ integrity_check
                        │                              │ throws
                        │                              ▼
                        │                    [F212.2] alarm + unlink staged file
                        ▼
                   provider.upload ──▶ R2 ──▶ manifest status='uploaded'
                        │
                        └── [F212.2] no 'uploaded' in 48 h ⇒ Upmetrics issue

boot + hourly ──▶ [F212.3] statfs(/data) ⇒ >80 % warn, >90 % critical
build/deploy  ──▶ [F212.3] F196 deploy self-report; no success in 14 d ⇒ issue
```

The disk check is `statfs` on the data dir — cheap, no shell-out, and it
reads the *filesystem* rather than a cached number, so it cannot be fooled
by an already-open file handle the way the running process was.

## Dependencies

- **F153** — the backup pass, manifest, provider and retention this builds
  on. All present; none of it is being redesigned.
- **F182** — owns the `documents.confidence` column whose physical encoding
  0043 repairs.
- **F196** (in progress) — deploy self-report to Upmetrics. F212.3's
  deploy-freshness alarm consumes F196's signal rather than inventing a
  second one; if F196 has not landed, it falls back to the Fly release list.

## Rollout

1. **A manual Fly volume snapshot first** — taken 2026-08-27 before any
   write, because it is currently the only copy that exists.
2. F212.1, alone: deploy 0043, then run a real backup pass and prove the
   uploaded artefact **restores**.
3. F212.2, so the *next* breakage is loud rather than found three months
   later.
4. F212.3 last; cheapest, and least urgent now the volume has headroom.

No cutover and no naked replacement: the existing backup path keeps running
throughout, and F212.1 is proven by a restore, not by a green log line.

## Verification

`apps/server/scripts/verify-f212-1.ts` reproduces the production sequence
faithfully — seed rows are written *before* 0035 runs, exactly as they were
in prod — then asserts, with strict equality against `['ok']` rather than a
substring match:

```
PASS  1 · the data was never wrong — every seeded row reads 0.7
PASS  1b · and no row matches `confidence IS NULL`
PASS  2 · NEGATIVE CONTROL — without 0043 the snapshot guard still refuses the DB
      (arm A integrity_check: 25 violation(s): NULL value in documents.confidence)
PASS  3 · with 0043 the live DB passes
PASS  5 · the repair changed no value
PASS  4 · the VACUUM copy — the actual backup artefact — passes
PASS  4b · and the copy holds every row
```

Mutation-checked: replacing 0043's body with `SELECT 1` turns checks 3 and
4 red (25 violations each) while the negative control stays green — so the
suite discriminates "the repair ran" from "the migration file exists".

Strict equality matters here specifically: the failure output is a
100-element array, and a `contains 'ok'` assertion would pass on it.

## Open question for the owner

The 7.4 GB of failed staging copies are snapshots that were refused at the
integrity gate and never uploaded; they are not usable as backups. F212.2
proposes deleting them. **That is a destructive action on a prod volume and
needs Christian's direct order** — until then they stay, and the extended
20 GB volume absorbs them.
