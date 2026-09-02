# F217 — how big is this Trail?

**Card:** trail-F217 · epic · high

> Owner, 2 September 2026: *"Du skal sætte en MB størrelse på hver trail så det
> er til at se hvor meget den fylder, inkl. alt i dens DB og kilderne og
> billederne."*

## Why the question is worth asking

Measured on production before designing anything:

| | total | trail.db | uploads |
|---|---|---|---|
| `/data` | **2.5 GB** | | |
| sanne-andersen | 2.3 GB | 32 MB | **2.2 GB** |
| broberg-ai | 180 MB | **169 MB** | 4 KB |

Two tenants, opposite shapes. One is almost entirely files; the other almost
entirely database. **A feature that measures only one half is right about one
tenant and wrong about the other.**

## The good news: it is attributable

- `documents.file_size` is populated on **every** source. Across all 10 KBs in
  broberg-ai: 161 sources, **zero** with `file_size = 0`. Not a default nobody
  filled in — a real measurement already being taken.
- `document_images.size_bytes` carries `knowledge_base_id` → images attribute
  directly.
- On disk: `uploads/<tenant-prefix>/<kb-id>/…` → the filesystem is per-KB too.
- Compiled knowledge: `sum(length(content))` over non-source documents — 6,349
  Neurons, 15.9 MB in broberg-ai.

## The trap, and it is the whole design

**The database over-reports.** Sampled 400 image rows in broberg-ai:

```
DB claims              501.3 MB
found on disk            0.0 MB
rows whose file exists   0 of 400
```

Their `storage_path` begins `t-christian/…` — a tenant prefix that no longer
exists under `/data`. Orphans, most likely fallout from the **2026-05-14**
incident CLAUDE.md documents (an `rm -rf` that wiped every child of `/data`), or
from a tenant rename.

A plain `SUM(size_bytes)` would tell the owner a Trail holds 604 MB of images
when the bytes are gone. **A confidently wrong number is worse than no number** —
he would plan storage, or delete something, against a phantom.

**And `du` per tenant lies in the other direction.** Every upload lives under
`/data/sanne-andersen/uploads/`, including broberg-ai's (`t-broberg-ai/` = 76 KB
there). The physical layout does not follow the tenant folders, so measuring a
tenant directory does not measure that tenant.

**Two independent sources, each wrong on its own.** Same shape as everything else
this week — except here it decides the architecture instead of being a footnote.

## Design

Report **claimed** and **present** as separate facts, and show the difference
only when there is one:

```
Sanne Andersen        2.24 GB      21 sources · 318 images · 412 Neurons
Development Tester     117 MB      23 sources
Trail Research         9.2 MB      82 sources
  ⚠ 501 MB of image records point at files that are gone
```

The warning line is not decoration. It is the difference between "this Trail is
large" and "this Trail's records are wrong", and only the owner can decide what
to do about the second.

## Non-goals

- **Not deleting the orphans.** Finding them is this epic's job; deciding their
  fate is the owner's. A size feature that quietly deletes data is not a size
  feature.
- Not a quota or a limit. Show the number first; policy is a later decision taken
  with the number in hand.
- Not per-file detail. The unit the owner asked for is the Trail.

## Verification

The negative control is load-bearing in **both** directions:

1. A KB whose files are all present must show **claimed == present**, with no
   warning. Otherwise "hide everything behind a caveat" would pass the orphan
   test while making the feature useless.
2. A KB with orphans must not report their bytes as present — asserted on the
   real production case, not a fixture.

And the mutation that matters: sum `size_bytes` without the on-disk check, and
the phantom **501 MB** appears in the failure output. That number is the proof
that the check is doing something.

## A method note, kept on purpose

My first check reported "161 of 161 sources missing on disk". **That was my
error** — `documents.path` is the WIKI path (`/`), not a filesystem path. The
image finding is real and re-measured; the source one measured the wrong field.

Recorded here so nobody re-derives the wrong alarm from this card. A precise
measurement of the wrong object looks exactly like a precise measurement.
