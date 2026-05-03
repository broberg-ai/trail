# F180 — Resumable chunked uploads

> Once the curator has clicked "Upload", the file is in an immutable queue — surviving browser reload, tab close, network blip, server restart. Today's all-at-once `formData()` upload doesn't honour that mental model: any disconnect mid-stream loses the upload. F180 introduces a chunked protocol with server-side staging so uploads pick up where they left off. Tier: all. Effort: Medium — 2 days. Status: Planned.

## Problem

Today's upload flow at `apps/server/src/routes/uploads.ts:84` reads the entire multipart body via `await c.req.formData()` before any persistence happens:

1. Client `POST /api/v1/knowledge-bases/:kbId/documents/upload` with multipart body
2. Server `await c.req.formData()` — buffers ALL bytes from the client until done
3. After full receipt: `await trail.db.insert(documents)` + `await storage.put()`

**The durability boundary** is step 3, not step 1. If the client disconnects between 1 and 3 — browser reload, tab close, Wi-Fi flap, mobile-network handoff — `formData()` rejects, the route handler errors out, and **nothing is persisted**. The curator's UI showed an "Active" state, the file appeared to be uploading, then it vanished on reload.

For a 56 KB .docx the window is milliseconds. For a 50 MB PDF or a multi-GB media file, the window is minutes. Christian observed the bug live during a `hjerte chakra.docx` upload to Sanne's prod KB on 2026-05-03: reload mid-upload → file gone → had to start over.

The architectural mismatch matters because Trail's whole stack is designed around durable-once-uploaded:
- F143 persistent ingest queue survives engine restarts
- F164 background-jobs framework crash-recovers via heartbeat
- F168 Beam migrates tenant data atomically

…but the front door (upload) is the one place where in-flight state is **only** in HTTP-stream RAM. The curator's mental model — *"once I've sent the file, it's safe"* — is correct for everything except the upload itself.

## Secondary pain points

- Mobile uploads over flaky cell connections fail more often than they succeed for any non-trivial file.
- Pause-and-resume isn't possible — a curator can't kick off a 200 MB ingest before lunch and check back later.
- Slow uploads (DSL, hotel Wi-Fi) hold one of Christian's 6 browser HTTP/1.1 slots open the whole time, starving fast queries on the same origin (cf. the `/translate` single-flight bug ADR `99c7a92`).
- No way to retry a failed upload with the same content-hash without manual UI gymnastics.

## Solution

A three-step chunked-upload protocol with server-side staging:

```
1. POST /api/v1/knowledge-bases/:kbId/documents/upload/init
     body: { filename, contentLength, contentHash, metadata? }
     → { uploadId, docId, chunkSize: 1MB, expiresAt }

   Side effects (committed in a single transaction):
     - INSERT documents row with status='uploading'
     - INSERT upload_sessions row tracking received_bytes=0
     - Reserve temp path: {uploadsRoot}/_tmp/{uploadId}.partial

2. PATCH /api/v1/uploads/:uploadId/chunk
     headers: Content-Range: bytes <start>-<end>/<total>
     body: raw chunk bytes (≤ 1 MB)
     → { uploadId, receivedBytes, complete: false }

   Side effects:
     - Append bytes to temp file at offset = start
     - Update upload_sessions.received_bytes
     - Idempotent on overlapping ranges (same offset re-sent → no-op)

3. POST /api/v1/uploads/:uploadId/finalize
     body: { contentHash } (verifies end-to-end integrity)
     → { doc: <full Document row> }

   Side effects:
     - Validate received_bytes === content_length
     - Validate computed sha256 === provided contentHash
     - Atomic rename: temp file → final storage path
     - UPDATE documents.status to 'pending' (or 'failed' for unsupported formats per F162-precursor)
     - Mark upload_sessions.status='complete'
     - Trigger F143 ingest pipeline (existing path)

Resume on reload:

```
GET /api/v1/uploads/:uploadId
  → { uploadId, docId, filename, contentLength, receivedBytes,
      status: 'uploading'|'complete'|'aborted'|'expired',
      expiresAt }
```

Client on reload reads `localStorage.trail.activeUploads` for its tenant, calls GET on each, resumes from `receivedBytes`. Server-side state is the source of truth — no chunk re-upload from offset 0.

## Non-goals

- **WebRTC / peer-to-peer transfers.** HTTP/1.1 fetch with AbortController is plenty for Phase 1.
- **Cross-engine resumability.** uploadId is engine-local. Migrating an in-flight upload between engines belongs in F170 multi-engine orchestrator if it ever matters; today's single-engine reality means it doesn't.
- **End-to-end encryption.** TLS to the engine is enough; no client-side encryption-before-upload.
- **Replace the single-shot endpoint immediately.** Old `POST /knowledge-bases/:kbId/documents/upload` stays as a deprecated fallback for clients that don't yet support chunked. Removed in a Phase 4 follow-up after the chunked client lands across web + mobile (F157).
- **Server-driven chunk size.** 1 MB is hardcoded; a future revision may negotiate based on bandwidth/RTT measurements, but premature for Phase 1.
- **Multi-part composability across uploads.** Each upload is a single document. Splitting one logical document into multiple uploads (e.g. a book in chapters) is out of scope.

## Technical design

### Schema migration 0032 — `upload_sessions`

```sql
CREATE TABLE upload_sessions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id text NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  filename text NOT NULL,
  content_length integer NOT NULL,
  content_hash text NOT NULL,
  received_bytes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'complete', 'aborted', 'expired')),
  temp_path text NOT NULL,
  created_at text NOT NULL DEFAULT (datetime('now')),
  updated_at text NOT NULL DEFAULT (datetime('now')),
  expires_at text NOT NULL
);

CREATE INDEX idx_upload_sessions_tenant ON upload_sessions(tenant_id, status);
CREATE INDEX idx_upload_sessions_doc ON upload_sessions(document_id);
CREATE INDEX idx_upload_sessions_expires ON upload_sessions(expires_at)
  WHERE status = 'uploading';
```

Plus one column on documents: extend the existing status enum to include `'uploading'` (pre-`pending`) so the gallery can render in-flight uploads. Documents in `'uploading'` status are excluded from chat retrieval, search, and lint passes — they don't have content yet.

### Server endpoints

**`POST /uploads/init`** — `apps/server/src/routes/uploads.ts`

Validates filename + content_length (size cap 100 MB still enforced). Computes a deterministic temp path. Two writes in one transaction:
1. INSERT documents (status='uploading', filename, file_type from extension, fileSize=content_length, content_hash; chunked uploads get content_hash UPFRONT from the client because we need it for dedup, see "Pre-flight dedup" below).
2. INSERT upload_sessions (received_bytes=0, status='uploading', expires_at=now+24h).

Pre-flight dedup: if a `documents` row exists with the same content_hash, return 409 with `{ code: 'duplicate_source', existingDocumentId, hint: 'append ?force=true' }` — same UX as F162. Saves the curator from sending bytes for a duplicate.

**`PATCH /uploads/:uploadId/chunk`**

Validates Content-Range header. Reads body as Uint8Array. Opens temp file at the indicated offset, writes bytes. Updates received_bytes via UPDATE…SET received_bytes = MAX(received_bytes, ?). Returns `{ receivedBytes }`.

Idempotency: chunks are addressable by `(uploadId, offset)`. Re-sending the same chunk overwrites the same bytes at the same offset; no duplication, no data loss, no error.

Concurrency: the engine takes a per-uploadId in-process mutex during the file-write so two concurrent chunks don't interleave at the same offset. Realistic upload-clients send chunks sequentially, but the mutex makes the protocol robust against accidental parallel calls.

**`POST /uploads/:uploadId/finalize`**

Validates received_bytes === content_length and recomputes sha256 over the temp file, comparing to the `contentHash` declared at init. If either check fails, returns 422 with details — the upload session stays `uploading` so the client can re-send any missing chunks.

On success: atomic rename temp file → final storage path (uses `fs.rename` which is atomic on the same filesystem; the engine's volume is single-FS). Updates documents.status to `'pending'` (or `'failed'` for unsupported extensions; same logic as the current upload route's no-pipeline branch). Marks upload_sessions.status=`'complete'`. Fires F143 ingest pipeline trigger.

Returns the full Document row. Client transitions UI from "uploading" to "processing".

**`GET /uploads/:uploadId`**

Resume endpoint. Returns current upload_sessions row + linked document. Client uses received_bytes to know where to resume.

**`DELETE /uploads/:uploadId`**

Curator-driven cancel. Marks upload_sessions.status=`'aborted'`, deletes temp file, deletes documents row. Idempotent.

### Background cleanup

`apps/server/src/services/upload-session-gc.ts` — runs hourly:
1. Find upload_sessions where status=`'uploading'` AND expires_at < now → mark `'expired'`, delete temp file, delete documents row (cascades).
2. Find expired/aborted sessions older than 7 days → DELETE row entirely.

Keeps disk and DB clean from abandoned uploads. Idempotent and crash-safe.

### Frontend

`apps/admin/src/lib/upload-client.ts` (new) — chunked upload client:

```ts
export async function uploadChunked(
  kbId: string,
  file: File,
  opts: {
    onProgress?: (received: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<Document> {
  const contentHash = await sha256(file);
  const init = await api(`/api/v1/knowledge-bases/${kbId}/documents/upload/init`, {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      contentLength: file.size,
      contentHash,
    }),
  });

  // Persist uploadId so reload can resume
  rememberActiveUpload(init.uploadId, kbId);

  let received = 0;
  const CHUNK = init.chunkSize;
  while (received < file.size) {
    const chunk = file.slice(received, received + CHUNK);
    const buf = await chunk.arrayBuffer();
    await fetchWithRetry(`/api/v1/uploads/${init.uploadId}/chunk`, {
      method: 'PATCH',
      headers: { 'Content-Range': `bytes ${received}-${received + buf.byteLength - 1}/${file.size}` },
      body: buf,
      signal: opts.signal,
    });
    received += buf.byteLength;
    opts.onProgress?.(received, file.size);
  }

  const result = await api(`/api/v1/uploads/${init.uploadId}/finalize`, {
    method: 'POST',
    body: JSON.stringify({ contentHash }),
  });
  forgetActiveUpload(init.uploadId);
  return result.doc;
}
```

`fetchWithRetry` does exponential backoff up to 3 attempts per chunk on network errors. AbortController honoured throughout.

`apps/admin/src/lib/upload-resume.ts` — on app boot, scans `localStorage.trail.activeUploads`, calls GET on each, presents a resume-prompt: *"Du har en upload i gang ('hjerte chakra.docx', 47% complete). Genoptag?"* — curator can resume, cancel, or dismiss.

`apps/admin/src/components/upload-dropzone.tsx` — replace single-shot `fetch` with `uploadChunked`. Progress bar wired to the new callback. Per-chunk retry status surfaced in UI.

### Storage interface

`packages/storage/src/local.ts` gets two new methods:

```ts
export interface Storage {
  // existing
  put(path: string, bytes: Uint8Array | Buffer, contentType?: string): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  // F180
  appendChunk(tempPath: string, offset: number, bytes: Uint8Array): Promise<void>;
  finalize(tempPath: string, finalPath: string): Promise<void>;
}
```

`LocalStorage` implements them via `fs.open` with `O_RDWR | O_CREAT` + `pwrite` for `appendChunk`, and `fs.rename` for `finalize`. F173 Tigris implementation will use S3 multipart uploads — `appendChunk` maps to `UploadPart`, `finalize` maps to `CompleteMultipartUpload`. Same interface, both backends.

## Interface

### REST endpoints (new)

```
POST   /api/v1/knowledge-bases/:kbId/documents/upload/init
       body: { filename, contentLength, contentHash, metadata? }
       → 201 { uploadId, docId, chunkSize, expiresAt }
       → 409 { code: 'duplicate_source', existingDocumentId, hint }
       → 400 { error } on validation failure

PATCH  /api/v1/uploads/:uploadId/chunk
       headers: Content-Range: bytes <start>-<end>/<total>
       body: <raw chunk bytes>
       → 200 { uploadId, receivedBytes }
       → 416 if Content-Range malformed or out-of-bounds
       → 410 if upload expired/aborted

POST   /api/v1/uploads/:uploadId/finalize
       body: { contentHash }
       → 201 { doc: Document }
       → 422 { error: 'incomplete' | 'hash-mismatch', receivedBytes, expectedBytes }

GET    /api/v1/uploads/:uploadId
       → 200 { uploadId, docId, filename, contentLength, receivedBytes, status, expiresAt }
       → 404 if not found

DELETE /api/v1/uploads/:uploadId
       → 204
```

### REST endpoints (deprecated, kept for compat)

```
POST /api/v1/knowledge-bases/:kbId/documents/upload
       (single-shot multipart — legacy clients)
```

Marked `Deprecated: F180 chunked endpoints preferred` in OpenAPI spec / docs/INTEGRATION-API.md. Removed in a Phase 4 follow-up after web + iOS clients all migrate.

## Rollout

- **Phase 1** (~1 day): Server-side. Migration 0032, four new endpoints, GC service, storage interface extension, verify-script. No frontend changes — old upload still works.
- **Phase 2** (~½ day): Frontend. New upload-client lib, drop-zone rewrite, resume-prompt on boot. Backward-compat: if /init returns 404 (old engine), fall back to single-shot.
- **Phase 3** (~½ day): Polish. Per-chunk retry-with-backoff UI, multi-file queue, "Cancel upload" button, mobile-friendly progress bar.
- **Phase 4** (later, conditional): Remove single-shot endpoint after 30+ days of new-client-only traffic. Decision-gate via cost/quality dashboard usage stats.

## Success criteria

1. Browser reload mid-upload preserves state. Verified by: start a 50 MB upload, reload at 30%, see resume-prompt, click resume, watch progress continue from 30%.
2. Network drop mid-upload preserves state. Verified by: start an upload, kill Wi-Fi for 10s, reconnect, see chunk-retry succeed without UI panic.
3. Concurrent chunk re-sends are idempotent. Verified by: send chunk at offset N, then send again, observe receivedBytes unchanged + final hash correct.
4. Duplicate detection fires before bytes flow. Verified by: upload a file Sanne already has, observe 409 from /init with no body bytes transferred.
5. F143 ingest pipeline still triggers correctly post-finalize. Verified by: upload a small markdown file end-to-end, observe ingest_jobs row appears with documentId == finalized doc.
6. Aborted/expired uploads don't leak disk. Verified by: leave 5 incomplete uploads, wait 24h, run GC, observe temp files deleted + documents rows cascaded.

## Impact analysis

### Files created (new)

- `packages/db/drizzle/0032_upload_sessions.sql` — schema migration
- `packages/db/src/schema.ts` — `uploadSessions` table definition + status enum extension
- `apps/server/src/services/upload-session-gc.ts` — hourly cleanup
- `apps/admin/src/lib/upload-client.ts` — chunked upload client
- `apps/admin/src/lib/upload-resume.ts` — boot-time resume scanner
- `apps/server/scripts/verify-f180-chunked-upload.ts` — end-to-end probe

### Files modified

- `apps/server/src/routes/uploads.ts` — add four new endpoints; existing `POST /upload` annotated `@deprecated`
- `apps/server/src/index.ts` — wire `startUploadSessionGc()` into bootstrap
- `apps/admin/src/components/upload-dropzone.tsx` — switch to `uploadChunked`
- `apps/admin/src/main.tsx` — call `scanResumableUploads()` on boot
- `packages/storage/src/local.ts` — implement `appendChunk` + `finalize`
- `packages/storage/src/index.ts` — export interface methods
- `apps/server/src/lib/storage.ts` — wire new interface
- `docs/INTEGRATION-API.md` — document chunked endpoints + mark single-shot deprecated

### Downstream dependents

- The current `processFileAsync` in `uploads.ts` is unchanged — it runs after `finalize` triggers ingest, same as it does today after the single-shot route.
- F143 `ingest_jobs` table sees no schema change. Triggering ingest from finalize is one line.
- F168 Beam: in-progress uploads on the source engine should NOT be migrated (they're transient by nature). Beam-pull/push filters on `documents.status != 'uploading'` for transfer. One-line filter add.
- F165 async vision and F22 anchor injection: both run post-ingest, unchanged.

### Blast radius

- All schema changes additive. New table, new status enum value. Existing rows unaffected.
- New endpoints are additive. Old endpoint stays. Clients can adopt at their own pace.
- The chunked upload-client is opt-in by file size: small files (< 1 MB) could still single-shot for round-trip-time reasons. Phase 2 client decides this; Phase 1 server doesn't care.

### Breaking changes

None in Phase 1-3. Phase 4 (remove single-shot) is breaking but gated on usage telemetry showing zero traffic on the deprecated endpoint.

### Test plan

- [ ] Migration 0032 applies cleanly + `upload_sessions` table and indexes present
- [ ] Unit: chunked upload of 100KB file via direct API calls succeeds end-to-end
- [ ] Unit: chunk re-send at same offset is idempotent (received_bytes unchanged)
- [ ] Unit: hash-mismatch on finalize returns 422 + session stays `uploading`
- [ ] Integration: 5 MB file upload — disconnect after chunk 3, reconnect via GET /:uploadId, resume from chunk 4, complete
- [ ] Integration: pre-flight 409 fires for duplicate content_hash before bytes flow
- [ ] Integration: F143 ingest_jobs row appears post-finalize with correct documentId
- [ ] Manual: browser reload at 50% upload → see resume prompt → click resume → upload completes
- [ ] Manual: cancel mid-upload via UI → temp file deleted + documents row removed
- [ ] GC: leave 3 incomplete uploads, advance time, run GC manually, observe sessions marked expired + temp files deleted
- [ ] Regression: existing single-shot upload still works (legacy clients)

## Implementation steps

1. Migration 0032 + schema.ts uploadSessions table.
2. Storage interface extension (`appendChunk`, `finalize`) + LocalStorage implementation.
3. Server endpoints in routes/uploads.ts (init, chunk, finalize, get, delete).
4. UploadSessionGc service + index.ts boot wiring.
5. verify-f180-chunked-upload.ts probe — end-to-end via in-process API calls.
6. Frontend upload-client lib + drop-zone rewrite.
7. Frontend resume-prompt at app boot.
8. Manual reload-test on local — confirm `hjerte chakra.docx` survives mid-upload reload.
9. Deploy to engine + admin via `pnpm ship:engine` + `pnpm ship:admin` (CRITICAL — admin SPA must rebuild for new client-side code to ship; F177 detector enforces this).
10. Verify on prod with a real upload + reload sequence.

## Dependencies

- F143 ingest queue (already shipped) — fed by finalize.
- F162 dedup-via-checksum (already shipped) — extended to fire pre-byte-transfer at /init.
- F164 background-jobs (already shipped) — unchanged, drives post-finalize compile.
- F177 build-context audit (in flight) — ensures `pnpm ship:admin` is the only blessed deploy path so admin SPA bundle ships current upload-client.

## Open questions

- **Chunk size: 1 MB vs 5 MB?** 1 MB matches typical mobile-cell-tower keep-alive intervals; 5 MB cuts overhead per chunk. Default to 1 MB; revisit if cellular telemetry shows pain.
- **GET /uploads/:uploadId auth** — should anyone with the uploadId resume, or only the original user? Default: only original user (FK on user_id), matches Bearer-key isolation. uploadIds are UUIDs so collision-resistant but not auth.
- **Resume across browsers / devices?** Phase 1 says no — uploadId in localStorage is browser-local. Cross-device resume is a Phase 5 nice-to-have if customers ask.

## Effort estimate

**Medium** — 2 days.

- Phase 1 (server + verify-script): 1 day
- Phase 2 (frontend client + drop-zone): 0.5 day
- Phase 3 (polish + multi-file UX): 0.5 day

Phase 4 (remove single-shot) is a separate ~1-hour cleanup gated on usage telemetry.
