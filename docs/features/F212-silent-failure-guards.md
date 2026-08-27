# F212 — Silence is not health: backups have failed for 3 months, and nothing said so

**Status:** ready · **Priority:** critical · **Opened:** 2026-08-27

## Motivation

On 2026-08-27 `trail-engine-001` crash-looped for ~75 minutes with
`SQLITE_FULL`. The volume was 10 GB and 99.8 % full. Extending it to 20 GB
brought prod back without deleting anything.

That was the symptom. Digging into *why the disk filled* uncovered three
separate silent failures, each of which had been running for months, and
each of which was invisible for the same structural reason: **the only
thing that would have reported the failure was the failure itself.**

### Failure 1 — there is no backup. None. Anywhere.

Measured from the live manifest (`/data/backups/manifest.json`, 397 KB,
pulled off prod 2026-08-27):

```
total snapshots: 74
by status:   failed 68 · pruned-remote 5 · snapping 1
with remoteUrl: 0
first failure: 2026-06-03T01:20:44Z
last  failure: 2026-08-26T08:01:06Z
```

Every single one of the 68 failures carries the same error:

```
snapshot: snapshot integrity_check != 'ok' for /data/backups/staging/<id>.db:
  [{"integrity_check":"NULL value in documents.confidence"} × 100]
```

The five `pruned-remote` entries are the only snapshots that ever reached
R2 — 9 May, 16 May, 23 May, 27 May, 30 May — and retention has since
deleted all five from the bucket. `/data/backups/local/` is **empty**.

So the honest statement of where we stand: **as of tonight there is no
recoverable backup of either production database — not on the volume, not
in R2.** `broberg-ai/trail.db` (163 MB) and `sanne-andersen/trail.db`
(31 MB) exist in exactly one place each. The 2026-05-14 incident that
wrote the `rm -rf` rule at the top of `CLAUDE.md` was survived *only*
because a 5-hour-old Fly volume snapshot happened to be inside the 5-day
retention window. That is the entire safety net we are running on today,
and it is the one the rule itself calls "a safety net, not a guarantee".

**Root cause of the snapshot failure** — `packages/db/src/schema.ts:229`
declares `confidence: real('confidence').notNull().default(0.7)` (F182),
but rows in the live `documents` table hold `NULL` in that column.
`VACUUM INTO` copies them faithfully, then `PRAGMA integrity_check` on
the copy correctly reports a NOT NULL violation, and `snapshotDb` throws.
The check is doing its job; the data is wrong. Whether the NULLs arrived
via the F182 migration or via a write path that bypasses the default is
**not yet established** — that is F212.1's first job, and it must be
answered before anything backfills, because a backfill that papers over a
still-live NULL-writing code path just resets the same clock.

**Root cause of the disk filling** — `runBackupPass` deliberately leaves
the staged `.db.gz` on disk when a pass fails ("the admin can retry
manually", `apps/server/src/services/backup/pass.ts`). Sound in
isolation. But the failure is at the *snapshot* step, so what is left
behind is the uncompressed `.db`, retention only ever prunes `uploaded`
snapshots, and nothing ever swept them. 68 failures × ~110 MB = the
**7.4 GB** of `/data/backups/staging` measured tonight.

### Failure 2 — the disk filled with no warning

Measured on the volume before the extend:

| path | size |
|---|---|
| `/data/backups/staging` | 7.4 GB |
| `/data/sanne-andersen` | 2.3 GB |
| `/data/broberg-ai` | 173 MB |
| **both `trail.db` combined** | **194 MB** |

Nothing watched the number climb from ~40 % in June to 99.8 % in August.
The first notification anyone got was users hitting a dead app.

### Failure 3 — no deploy had succeeded since 23 August, and no restart since 4 July

Every deploy from 23 Aug onward failed in the Docker build on a missing
`scripts/install-hooks.sh` (fixed tonight in both Dockerfiles). Nobody
noticed, because a failed deploy leaves the *previous* version running —
and a running app looks identical to a deployed app.

Worth keeping in the words the sanne session put it in: **"a component
that has not been restarted in a long time is not 'stable', it is
UNMEASURED."** The engine had been up since 4 July on already-open file
handles, which is precisely why it never noticed the disk had no room
left. Two months without a working deploy looked exactly like two months
with one.

## The pattern all three share

Each failure was *reported* — to a log nobody reads, into a manifest
field nobody queries, as an exit code in a CI run nobody opened. The
system was not silent by accident; it was silent because **reporting a
failure into a channel with no reader is the same as not reporting it.**

So the fix is not "add logging". It is: every one of these conditions
must reach a surface that is looked at *without anyone choosing to look*
— the fleet's existing alarm path (Upmetrics issues + intercom), not a
new dashboard.

## Scope

### In scope

- **F212.1** — make a snapshot possible again: establish where the NULLs
  come from, close the write path if one is open, backfill the column,
  and prove a real end-to-end backup reaches R2 and restores.
- **F212.2** — a failed backup must alarm, and must not leave its
  staging file behind. Sweep the 7.4 GB already there.
- **F212.3** — disk-usage threshold alarm + deploy-freshness alarm.

### Explicit non-goals

- **Not** a new monitoring product or dashboard. Alarms ride the
  Upmetrics issue API this repo already self-services against.
- **Not** changing the backup provider, cadence, or retention policy.
  The design is fine; it has simply never run to completion since May.
- **Not** a multi-region or PITR story. Getting *one* working nightly
  copy off the machine is the whole bar here.
- **Not** touching the F182 confidence *semantics* — only the NOT NULL
  data integrity that blocks snapshots.

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
build/deploy   ──▶ [F212.3] F196 deploy self-report; no success in 14 d ⇒ issue
```

The disk check is `statfs` on the data dir — cheap, no shell-out, and it
reads the *filesystem*, not a cached number, so it cannot be fooled by an
already-open file handle the way the running process was.

## Dependencies

- **F153** — the backup pass, manifest, provider and retention this
  builds on. All present; none of it is being redesigned.
- **F182** — owns the `documents.confidence` column whose NOT NULL
  constraint is violated.
- **F196** (in progress) — deploy self-report to Upmetrics. F212.3's
  deploy-freshness alarm consumes F196's signal rather than inventing a
  second one; if F196 has not landed, F212.3 falls back to reading the
  Fly release list.

## Rollout

1. F212.1 first and alone — a working backup is the prerequisite for
   safely touching anything else on that volume.
2. F212.2 next, so the *next* breakage is loud rather than discovered
   three months later.
3. F212.3 last; it is the cheapest and the least urgent now that the
   volume has headroom.

No cutover, no naked replacement: the existing backup path keeps running
throughout, and F212.1 is proven by a restore, not by a green log line.

## Open question for the owner

The 7.4 GB of failed staging copies are corrupt snapshots of a database
whose NOT NULL constraint was already violated — they are not usable as
backups. F212.2 proposes deleting them. **That is a destructive action on
a prod volume and needs Christian's direct order**; until then they stay,
and the extended 20 GB volume absorbs them.
