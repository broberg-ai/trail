# F168 — Beam: tenant-level KB copy between Trail engines

**Status:** Planned · **Phase:** 1 · **Owner:** trail-server · **Drives:** none

## TL;DR

"Beam me up, Scotty." **Copy** (not move) a complete KB — trail.db
file + all upload blobs — from one Trail engine to another. Local
data is never touched; re-beams push updates to remote later. Used
(a) to seed Sanne's Fly engine from Christian's local
`127.0.0.1:58031` workbench tonight, and (b) to migrate tenants
between engines as the F170 orchestrator rebalances the fleet.

The CMS already uses "Beam" for the same shape of operation. F168
keeps the name and metaphor for consistency across the WebHouse
ecosystem.

**Tonight's reality** (based on Sanne's actual corpus): 91 documents,
325 image rows, **~325 MB** on disk. That fits in a single tar
archive shipped over Fly's SSH/SFTP channel in <60 s. The plan-doc's
original HTTP/Hono streaming architecture is overkill for the first-
customer onboard; we use SSH+SFTP for tonight, keep the HTTP endpoint
on the roadmap for F170 inter-engine migration where a tenant might
be 10 GB and engine-to-engine without a human in the loop.

## Motivation

- **Tonight's gate:** Sanne's local trail.db (containing months of
  curator work) must end up on the production engine before her
  website's Eir chat can use it. Manual `scp` + ad-hoc volume copy
  is fragile and unrepeatable.
- **Onboarding pattern:** Christian's intent is "ingest locally, then
  beam to prod" — local 127.0.0.1:58031 stays the authoring
  workbench. Each new customer is a "load corpus locally → beam"
  flow, not "build directly in prod".
- **F170 dependency:** the multi-engine orchestrator needs a robust
  primitive to move a tenant from engine-001 to engine-002 when
  rebalancing. F168 is that primitive.

## Scope (in)

### 1. CLI — `pnpm trail beam`

```bash
# Export a tenant to a tar.gz on local disk
pnpm trail beam export \
  --tenant sanne-andersen \
  --out /tmp/sanne-andersen.beam.tar.gz \
  --from-db data/trail.db \
  --from-uploads data/uploads/t-christian/

# Import a beam file onto a remote engine
pnpm trail beam import \
  --file /tmp/sanne-andersen.beam.tar.gz \
  --to https://engine-001.trailmem.com \
  --token "$BEAM_TOKEN"

# One-shot: export + upload + import (no intermediate file)
pnpm trail beam ship \
  --tenant sanne-andersen \
  --to https://engine-001.trailmem.com \
  --token "$BEAM_TOKEN"

# Verify a beamed tenant on the remote engine
pnpm trail beam verify \
  --tenant sanne-andersen \
  --to https://engine-001.trailmem.com \
  --token "$BEAM_TOKEN"
```

Defaults pulled from local config (`apps/server/.env` /
`TRAIL_LOCAL_DB`, `TRAIL_LOCAL_UPLOADS`).

### 2. Beam file format — `*.beam.tar.gz`

Tar archive containing:

```
manifest.json                 # version, tenant_slug, schema_version, row_counts, sha256 of trail.db
trail.db                      # tenant's full SQLite file (single-tenant filtered, see #3)
uploads/{kb-id}/{doc-id}/...  # every blob owned by this tenant
trail.db.sha256               # checksum for integrity check after transport
```

Manifest schema:

```json
{
  "beam_version": 1,
  "trail_schema_version": 26,
  "tenant_slug": "sanne-andersen",
  "tenant_id": "t-christian",
  "exported_at": "2026-04-29T01:42:00Z",
  "exported_by": "christian@webhouse.dk",
  "source_engine": "127.0.0.1:58031 (local)",
  "row_counts": {
    "knowledge_bases": 1,
    "documents": 247,
    "document_images": 159,
    "chunks": 1843
  },
  "trail_db_bytes": 36123456,
  "uploads_total_bytes": 524288000,
  "uploads_file_count": 308
}
```

### 3. Export semantics — single-tenant filtering

The local `data/trail.db` may contain multiple tenants
(Christian's own dev/test KBs alongside Sanne's). The export filters
to a single tenant:

```sql
-- For every table with a tenant_id column, copy ONLY rows matching
-- the requested tenant. For dependent tables without tenant_id
-- (chunks, audit, document_images, etc.), follow FKs from filtered
-- parents.

ATTACH DATABASE '/tmp/sanne-andersen.db' AS export_db;

INSERT INTO export_db.tenants SELECT * FROM tenants WHERE id = ?;
INSERT INTO export_db.users SELECT * FROM users WHERE tenant_id = ?;
INSERT INTO export_db.knowledge_bases SELECT * FROM knowledge_bases WHERE tenant_id = ?;
INSERT INTO export_db.documents SELECT * FROM documents WHERE tenant_id = ?;
INSERT INTO export_db.document_images
  SELECT di.* FROM document_images di
  JOIN documents d ON d.id = di.document_id
  WHERE d.tenant_id = ?;
INSERT INTO export_db.chunks
  SELECT c.* FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE d.tenant_id = ?;
-- etc. for jobs, audit, wiki_backlinks, vision_quality_ratings, …
```

**FTS rebuild after import** — `documents_fts` is a contentless FTS5
table populated by triggers. After import we run
`INSERT INTO documents_fts(documents_fts) VALUES('rebuild')` to
regenerate the index from the imported documents.

### 4. Upload-blobs filter

Uploads on disk are organized as
`{TRAIL_UPLOADS_ROOT}/{tenant-id}/{kb-id}/{doc-id}/...`. Export tars
**only the slice under the source tenant's id**, then renames the
top-level directory in the tar to use the destination tenant's id
(usually the same — but Beam keeps the option open if a tenant gets
renamed).

### 5. Import endpoint on the engine

```
POST /internal/beam/import
  Headers:
    Authorization: Bearer <BEAM_TOKEN>   (machine-to-machine, env-only)
    Content-Type:  application/gzip
    X-Beam-Tenant: sanne-andersen
  Body: streaming tar.gz

Response 200:
  { "imported": true, "tenant_slug": "sanne-andersen",
    "rows": {…}, "uploads": 308 }
Response 400/409:
  { "error": "tenant already exists, use ?force=true to replace" }
Response 401:
  { "error": "invalid beam token" }
```

Engine writes to a staging path
(`/data/_staging/{slug}-{nonce}/`), validates manifest, verifies
sha256, runs FTS rebuild, then atomically renames staging →
`/data/{slug}/`. If anything fails, staging is removed and the
existing tenant directory is untouched.

### 6. `BEAM_TOKEN` — m2m auth

Random 64-byte hex secret, set via `flyctl secrets set BEAM_TOKEN=…`
on every engine. Different from Bearer keys (which are tenant-scoped
public-API auth); BEAM_TOKEN is admin-only and never leaves env vars.
Christian's local `.env` holds a copy for invoking `pnpm trail beam`.

Rotated quarterly via `pnpm trail engine rotate-beam-token` in F169
or F170.

### 7. Verify subcommand

`pnpm trail beam verify --tenant sanne-andersen --to <engine>` does:

1. Calls `/internal/beam/manifest?tenant=sanne-andersen` on remote
   engine (returns row counts + checksums of remote tenant.db).
2. Compares to local manifest.
3. Reports diff: row count deltas per table, byte-diff on trail.db,
   missing/extra upload blobs.
4. Exit 0 if clean, 1 if mismatch.

Used post-import as smoke test, and pre-migration in F170 to confirm
target is empty.

### 8. Force-replace flag

`?force=true` on the import endpoint allows overwriting an existing
tenant on the destination. Default behaviour is 409. Used during
re-beams (Phase 1B per Christian: "ingest færdigt lokalt, beam en
gang, slet lokalt").

When force=true, the existing tenant directory is moved to
`/data/_archive/{slug}-{timestamp}/` rather than deleted. Manual
cleanup later. Defensive against accidental data loss.

## Scope (out / explicit non-goals)

- **Multi-tenant beam in one shot.** F168 exports ONE tenant. To move
  multiple tenants, run beam multiple times. Keeps the manifest
  shape simple.
- **Incremental / delta beam.** Every beam is a full replacement.
  Incremental sync (e.g. "only documents added since last beam") is
  a future feature if/when re-beam becomes a regular workflow. For
  now, "beam once and stop ingesting locally" is the supported pattern.
- **Cross-schema-version beam.** Source and destination must have
  the same `trail_schema_version`. If destination is behind, run
  migrations first. Beam refuses cross-version transfer in v1.
- **In-flight job migration.** Background jobs (F164) in `running`
  state on the source are NOT migrated. Beam asserts no jobs are
  running before export; user must wait for queue to drain or abort
  jobs first.
- **Vision quality ratings as portable artefacts.** Ratings are
  per-user per-image and travel with the tenant. They go in the beam.
- **Beam-to-cloud-storage.** F168 ships engine-to-engine. R2/S3
  storage of beam files is F153's job (continuous backup), not F168.

## Architecture sketch

### Export side (local CLI)

```
pnpm trail beam export --tenant sanne-andersen
                ↓
       Open data/trail.db read-only
                ↓
       Snapshot to /tmp/{slug}-{nonce}.db via VACUUM INTO
                ↓
       Filter tenant rows in the snapshot (DELETE WHERE tenant_id != ?)
                ↓
       Compute trail.db sha256
                ↓
       Tar:
         manifest.json
         trail.db
         trail.db.sha256
         uploads/<tenant_id>/...
                ↓
       gzip → /tmp/{slug}.beam.tar.gz
```

### Import side (engine HTTP endpoint)

```
POST /internal/beam/import
                ↓
  Validate BEAM_TOKEN
                ↓
  Stream tar.gz → /data/_staging/{slug}-{nonce}/
                ↓
  Read manifest.json
                ↓
  Verify trail_schema_version matches engine's expectation
                ↓
  Verify trail.db sha256 matches manifest
                ↓
  FTS rebuild on staged trail.db (contentless FTS5 needs it)
                ↓
  atomically rename staging → /data/{slug}/
  (existing /data/{slug}/, if any and force=true, → /data/_archive/{slug}-{ts}/)
                ↓
  Bust the engine's tenant-resolver cache for this slug
                ↓
  Return 200 with row counts
```

### Key invariants

- **Atomic on destination.** Failure mid-import never leaves a
  half-imported tenant. Either the rename happens or nothing changes.
- **Idempotent at the manifest level.** Re-importing an identical
  beam (same sha256) returns "already current" instead of replacing.
- **No concurrent beams per slug.** Engine takes a per-slug
  `/data/_locks/{slug}.lock` for the duration of import. Second import
  of same slug 409s.
- **Bearer keys survive.** Keys live in admin's `control.db`, not in
  per-tenant trail.db (per F33). Beaming tenant data does not touch
  keys; Sanne's website keeps using its existing Bearer after the beam.

## Dependencies

- **F33** — control plane + multi-tenant routing must exist before Beam
  is useful. Beam without F33 is just `scp`.
- **No new third-party deps.** `tar`, `zlib` from Node stdlib; sha256
  via `node:crypto`; SQLite VACUUM INTO is built into libSQL.

## Rollout

### Phase 1 (TONIGHT — concurrent with F33 Phase 1A)

1. CLI implementation (`apps/cli/beam.ts` or
   `apps/server/scripts/beam.ts`).
2. `/internal/beam/import` endpoint on engine (gated on `BEAM_TOKEN`).
3. `/internal/beam/manifest` endpoint for verify.
4. Verify-script: round-trip a tiny synthetic tenant export+import
   and assert checksums + row counts match.
5. Real run: beam Sanne to engine-001, verify, smoke-test chat.

### Phase 2 (when F170 lands)

1. Engine-to-engine beam: source = remote engine, not local CLI.
   Source engine exposes `/internal/beam/export?tenant=…&token=…`
   that streams the same tar.gz to the calling engine. Used by
   F170's `pnpm trail tenant migrate` command.

### Phase 3 — pull mode (engine → local dev sync)

**Why**: Sanne's prod-engine accumulates Neurons compiled from
sources Christian uploaded via `app.trailmem.com`. When Christian
wants to switch back to local-dev mode (Max-plan claude-cli for
heavy ingest), his local trail.db is behind. He can't bare-copy
the prod DB because local is multi-tenant single-file
(`/data/trail.db` shared by ALL his KBs across all his tenants),
while prod is per-tenant (`/data/{slug}/trail.db` isolated).

**CLI**: `pnpm trail beam pull --app trail-engine-001 --tenant-slug sanne-andersen --kb-id 6aa52746-... [--dry-run] [--skip-uploads]`

**Steps**:
1. `flyctl ssh sftp` pulls `/data/{slug}/trail.db` to
   `/tmp/beam-pull-{slug}-{ts}/trail.db` (read-only staging copy).
2. Open staging DB read-only + local DB read-write.
3. For each MERGE-eligible table (filtered by `knowledge_base_id`
   matching the target KB-id, since KB-ids are stable across
   beam-push), SELECT prod rows + INSERT-OR-REPLACE into local.
   Tables: `documents`, `chunks`, `document_images`,
   `wiki_backlinks`, `document_references`, `broken_links`,
   `vision_quality_ratings`, `wiki_events`, `activity_log`.
4. Tenant-id rewrite: prod `t-{slug}` → local owner-tenant
   (default `t-christian`; configurable via `--target-tenant`).
5. User-id rewrite: any user-id that doesn't exist locally falls
   back to `service-ingest` (the INGEST_USER_ID seed). Curator-
   authored events keep their `actor_kind` for audit.
6. Skipped tables (operational/local-only — never sync):
   `queue_candidates` (curator-pending state),
   `sessions` + `api_keys` (per-environment auth),
   `ingest_jobs` (operational), `chat_sessions`/`chat_turns`
   (chat is per-environment), `tenant_credits` (separate
   billing per env).
7. `rsync` (or sftp-recursive) `/data/{slug}/uploads/` →
   `~/Apps/broberg/trail/data/uploads/{tenant-id-local}/{kb-id}/`.
   Skipped when `--skip-uploads` (text-only sync for fast iteration).
8. FTS5 rebuild on the affected KB. Not full-DB rebuild — use
   `INSERT INTO documents_fts(documents_fts, rowid, ...)` per row.
9. Print summary: rows inserted, rows updated, uploads transferred.

**Idempotent**: re-running pull with no prod changes produces zero
inserts/updates (INSERT OR REPLACE on identical content is a no-op
at the rowid+content level; cheap to re-run frequently).

**Implementation note**: keeps `apps/server/scripts/beam.ts`
unchanged (push-direction stays a one-shot script per Phase 1).
Pull-mode lives in a new `beam-pull.ts` so the two flows can
evolve independently. A unified `beam.ts` with `push|pull` sub-
commands is a Phase 4 cleanup if both paths stabilise.

## Open questions

- **Beam streaming vs filesystem-staging.** Streaming would be lower
  RAM footprint for huge tenants. Phase 1 uses filesystem staging
  (simpler, easier to debug); Phase 2 may switch to true streaming if
  any tenant approaches multi-GB size.
- **What happens to local data after a successful beam-and-verify?**
  Phase 1 leaves it alone (Christian decides when to delete his local
  copy). Future: `pnpm trail beam ship --then-archive` that moves the
  local tenant to `data/_archived/{slug}-{ts}/`.

## Verification plan

`apps/server/scripts/verify-f168-beam.ts`:

1. **Round-trip on synthetic tenant**: create a tiny in-memory tenant
   with 3 docs + 5 images, export, import to a fresh DB, assert row
   counts + sha256 match.
2. **Multi-tenant filtering**: create two tenants in source DB, beam
   one, assert imported DB has zero rows from the other.
3. **Force-replace**: import once, modify destination, import again
   with `?force=true`, assert second import wins and old data lands
   in `_archive/`.
4. **Schema-version mismatch**: stub a v25 manifest against v26
   engine, assert 400 response.
5. **Lock behaviour**: spawn two concurrent imports for same slug,
   assert second one 409s without partial-state.
