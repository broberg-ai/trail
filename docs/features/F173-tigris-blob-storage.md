# F173 — Tigris-backed blob storage (S3 driver for `@trail/storage`)

**Status:** Planned · **Phase:** 1 · **Owner:** trail-server · **Drives:** F170

## TL;DR

Trail's image and source-PDF blobs currently live on the engine's
Fly volume — the same volume that holds trail.db. At Fly's
volume pricing ($0.15/GB/mo with snapshots), this is **10× more
expensive** than object storage and forces manual `fly volumes
extend` as tenants grow. F173 routes blob reads/writes through
**Tigris** (Fly's native S3-compatible object store) so engines
need only a 1-2 GB volume for trail.db itself, while bytes scale
infinitely at $0.020/GB/mo.

Storage architecture is already abstraction-ready
(`packages/storage/src/index.ts`'s `Storage` interface explicitly
notes "Phase 2 will add Cloudflare R2 / S3 implementations behind
the same interface"). F173 is the implementation.

Bonus: F170 inter-engine tenant migration becomes ~100× faster
because we copy only the SQLite file — blobs stay in Tigris and
the storage_path values in document_images keep pointing at them.

## Motivation

| | At 10 GB | At 100 GB | At 1 TB |
|---|---|---|---|
| Fly volume | $1.88/mo | $18.75/mo | $187/mo |
| Tigris standard | $0.20/mo | $2.00/mo | $20/mo |
| Cloudflare R2 | $0.15/mo | $1.50/mo | $15/mo |

For a fleet of 10 tenants × 10 GB blobs each:
- Volume-only: $19/mo × N engines
- Tigris-backed: $2/mo total (object storage) + $0.30/mo per engine (1 GB volume for trail.db)

The slope only steepens. Tigris is also cross-engine accessible —
when F170 migrates a tenant from engine-001 to engine-002, only
the trail.db file moves; blobs are untouched. With volume-storage
F170 has to physically copy GB of bytes between machines.

## Why Tigris over Cloudflare R2

Both are valid. Tigris wins narrowly:

- **Same Fly datacenter** (`arn`) → 0 ms latency from engines.
  R2 sits on Cloudflare edge → small but non-zero hop.
- **Auto-mounted credentials** on Fly apps via
  `fly storage create` — sets `AWS_*` env vars without manual
  secrets management.
- **Simpler pricing model** — single per-GB rate; no Class A/B
  operation tiers (R2 has $4.50/M writes + $0.36/M reads in
  addition to the storage rate).
- **Native to Fly's infra** — same support team, same billing,
  one fewer vendor.

Drawbacks:
- Newer than R2; less battle-tested.
- Mild Fly lock-in. Migrating off Fly later means moving blobs
  to a different bucket. The S3 API compatibility makes this
  mechanical, not architectural.

R2 stays the documented fallback if Tigris ever has a stability
issue. The `@trail/storage` interface makes the swap trivial.

## Scope (in)

### 1. New `packages/storage/src/s3.ts` — S3Storage class

Implements the existing `Storage` interface against any
S3-compatible endpoint. Key implementation points:

```typescript
export interface S3StorageOptions {
  endpoint: string;        // 'https://fly.storage.tigris.dev'
  region: string;          // 'auto' for Tigris
  bucket: string;          // 'trail-engine-001-blobs'
  accessKeyId: string;     // AWS_ACCESS_KEY_ID env
  secretAccessKey: string; // AWS_SECRET_ACCESS_KEY env
  /** When true, signedUrl returns presigned GET URLs that bypass
   *  the engine's proxy. When false (default), signedUrl returns
   *  a Trail-internal proxy URL that the engine resolves via .get().
   *  Default false because audience-filter (F161) needs the engine
   *  in the loop on every read; presigned URLs leak access. */
  enablePresignedUrls?: boolean;
}

export class S3Storage implements Storage {
  put(path, data, contentType) {
    return this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: path, Body: data, ContentType: contentType,
    }));
  }
  get(path) { /* GetObjectCommand → Uint8Array */ }
  delete(path) { /* DeleteObjectCommand */ }
  exists(path) { /* HeadObjectCommand */ }
  signedUrl(path, expiresSec = 300) {
    if (!this.enablePresignedUrls) {
      return `${process.env.PUBLIC_BASE_URL}/api/v1/blob/${path}`;
    }
    return getSignedUrl(this.client, new GetObjectCommand({...}), { expiresIn });
  }
  list(prefix) { /* ListObjectsV2Command, paginated */ }
}
```

Uses `@aws-sdk/client-s3` (already in `apps/server/package.json`).

### 2. Storage driver selection at boot

`apps/server/src/lib/storage.ts` becomes:

```typescript
import { LocalStorage, S3Storage, type Storage } from '@trail/storage';

const driver = process.env.TRAIL_STORAGE_DRIVER ?? 'local';

export const storage: Storage = driver === 's3'
  ? new S3Storage({
      endpoint: process.env.AWS_ENDPOINT_URL_S3 ?? 'https://fly.storage.tigris.dev',
      region: process.env.AWS_REGION ?? 'auto',
      bucket: process.env.TRAIL_BLOB_BUCKET!,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    })
  : new LocalStorage(process.env.TRAIL_DATA_DIR ?? './data');
```

Local dev keeps `TRAIL_STORAGE_DRIVER=local` (default). Engines on
Fly set `TRAIL_STORAGE_DRIVER=s3` + the bucket name; AWS_* vars
auto-mount via `fly storage create`.

### 3. Storage path normalization

Today `storage_path` values look like:
```
t-christian/6aa52746-d235-464c-b038-d7e1965e3622/f0332c14-…/page-3-img-2.png
```

That's already S3-key-shaped (slash-separated, no leading slash).
**No schema migration needed** — the same paths work as Tigris keys.

### 4. Migration script for existing engines

`apps/server/scripts/migrate-blobs-to-tigris.ts`:

1. Iterate every blob under `${TRAIL_DATA_DIR}/uploads/`
2. For each file: `s3.put(relativePath, readFileSync(absPath), inferContentType)`
3. Verify upload via `s3.exists(relativePath)`
4. Once all uploaded + verified: optionally delete local copy

Idempotent — re-running just re-uploads any files that didn't make
it. Doesn't touch `document_images.storage_path` because the path
shape is unchanged.

### 5. Bucket per engine vs. shared bucket?

**Decision: bucket per engine.** Reasons:
- Bucket-level credential isolation — engine-001's keys can't read
  engine-002's blobs. Defense-in-depth even though our auth is
  Bearer-key-based.
- Easier capacity tracking via `fly storage list` (per-bucket size
  reported).
- Tenant migration via F170 needs cross-bucket copy if buckets are
  per-engine. That's a one-time `s3 cp s3://eng-001/... s3://eng-002/...`
  inside the migration command — same network, fast.

Naming: `trail-{engine-id}-blobs`, e.g. `trail-engine-001-blobs`.

Alternative considered: one shared bucket with `{engine-id}/` prefix
per engine. Rejected: harder to revoke per-engine, and Tigris pricing
is per-bucket flat (no benefit to merging).

### 6. F169 spawn integration

`pnpm trail engine spawn engine-NNN` must also create the engine's
Tigris bucket. Add to F169's flow:

```bash
# Before deploy:
fly storage create --org broberg-ai \
  --name trail-engine-{NNN}-blobs \
  --app trail-engine-{NNN}
# This sets AWS_* secrets on the app automatically.
```

`fly storage create` (Fly CLI ≥ 0.4.x) does the create-bucket +
mint-credentials + set-secrets dance in one call.

### 7. Local dev unchanged

`TRAIL_STORAGE_DRIVER=local` (default) keeps Christian's
`127.0.0.1:58031` workbench writing to `data/uploads/...` exactly as
today. No double-write, no drift. Beam (F168) reads from local fs as
before; the import side handles whatever destination driver is set
on the receiving engine.

## Scope (out / explicit non-goals)

- **Full S3 API surface.** We implement what `Storage` exposes
  (put/get/delete/exists/signedUrl/list). Tigris-specific features
  (versioning, lifecycle rules, multi-region replication) are out.
- **Per-tenant bucket isolation.** Tenants share their engine's
  bucket — isolation is path-prefix only. Future feature if a
  customer demands hard isolation; not blocking common case.
- **Direct browser uploads.** Sources still upload through the engine
  (POST /api/v1/.../upload), then the engine writes to Tigris. We
  don't issue presigned PUT URLs to the browser for direct upload.
  That's a separate optimization.
- **Replacing F153 (R2 backup).** F153 backs up trail.db to a
  separate disaster-recovery bucket; F173 is operational blob
  storage. Different purposes; coexist.
- **Replacing local dev with Tigris.** Solo-dev keeps fs.

## Architecture sketch

```
                     Engine-001 (Fly machine)
                              │
                ┌─────────────┴─────────────┐
                │                           │
        /data volume (1 GB)           Tigris bucket
        ──────────────────           trail-engine-001-blobs
        sanne-andersen/             ──────────────────────
          trail.db (~50 MB)          t-sanne-andersen/
        customer-002/                  6aa52746-…/
          trail.db (~80 MB)              f0332c14-…/
        customer-003/                      page-1-img-1.png
          trail.db (~30 MB)                page-3-img-2.png
                                           …
                                       (any other docs)
                                     t-customer-002/
                                       …

   Volume holds: trail.db only.
   Bucket holds: every blob — images, source PDFs, anything via storage.put().
```

### Key invariants

- **storage_path is content-addressed** — same path on volume and
  in Tigris. Migration is a copy, not a rewrite.
- **Engine is the only writer** — no cross-tenant blob access from
  outside the engine; the audience-filter middleware (F161) gates
  every blob read.
- **`Storage` interface is the contract** — handlers never know
  whether they're hitting fs or S3. Adding new drivers (Wasabi,
  GCS, etc.) doesn't touch handler code.

## Dependencies

- **`@aws-sdk/client-s3`** — already in apps/server/package.json
  (used by F153 backup work). Move to packages/storage as a peer
  dep so `@trail/storage` can also import it.
- **Tigris bucket provisioning** — `flyctl storage create`.
  Christian's `broberg-ai` org already has Tigris access (per
  https://fly.io/dashboard/broberg-ai/tigris).
- **F33** — engines must exist on Fly before they can have
  buckets attached.

## Rollout

### Phase 1 (~1 day implementation)

1. `packages/storage/src/s3.ts` — S3Storage implementation.
2. Update `packages/storage/src/index.ts` to export `S3Storage`
   and a small driver-factory.
3. Wire `apps/server/src/lib/storage.ts` to read
   `TRAIL_STORAGE_DRIVER` env.
4. Verify-script that round-trips put/get/delete/exists/list
   against a real Tigris bucket (uses test credentials).
5. Migration script `migrate-blobs-to-tigris.ts`.

### Phase 2 (deploy to engine-001)

1. `fly storage create --app trail-engine-001
   --name trail-engine-001-blobs`.
2. `fly secrets set TRAIL_STORAGE_DRIVER=s3 TRAIL_BLOB_BUCKET=trail-engine-001-blobs`
   (AWS_* sets automatic from step 1).
3. SSH to engine, run migration script over existing
   `/data/sanne-andersen/uploads/`.
4. Restart engine — new uploads/reads route through Tigris.
5. After verify, shrink the volume from 10 GB → 2 GB
   (`fly volumes destroy + create` since Fly doesn't shrink in-place).

### Phase 3 (F169 integration)

Update `pnpm trail engine spawn` to call `fly storage create`
inline with app+volume creation. Future engines are Tigris-backed
from birth.

## Open questions

- **Bucket naming when an engine is renamed/replaced.** If
  trail-engine-001 ever gets nuked and recreated, does the bucket
  persist? Decision: bucket is keyed by engine-id (logical), not
  fly-app-name (physical). When recreating, re-attach the existing
  bucket. Documented in F169 plan-doc.
- **Cost-attribution per tenant.** Tigris bills per bucket. If we
  want per-tenant cost reporting (F156 credits accuracy), we'd need
  per-tenant tagging on objects + lifecycle audit. Out of scope for
  Phase 1; revisit when Stripe billing for credits ships.
- **Cold-storage tier.** Old vision-derivatives or backup PDFs could
  go to Tigris archive tier ($0.0036/GB/mo). Future optimization;
  not Phase 1.

## Verification plan

`apps/server/scripts/verify-f173-tigris.ts`:

1. **Local round-trip**: with TRAIL_STORAGE_DRIVER=s3 pointed at a
   test Tigris bucket, write 10 random blobs, read them back, list
   them, delete them, verify they're gone.
2. **Migration round-trip**: pre-populate local fs with synthetic
   blobs, run migrate-blobs-to-tigris, verify every file lands in
   bucket with correct content-type + same path.
3. **Driver swap**: same code reads from `local` driver, then we
   flip env to `s3` and same handler reads back the same content
   from the migrated bucket. No code change, no path change.
4. **Audience-filter still gates**: an unauthenticated request to
   `/api/v1/documents/.../images/foo.png` returns 401, not the blob
   bytes (verifies presignedUrl is OFF for image-route reads).
