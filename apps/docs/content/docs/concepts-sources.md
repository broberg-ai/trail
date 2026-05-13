---
title: Sources & programmatic upload
slug: concepts-sources
summary: How raw files (PDF, markdown, audio, images) enter a KB programmatically. Upload via REST → extract → compile into Neurons → searchable + chat-grounded. The right surface for "push content from my own app into Trail".
order: 15
audience: both
category: Concepts
---

A **Source** is a raw file inside a knowledge base — a PDF the
practitioner uploaded, a markdown file your app generated, an audio
recording of a seminar, a screenshot of a whiteboard. Sources are
the *input*; [Neurons](/concepts-neurons/) are the *output* the
ingest pipeline compiles from them.

If you want your external app to push content into Trail
programmatically (a Slack-attachment listener, a webhook receiver,
a scheduled import from a CMS), this is the endpoint surface to
use.

## The pipeline in 60 seconds

```
Your app
    ↓ POST /api/v1/knowledge-bases/{kbId}/documents/upload
    ↓     (multipart: file + optional metadata)
Engine stores bytes → creates `documents` row (kind=source)
    ↓
   ┌─ text formats (md, txt, html, csv) → auto-trigger ingest
   └─ binary formats (pdf, docx, audio, ...) → extractor queue
       ↓
   extractor pulls text/transcript/OCR → status='ready'
       ↓
   ingest pipeline (LLM compile) → status='processing' → 'success'
       ↓
   Neurons committed to KB → searchable + chat-grounded
```

End-to-end time depends on format + KB size:

- Markdown / text: usually **5–30 seconds** to Neurons
- PDF (10 pages): **30–90 seconds** (extract + Vision on figures + compile)
- Audio (30 min): **2–5 minutes** (transcribe + chunk + compile)
- Large PDF (200+ pages): **3–10 minutes** in the background queue

## The one-shot upload

The simplest path. One POST, multipart-form, file in the body:

```bash
curl -X POST "${TRAIL_API_BASE}/api/v1/knowledge-bases/${TRAIL_KB}/documents/upload" \
  -H "Authorization: Bearer ${TRAIL_TOKEN}" \
  -F "file=@./treatment-protocol.pdf" \
  -F 'path=/protocols' \
  -F 'metadata={"connector":"sanne-site","sourceUrl":"https://sanneandersen.dk/admin/upload/42","tags":["protocol","clinical"]}'
```

Response (HTTP 201):

```json
{
  "id": "doc_a1b2c3d4-...",
  "knowledgeBaseId": "kb-uuid",
  "kind": "source",
  "filename": "treatment-protocol.pdf",
  "path": "/protocols",
  "fileType": "pdf",
  "fileSize": 348291,
  "status": "pending",
  "seq": 47,
  "contentHash": "9f8e7d6c...",
  "tags": "protocol, clinical",
  "createdAt": "2026-05-13T14:22:13Z"
}
```

The `id` is the canonical handle for the rest of the lifecycle —
use it to check status, trigger re-ingest, or delete.

### TypeScript helper

```typescript
const TRAIL_BASE = process.env.TRAIL_API_BASE!;
const TRAIL_TOKEN = process.env.TRAIL_TOKEN!;
const TRAIL_KB = process.env.TRAIL_KB!;

export async function uploadSource(args: {
  file: Blob;
  filename: string;
  path?: string;
  connector?: string;
  sourceUrl?: string;
  tags?: string[];
}): Promise<{ id: string; status: string }> {
  const form = new FormData();
  form.set('file', args.file, args.filename);
  if (args.path) form.set('path', args.path);
  if (args.connector || args.sourceUrl || args.tags) {
    form.set(
      'metadata',
      JSON.stringify({
        connector: args.connector,
        sourceUrl: args.sourceUrl,
        tags: args.tags,
      }),
    );
  }
  const res = await fetch(
    `${TRAIL_BASE}/api/v1/knowledge-bases/${TRAIL_KB}/documents/upload`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${TRAIL_TOKEN}` },
      body: form,
    },
  );
  if (res.status === 409) {
    const dup = await res.json();
    throw new Error(`Duplicate source — existing id: ${dup.existingDocumentId}`);
  }
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
```

## Source lifecycle

The `status` field on the document row walks through these states:

| Status | What's happening |
|---|---|
| `pending` | Bytes uploaded; binary extractor (PDF, audio, ...) queued. |
| `ready` | Text source uploaded + chunked; LLM compile queued. |
| `processing` | Ingest pipeline actively running. |
| `success` | Source fully compiled into Neurons; sits in the KB. |
| `failed` | Extractor or compile errored; see `errorMessage`. |

Two ways to track progress:

1. **Poll the document row** via `GET /api/v1/documents/{docId}` (when
   that read-route is exposed — currently part of the admin's source-
   panel, not yet bearer-exposed; coming soon).
2. **Listen on the SSE event stream** — Trail's broadcast layer emits
   `source.uploaded`, `ingest.started`, `ingest.completed`,
   `ingest.failed` events that external integrations can subscribe to.

For simple integrations the practical pattern is: upload, get the
`id` back, and assume success unless you need to surface progress to
end-users. The admin curator sees status in the Sources panel
regardless.

## Deduplication (F162)

Trail SHA-256-hashes every upload's bytes BEFORE storage-write. If
the same content already exists in this KB as a non-archived Source,
the upload returns **HTTP 409** with `code: "duplicate_source"`:

```json
{
  "error": "A source with identical content already exists in this Trail.",
  "code": "duplicate_source",
  "existingDocumentId": "doc_existing-uuid",
  "existingFilename": "older-name.pdf",
  "existingPath": "/uploads",
  "existingCreatedAt": "2026-05-01T08:30:00Z",
  "hint": "Append ?force=true to upload anyway as a separate Source."
}
```

The 409 lets your app:

- Show "this file is already in Trail" instead of creating a
  duplicate
- Link the user to the existing source
- Re-upload anyway with `?force=true` when the duplicate is
  legitimate (e.g. same content, different categorisation)

This is bytes-identical dedup — a re-saved-with-different-extension
copy of the same content won't get the same hash unless the bytes
match exactly. For semantic dedup ("we already have a Neuron about
this topic") see the contradiction-lint pass in
[Concepts: Queue](/concepts-queue/).

## Triggering re-ingest

If a Source's ingest failed (LLM rate-limited, OCR mis-fired,
network blip), re-trigger the pipeline on the existing document:

```bash
curl -X POST "${TRAIL_API_BASE}/api/v1/documents/${DOC_ID}/ingest" \
  -H "Authorization: Bearer ${TRAIL_TOKEN}"
```

Response (HTTP 202):

```json
{ "ok": true, "message": "Ingest started" }
```

Returns 409 if the document is already `processing` — wait for the
current run to finish first.

## Supported formats + size limits

**Extensions accepted**: `pdf`, `docx`, `pptx`, `doc`, `ppt`, `png`,
`jpg`, `jpeg`, `webp`, `gif`, `svg`, `wav`, `mp3`, `m4a`, `ogg`,
`flac`, `aac`, `html`, `htm`, `xlsx`, `xls`, `csv`, `md`, `txt`.

**Max size**: 100 MB per file. For larger files (multi-hour audio,
giant PDFs), use the resumable chunked upload flow (advanced —
see below).

**Format-specific notes**:

- **Markdown / text**: compiled directly, no extractor step.
- **PDF**: text + Vision-described figures + OCR fallback. Most
  reliable extractor in production.
- **DOCX / PPTX**: text + slide outline. Legacy `.doc` / `.ppt` /
  `.xls` formats accepted at upload but flagged with an "upgrade to
  .docx" hint — no extractor for legacy binary formats.
- **Audio**: transcribed via Whisper (or equivalent backend). Output
  text feeds the standard compile.
- **Images**: Vision-described + tagged. Useful for diagrams +
  protocol cards + anatomy charts.

## Resumable chunked uploads (advanced)

For files > 100 MB or unreliable networks, Trail also exposes a
three-step protocol (F180) that's resilient to browser-reload and
client-disconnect mid-upload:

1. `POST /api/v1/knowledge-bases/{kbId}/documents/upload/init` —
   server returns `uploadId` + chunk-size hint.
2. Stream chunks via `PATCH /api/v1/uploads/{uploadId}/chunk`.
3. `POST /api/v1/uploads/{uploadId}/finalize` — server assembles
   the chunks and creates the Source row.

`GET /api/v1/uploads/{uploadId}` returns `bytesReceived` so the
client can resume from the last persisted byte after a network
failure.

For 99% of programmatic integrations (sub-100 MB files, stable
server-to-server connections), the one-shot upload is the right
choice.

## Where to go next

- [API reference](/api-reference/) — full OpenAPI schema for the
  `/upload` and `/ingest` endpoints with inline examples.
- [Quick start](/quick-start/) — five-step external-app integration
  including a source upload.
- [Concepts: Queue](/concepts-queue/) — what happens AFTER a Source
  becomes a Neuron candidate that needs curator review.
- [Concepts: Connectors](/concepts-connectors/) — how to attribute
  your app's uploads with `metadata.connector`.
