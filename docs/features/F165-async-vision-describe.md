# F165 — Async Vision-describe (move out of upload critical path)

**Status:** Planned · **Phase:** 1 · **Owner:** trail-server

## TL;DR

Today the PDF-extract pipeline calls Anthropic Vision *inline + serially*
for every body-image while the upload HTTP request is still open. For
image-heavy PDFs (botanical / illustrated / slide-export) this blows
through the 120-second extract timeout and the entire ingest fails —
text never compiles, document_images never persist, PNG bytes orphan
on disk.

F165 moves Vision-describe out of the upload critical path. Upload
returns 201 the moment text + images are extracted; descriptions
trickle in via a background `vision-rerun` job that the upload route
auto-submits. F164's existing job framework handles concurrency,
progress, and crash-recovery — we just plug in.

The 240s timeout bump in this same change is the band-aid that buys
us the next image-heavy upload while F165 lands.

## Motivation — what we observed

`De_helbredende_urter.pdf` (Sanne's KB, doc id `f0332c14-…`):

- 42 pages, 2.4 MB, 149 botanical illustrations
- Status `failed` — `Error: pdf extract … timed out after 120s`
- 149 PNG files on disk under `…/images/page-N-img-M.png`
- 0 rows in `document_images` for the doc
- pdfjs reached page 41/42 before the outer timeout fired

Math: with `describeImage: createVisionBackend()` set on the upload
path, `processPdf` awaits an Anthropic Vision call *for every image
≥ 100×100 px, sequentially, inside the page loop*. At ~1.5–2 s per
call that's 220–300 s for this PDF — almost 3× the 120 s outer cap.
The extraction itself (text + PNG bytes) takes a fraction of that.

The orphan-blob side-effect is just as bad as the failed status:
`persistImagesFromExtraction` runs *after* `dispatch()` returns, so a
timeout fires before any DB row is written — yet the per-image
`storage.put()` calls inside `processPdf` already succeeded. Result:
storage holds bytes the rest of the system can't see.

## Architectural choice — why background, not bigger timeout

Three options were considered:

1. **Bigger timeout.** Set `TRAIL_PDF_TIMEOUT_MS=600000`. Postpones
   the problem; a 200-image PDF still times out. Doesn't fix the
   orphan-blob mode. **Rejected as primary fix; kept as 240 s
   band-aid for the in-flight bump.**
2. **Bounded-concurrency inline describe.** `pLimit(4)` inside
   `processPdf`. Cuts wall-clock 4× but still holds the HTTP request
   open for an arbitrary duration; user has no progress signal; a
   crash mid-loop still orphans rows. **Rejected — wrong layer.**
3. **Async via F164 job framework.** Upload extracts text + images,
   persists `document_images` with `vision_description = NULL`, then
   submits a `vision-rerun` job for the doc. The job framework
   already provides concurrency cap (`pLimit(4)`), progress SSE,
   abort-support, zombie-recovery, idempotent NULL-only filter.
   **Chosen.**

The job framework was built precisely for this shape of work. Running
Vision inline during upload was a pre-F164 expedient that should have
gone away when F164 shipped.

## Scope (in)

1. **`apps/server/src/routes/uploads.ts` — stop passing
   `describeImage`.** PDF body-images extract without descriptions in
   the request handler. `dispatch()` returns markdown with empty alt
   text on `![…](url)` references, plus the unchanged `images[]`
   array.
2. **Upload route auto-submits a `vision-rerun` job after extract
   completes** if the doc produced ≥ 1 image. Payload:
   `{ documentIds: [docId], filter: 'null-only' }`. The job inherits
   tenant + KB + user from the upload context.
3. **Bump `TRAIL_PDF_TIMEOUT_MS` default to 240 000** as a safety net
   for the rare malformed PDF where pdfjs itself wedges. With
   describe gone, 240 s is generous — text + image-bytes alone for a
   42-page book takes <10 s.
4. **Markdown alt-text reconciliation.** When the vision-rerun job
   completes, the `documents.content` markdown still has empty
   `![](url)` references. Two acceptable behaviours: (a) leave them
   empty (alt-text is non-load-bearing for retrieval — Neuron-search
   uses `document_images.vision_description`, not markdown alt), or
   (b) post-job markdown patch. **Choose (a) for v1**; revisit if
   downstream renderers need alt-text.
5. **Verify-script** — `apps/server/scripts/verify-f165-async-vision.ts`
   exercises an upload-shaped flow with a mocked PDF + mocked Vision,
   asserts the upload-route handler returns before any Vision call,
   asserts a `vision-rerun` job was created with the right payload,
   asserts `document_images` rows landed with `vision_description IS
   NULL`.

## Scope (out / explicit non-goals)

- **F25 image-as-source uploads** (`png/jpg/webp/gif/svg` directly).
  These use the separate `describeImageAsSource` callback because the
  description IS the document's content; without it the source has
  no markdown body. Stays inline. F165 does not touch this path.
- **Audio transcription.** Same reasoning — content IS the
  transcript.
- **Removing `describe` from `processPdf`'s public signature.** The
  parameter stays optional; non-prod callers (tests, ad-hoc scripts)
  may still use it. F165 only changes upload-route behaviour.
- **Markdown alt-text post-job patching.** See "scope-in" item 4.
- **Re-processing prior-failed docs.** The 149 orphaned PNGs from
  `f0332c14-…` are not migrated. Curator re-uploads (now succeeds via
  the dedup-aware F162 path with `?force=true` if needed); old
  PNG-tree gets garbage-collected by the existing storage-prune job.
- **Cost-tracking move.** `extract_cost_cents` for PDF currently
  excludes vision (vision is a separate cost dimension). Vision-job
  cost lands on `jobs.cost_cents_actual` per F164. No schema change
  needed.

## Architecture sketch

### Before (today)

```
POST /upload
  ├─ formData parse
  ├─ storage.put(source.pdf)
  ├─ INSERT documents (status=processing)
  ├─ withTimeout(120s):
  │    dispatch → processPdf
  │      for page in 1..N:
  │        extract text
  │        for img in pageImages:
  │          storage.put(img.png)
  │          await Vision(img)   ← 1-3s × 149 ⇒ TIMEOUT
  ├─ persistImagesFromExtraction      ← never reached
  └─ UPDATE documents (status=ready)  ← never reached
```

### After (F165)

```
POST /upload
  ├─ formData parse
  ├─ storage.put(source.pdf)
  ├─ INSERT documents (status=processing)
  ├─ withTimeout(240s):
  │    dispatch → processPdf  (NO describeImage)
  │      for page in 1..N:
  │        extract text
  │        for img in pageImages:
  │          storage.put(img.png)
  ├─ persistImagesFromExtraction (vision_description=NULL)
  ├─ UPDATE documents (status=ready)
  ├─ chunkText + storeChunks  → ingest pipeline kicks off
  ├─ submit vision-rerun job  → returns jobId immediately
  └─ 201 with { ...doc, visionJobId? }     ← HTTP request closes here

[background]
  jobRunner picks up vision-rerun job
    pLimit(4) over 149 images
    progress SSE → admin progress modal subscribes
    UPDATE document_images SET vision_description=… per image
    job.status=completed, ~40-60s wall-clock
```

### Key invariants

- **Doc reaches `status=ready` before vision starts.** Text is
  searchable, Neurons compile, retrieval works on day 1. Images are
  visible in the gallery as un-described.
- **Vision-rerun is idempotent on `vision_description IS NULL`.** A
  crash mid-job leaves some rows described and some null; restart
  picks up where it left off. F164 invariant.
- **Auto-submit failure is non-fatal.** If `runner.submit()` throws
  (DB locked, etc.), upload still returns 201 — the curator can
  trigger vision-rerun manually from the gallery. Logged warning.

## Dependencies

- **F161** (image persistence) — `persistImagesFromExtraction` +
  `document_images` schema. Already shipped.
- **F164** (jobs framework + vision-rerun handler) — `runner.submit`,
  the `vision-rerun` kind, the SSE progress channel, the admin
  progress-modal that handles "user closes tab, comes back later"
  via the JobsBadge in the header. Already shipped.

No new schema, no new endpoints, no new MCP. F165 is a wiring change
between two already-shipped subsystems plus removal of a now-redundant
inline call.

## Rollout

- **Phase 0** (this commit, in-flight): bump `TRAIL_PDF_TIMEOUT_MS`
  default to 240 000 as the band-aid covering the next few
  image-heavy uploads while F165 lands.
- **Phase 1**: implementation per "scope-in", verify-script, manual
  re-run on `De_helbredende_urter.pdf` to confirm it now succeeds
  end-to-end (upload returns 201 fast, vision-rerun job completes in
  <60 s, all 149 images get descriptions in DA).
- **Phase 2** (future, not in F165): tighten `TRAIL_PDF_TIMEOUT_MS`
  default back to e.g. 90 000 once we have confidence pdfjs alone
  doesn't need 240 s for any reasonable doc. Out of scope for F165
  itself.

## Open questions

None — design is closed. Implementation proceeds in this same
session, atomic with the plan-doc.

## Verification plan

`apps/server/scripts/verify-f165-async-vision.ts` proves:

1. `processFileAsync` is called with `describeImage: undefined` on
   the PDF path (mock the upload route's `dispatch` call, inspect
   args).
2. After `persistImagesFromExtraction`, exactly one `vision-rerun`
   job is enqueued for the doc, with `documentIds=[docId]` and
   `filter='null-only'`.
3. Wall-clock for the upload-handler-side work is bounded by
   pdfjs-only timing (no Vision-call in the critical path).
4. `documents.status` reaches `ready` even on a 0-Vision-backend
   environment (no `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY` set) —
   the auto-submit becomes a no-op job that completes immediately
   with `{ described: 0, decorative: 0, failed: 0 }`.
