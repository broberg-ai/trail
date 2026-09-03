import { Hono } from 'hono';
import { documents, uploadSessions, knowledgeBases, type TrailDatabase } from '@trail/db';
import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { requireAuth, getUser, getTenant, getTrail } from '../middleware/auth.js';
import { processPdf, processDocx, processPptx, processXlsx, dispatch, pickPipeline } from '@trail/pipelines';
import { storage, sourcePath } from '../lib/storage.js';
import { chunkText, storeChunks } from '../services/chunker.js';
import { triggerIngest } from '../services/ingest.js';
import { describeImageAsSource, getActiveVisionModel } from '../services/vision.js';
import { transcribeAudio } from '../services/transcription.js';
import { resolveKbId, logActivity } from '@trail/core';
import { persistImagesFromExtraction } from '../services/document-images.js';
import { getJobRunner } from '../services/jobs/runner.js';
import type { VisionRerunPayload } from '../services/jobs/handlers/vision-rerun.js';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
// Silent hangs in pdfjs-dist on malformed PDFs are the single worst failure
// mode — status='processing' forever, no error, no log, no exit. Cap the
// extraction step so a wedged PDF produces a normal 'failed' row the
// curator can retry or archive. Env overridable if someone legit has a
// 500-page PDF.
// Bumped 120→240s as F165 band-aid: image-heavy PDFs (e.g. botanical books)
// blew the 120s cap because Vision-describe ran inline + sequentially per
// body-image. F165 moves Vision out of this path; until it lands, 240s
// covers the next ~300-image PDF. After F165, the pdfjs-only work this
// timeout actually guards is <10s for any reasonable doc.
const PDF_TIMEOUT_MS = Number(process.env.TRAIL_PDF_TIMEOUT_MS ?? 240_000);
const DOCX_TIMEOUT_MS = Number(process.env.TRAIL_DOCX_TIMEOUT_MS ?? 60_000);
const PPTX_TIMEOUT_MS = Number(process.env.TRAIL_PPTX_TIMEOUT_MS ?? 90_000);
const XLSX_TIMEOUT_MS = Number(process.env.TRAIL_XLSX_TIMEOUT_MS ?? 60_000);
const IMAGE_TIMEOUT_MS = Number(process.env.TRAIL_IMAGE_TIMEOUT_MS ?? 30_000);
const AUDIO_TIMEOUT_MS = Number(process.env.TRAIL_AUDIO_TIMEOUT_MS ?? 180_000);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s — file may be malformed or too complex`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'pptx', 'doc', 'ppt',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg',
  'wav', 'mp3', 'm4a', 'ogg', 'flac', 'aac',
  'html', 'htm', 'xlsx', 'xls', 'csv',
  'md', 'txt',
]);
const TEXT_EXTENSIONS = new Set(['md', 'txt', 'html', 'htm', 'csv']);

// Legacy Office formats live in ALLOWED_EXTENSIONS (so the upload itself
// is accepted) but have no extractor pipeline. Suggest the modern variant
// in the row's errorMessage so the curator knows the next step is "save
// as .docx and re-upload", not "wait for the queue to process this".
const FORMAT_UPGRADES: Record<string, string> = {
  doc: 'docx',
  ppt: 'pptx',
  xls: 'xlsx',
};
function unsupportedFormatMessage(ext: string): string {
  const upgrade = FORMAT_UPGRADES[ext];
  if (upgrade) {
    return `Legacy ".${ext}" format is not supported by the extractor. Save the file as ".${upgrade}" and re-upload.`;
  }
  return `File format ".${ext}" has no extractor. Convert to PDF, DOCX, PPTX, or XLSX and re-upload.`;
}

export const uploadRoutes = new Hono();

uploadRoutes.use('*', requireAuth);

uploadRoutes.post('/knowledge-bases/:kbId/documents/upload', async (c) => {
  // Diagnostic timing — when an upload hangs we need to know which step
  // ate the wall-clock. `lap()` returns ms since the request started.
  // Logs are concise + prefixed so a `grep '[upload]'` fishes out the
  // entire timeline of any single request without noise. Cheap to keep
  // in prod (5 console.log calls per upload).
  const t0 = Date.now();
  const lap = () => `${Date.now() - t0}ms`;

  const trail = getTrail(c);
  const user = getUser(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  console.log(`[upload] handler-entry kb=${kbId} ${lap()}`);
  const formData = await c.req.formData();
  console.log(`[upload] formData-parsed ${lap()}`);
  const file = formData.get('file') as File | null;
  const path = (formData.get('path') as string) ?? '/';
  const metadataRaw = formData.get('metadata') as string | null;

  let connector: string | undefined;
  let sourceUrl: string | undefined;
  let uploadTags: string[] | undefined;

  if (metadataRaw) {
    try {
      const meta = JSON.parse(metadataRaw);
      connector = meta.connector;
      sourceUrl = meta.sourceUrl;
      uploadTags = meta.tags;
    } catch {
      // Ignore malformed metadata
    }
  }

  if (!file) return c.json({ error: 'No file provided' }, 400);
  if (file.size > MAX_FILE_SIZE) return c.json({ error: 'File too large (max 100MB)' }, 413);

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return c.json({ error: `File type .${ext} not allowed` }, 400);
  }

  console.log(`[upload] file=${file.name} size=${(file.size / 1024 / 1024).toFixed(2)}MB ${lap()}`);
  const docId = crypto.randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  console.log(`[upload] arrayBuffer-loaded docId=${docId} ${lap()}`);

  // F162 — dedup. Compute hash BEFORE storage-write so a duplicate-
  // upload doesn't waste disk on a blob we'll reject. Then query
  // existing source-row in the same KB. Hit + no ?force=true → 409
  // with structured info so admin UI can offer "open existing" or
  // "upload anyway". App-level enforcement only — schema has a
  // non-unique index for lookup-speed but no DB UNIQUE so the
  // force=true escape needs no schema gymnastics.
  const contentHash = createHash('sha256').update(buffer).digest('hex');
  console.log(`[upload] sha256=${contentHash.slice(0, 12)} ${lap()}`);
  const force = c.req.query('force') === 'true';
  // F191 — Local Ingest Station signal. `?localCompile=true` parks the source
  // for $0 in-session compile by the /local-ingest skill instead of the cloud
  // OpenRouter compile. Defaults off → existing uploads behave unchanged.
  const localCompile = c.req.query('localCompile') === 'true';
  if (!force) {
    const existing = await trail.db
      .select({
        id: documents.id,
        filename: documents.filename,
        path: documents.path,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenant.id),
          eq(documents.knowledgeBaseId, kbId),
          eq(documents.kind, 'source'),
          eq(documents.archived, false),
          eq(documents.contentHash, contentHash),
        ),
      )
      .get();
    if (existing) {
      return c.json(
        {
          error: 'A source with identical content already exists in this Trail.',
          code: 'duplicate_source',
          existingDocumentId: existing.id,
          existingFilename: existing.filename,
          existingPath: existing.path,
          existingCreatedAt: existing.createdAt,
          hint: 'Append ?force=true to upload anyway as a separate Source.',
        },
        409,
      );
    }
  }

  await storage.put(sourcePath(tenant.id, kbId, docId, ext), buffer, file.type);
  console.log(`[upload] storage-written ${lap()}`);

  const isText = TEXT_EXTENSIONS.has(ext);
  // No registered pipeline + non-text → row would otherwise sit in
  // status='pending' forever (recover-pending-sources skips it). Mark
  // it 'failed' immediately with a clear errorMessage so the curator
  // sees what to do instead of a misleading "Marking the cairns…"
  // progress indicator. The bytes are still stored (line above) for
  // audit / future "convert legacy formats" sweep.
  const hasExtractor = isText || pickPipeline(file.name) !== null;
  const initialStatus = !hasExtractor ? 'failed' : isText ? 'ready' : 'pending';
  const initialError = !hasExtractor ? unsupportedFormatMessage(ext) : null;

  await trail.db
    .insert(documents)
    .values({
      id: docId,
      tenantId: tenant.id,
      knowledgeBaseId: kbId,
      userId: user.id,
      kind: 'source',
      filename: file.name,
      path,
      fileType: ext,
      fileSize: file.size,
      status: initialStatus,
      errorMessage: initialError,
      awaitingLocalCompile: localCompile,
      tags: uploadTags?.join(', ') ?? null,
      metadata: connector ? JSON.stringify({ connector, sourceUrl }) : null,
      // F162 — dedup hash. Set even on force-uploaded duplicates so the
      // audit trail is complete; subsequent dedup-tjeks just bypass on
      // ?force=true rather than hide the fact that the hash collided.
      contentHash,
      // F145 — inline per-KB seq (see candidates.ts for the same pattern).
      seq: sql<number>`COALESCE((SELECT MAX(${documents.seq}) FROM ${documents} WHERE ${documents.knowledgeBaseId} = ${kbId}), 0) + 1`,
    })
    .run();
  console.log(`[upload] db-row-inserted ${lap()}`);

  if (isText) {
    const content = new TextDecoder().decode(buffer);
    const title = ext === 'md' ? extractTitle(content) ?? file.name : file.name;
    // NOTE: we store the extracted content but leave status='processing'
    // (set below) rather than jumping straight to 'ready'. Text files
    // have no file-format-extract step so the row could technically
    // be 'ready' from upload, but the LLM compile (runIngest) still
    // has to fire and that's queued per-KB — with many uploads
    // landing at once, a curator would see "ready" on doc #65 while
    // its compile is still 30 minutes away in the queue. Status
    // 'processing' surfaces that honestly: runIngest transitions to
    // 'ready' when the compile actually completes.
    await trail.db
      .update(documents)
      .set({ content, title, status: 'processing', version: 1 })
      .where(eq(documents.id, docId))
      .run();

    if (content.trim()) {
      const chunks = chunkText(content);
      await storeChunks(trail, docId, tenant.id, kbId, chunks);
    }
  }

  // F28 — single dispatch call replaces the previous 4 ext-specific
  // if-blocks. Adding a new format (image, audio, video, email) is now
  // "register a Pipeline in @trail/pipelines"; uploads.ts doesn't change.
  // Legacy binary formats with no registered pipeline (xls, doc, raw
  // images pre-F25) still land status='pending' until handled.
  if (!isText && pickPipeline(file.name) !== null) {
    processFileAsync(trail, docId, tenant.id, kbId, user.id, file.name, buffer, localCompile).catch(async (err) => {
      console.error(`[pipeline] failed for ${file.name}:`, err);
      await trail.db
        .update(documents)
        .set({
          status: 'failed',
          errorMessage: String(err).slice(0, 1000),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(documents.id, docId))
        .run();
    });
  }

  const doc = await trail.db
    .select()
    .from(documents)
    .where(eq(documents.id, docId))
    .get();

  // F97 — record the source-arrival event before triggering ingest.
  // The broadcaster will emit ingest_started when the pipeline picks
  // the row up; this row captures the human-or-API moment where the
  // file arrived, with the connector that delivered it.
  await logActivity(trail, {
    tenantId: tenant.id,
    knowledgeBaseId: kbId,
    actorId: user.id,
    actorKind: 'user',
    kind: 'source.uploaded',
    subjectType: 'document',
    subjectId: docId,
    summary: `Uploaded ${file.name}`,
    metadata: {
      fileType: ext,
      fileSize: file.size,
      connector: connector ?? 'upload',
      initialStatus,
    },
  });

  // Auto-trigger wiki ingest for text sources that are ready to compile.
  // F191 — local-compile uploads skip the cloud compile; parked for /local-ingest.
  if (isText && !localCompile) {
    triggerIngest({ trail, docId, kbId, tenantId: tenant.id, userId: user.id });
  }

  console.log(`[upload] response-ready 201 ${lap()}`);
  return c.json(doc, 201);
});

// ─────────────────────────────────────────────────────────────────────
// F180 — Resumable chunked uploads
// ─────────────────────────────────────────────────────────────────────
//
// Three-step protocol that replaces the single-shot POST above:
//   1. POST /knowledge-bases/:kbId/documents/upload/init  → uploadId
//   2. PATCH /uploads/:uploadId/chunk                     (loop)
//   3. POST /uploads/:uploadId/finalize                   → Document
// Plus GET /uploads/:uploadId for resume + DELETE /uploads/:uploadId
// for cancel. The single-shot endpoint stays as a deprecated fallback
// for clients that don't yet ship the chunked client.
//
// Server-side state lives in `upload_sessions` + a per-uploadId temp
// file under `_tmp/`. A 24h expires_at is set at /init; the GC service
// (apps/server/src/services/upload-session-gc.ts) reaps expired rows
// + temp files hourly.

const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MB — see plan-doc "Open questions"
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Per-uploadId in-process mutex so two concurrent PATCH chunk calls
// for the same uploadId don't interleave their pwrite() at the same
// offset. Realistic clients send sequentially, but the protocol must
// be robust against accidental parallel calls.
const chunkMutexes = new Map<string, Promise<void>>();

async function withChunkMutex<T>(uploadId: string, fn: () => Promise<T>): Promise<T> {
  const prev = chunkMutexes.get(uploadId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  chunkMutexes.set(uploadId, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (chunkMutexes.get(uploadId) === prev.then(() => next)) {
      chunkMutexes.delete(uploadId);
    }
  }
}

function tempPathFor(uploadId: string): string {
  return `_tmp/${uploadId}.partial`;
}

function tempFsPath(uploadId: string): string {
  // Resolve through storage's root for hash-on-disk verification + GC.
  // We don't read this file via storage.get() because partial reads
  // are O(file-size) over the whole buffer; createReadStream is fine.
  // Mirrors LocalStorage.resolve() but kept here so we don't widen the
  // public Storage interface for this one debug/verify case.
  const root = process.env.TRAIL_UPLOADS_DIR ?? join(process.env.TRAIL_DATA_DIR ?? '.data', 'uploads');
  return join(root, tempPathFor(uploadId));
}

function parseContentRange(header: string | undefined): { start: number; end: number; total: number } | null {
  if (!header) return null;
  const match = header.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(total)) return null;
  if (start < 0 || end < start || end >= total) return null;
  return { start, end, total };
}

async function sha256OfFile(fsPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(fsPath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// POST /api/v1/knowledge-bases/:kbId/documents/upload/init
uploadRoutes.post('/knowledge-bases/:kbId/documents/upload/init', async (c) => {
  const trail = getTrail(c);
  const user = getUser(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  let body: {
    filename?: string;
    contentLength?: number;
    contentHash?: string;
    path?: string;
    metadata?: { connector?: string; sourceUrl?: string; tags?: string[] };
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { filename, contentLength, contentHash } = body;
  const path = body.path ?? '/';

  if (!filename || typeof filename !== 'string') return c.json({ error: 'filename required' }, 400);
  if (typeof contentLength !== 'number' || contentLength <= 0) {
    return c.json({ error: 'contentLength must be a positive number' }, 400);
  }
  if (contentLength > MAX_FILE_SIZE) return c.json({ error: 'File too large (max 100MB)' }, 413);
  if (!contentHash || typeof contentHash !== 'string' || !/^[a-f0-9]{64}$/i.test(contentHash)) {
    return c.json({ error: 'contentHash must be a 64-char hex sha256 string' }, 400);
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return c.json({ error: `File type .${ext} not allowed` }, 400);
  }

  // Pre-flight dedup — skip the whole transfer for content we already have.
  const force = c.req.query('force') === 'true';
  if (!force) {
    const existing = await trail.db
      .select({
        id: documents.id,
        filename: documents.filename,
        path: documents.path,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenant.id),
          eq(documents.knowledgeBaseId, kbId),
          eq(documents.kind, 'source'),
          eq(documents.archived, false),
          eq(documents.contentHash, contentHash),
        ),
      )
      .get();
    if (existing) {
      return c.json(
        {
          error: 'A source with identical content already exists in this Trail.',
          code: 'duplicate_source',
          existingDocumentId: existing.id,
          existingFilename: existing.filename,
          existingPath: existing.path,
          existingCreatedAt: existing.createdAt,
          hint: 'Append ?force=true to upload anyway as a separate Source.',
        },
        409,
      );
    }
  }

  const docId = crypto.randomUUID();
  const uploadId = crypto.randomUUID();
  const tempPath = tempPathFor(uploadId);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  // Two writes — kept as separate statements rather than wrapped in a
  // BEGIN/COMMIT because libSQL's drizzle adapter doesn't expose
  // transactions for write-only flows; if the second insert fails we
  // unwind by deleting the documents row.
  await trail.db
    .insert(documents)
    .values({
      id: docId,
      tenantId: tenant.id,
      knowledgeBaseId: kbId,
      userId: user.id,
      kind: 'source',
      filename,
      path,
      fileType: ext,
      fileSize: contentLength,
      status: 'uploading',
      tags: body.metadata?.tags?.join(', ') ?? null,
      metadata: body.metadata?.connector
        ? JSON.stringify({ connector: body.metadata.connector, sourceUrl: body.metadata.sourceUrl })
        : null,
      contentHash,
      seq: sql<number>`COALESCE((SELECT MAX(${documents.seq}) FROM ${documents} WHERE ${documents.knowledgeBaseId} = ${kbId}), 0) + 1`,
    })
    .run();

  try {
    await trail.db
      .insert(uploadSessions)
      .values({
        id: uploadId,
        tenantId: tenant.id,
        knowledgeBaseId: kbId,
        documentId: docId,
        userId: user.id,
        filename,
        contentLength,
        contentHash,
        receivedBytes: 0,
        status: 'uploading',
        tempPath,
        expiresAt,
      })
      .run();
  } catch (err) {
    // Roll back the documents insert so we don't leak an orphan
    // 'uploading'-state row that no client knows the uploadId for.
    await trail.db.delete(documents).where(eq(documents.id, docId)).run();
    throw err;
  }

  return c.json(
    {
      uploadId,
      docId,
      chunkSize: CHUNK_SIZE,
      expiresAt,
    },
    201,
  );
});

// PATCH /api/v1/uploads/:uploadId/chunk
uploadRoutes.patch('/uploads/:uploadId/chunk', async (c) => {
  const trail = getTrail(c);
  const user = getUser(c);
  const tenant = getTenant(c);
  const uploadId = c.req.param('uploadId');

  const session = await trail.db
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.id, uploadId))
    .get();
  if (!session) return c.json({ error: 'Upload session not found' }, 404);
  if (session.tenantId !== tenant.id || session.userId !== user.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (session.status !== 'uploading') {
    return c.json({ error: `Upload session is ${session.status}` }, 410);
  }

  const range = parseContentRange(c.req.header('content-range'));
  if (!range) return c.json({ error: 'Malformed Content-Range header' }, 416);
  if (range.total !== session.contentLength) {
    return c.json({ error: 'Content-Range total does not match contentLength at /init' }, 416);
  }

  const body = await c.req.arrayBuffer();
  const expectedLen = range.end - range.start + 1;
  if (body.byteLength !== expectedLen) {
    return c.json(
      { error: `Body length ${body.byteLength} does not match Content-Range span ${expectedLen}` },
      416,
    );
  }

  const result = await withChunkMutex(uploadId, async () => {
    await storage.appendChunk(session.tempPath, range.start, new Uint8Array(body));
    // received_bytes = MAX(current, end+1) — out-of-order chunk acks
    // don't roll the high-water-mark back. Sequential clients converge
    // monotonically; idempotent re-sends are no-ops.
    await trail.db
      .update(uploadSessions)
      .set({
        receivedBytes: sql<number>`MAX(${uploadSessions.receivedBytes}, ${range.end + 1})`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(uploadSessions.id, uploadId))
      .run();
    const updated = await trail.db
      .select({ receivedBytes: uploadSessions.receivedBytes })
      .from(uploadSessions)
      .where(eq(uploadSessions.id, uploadId))
      .get();
    return updated?.receivedBytes ?? range.end + 1;
  });

  return c.json({ uploadId, receivedBytes: result });
});

// POST /api/v1/uploads/:uploadId/finalize
uploadRoutes.post('/uploads/:uploadId/finalize', async (c) => {
  const trail = getTrail(c);
  const user = getUser(c);
  const tenant = getTenant(c);
  const uploadId = c.req.param('uploadId');

  let body: { contentHash?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const session = await trail.db
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.id, uploadId))
    .get();
  if (!session) return c.json({ error: 'Upload session not found' }, 404);
  if (session.tenantId !== tenant.id || session.userId !== user.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  if (session.status !== 'uploading') {
    return c.json({ error: `Upload session is ${session.status}` }, 410);
  }

  if (session.receivedBytes < session.contentLength) {
    return c.json(
      {
        error: 'incomplete',
        receivedBytes: session.receivedBytes,
        expectedBytes: session.contentLength,
      },
      422,
    );
  }

  const tempFs = tempFsPath(uploadId);
  if (!existsSync(tempFs)) {
    return c.json({ error: 'Temp file missing — upload likely expired or aborted' }, 410);
  }
  const stat = statSync(tempFs);
  if (stat.size !== session.contentLength) {
    return c.json(
      {
        error: 'incomplete',
        receivedBytes: stat.size,
        expectedBytes: session.contentLength,
      },
      422,
    );
  }

  const computedHash = await sha256OfFile(tempFs);
  if (body.contentHash && body.contentHash !== computedHash) {
    return c.json({ error: 'hash-mismatch', receivedBytes: stat.size, computedHash }, 422);
  }
  if (computedHash !== session.contentHash) {
    return c.json({ error: 'hash-mismatch', receivedBytes: stat.size, computedHash }, 422);
  }

  const ext = session.filename.split('.').pop()?.toLowerCase() ?? '';
  const finalRel = sourcePath(tenant.id, session.knowledgeBaseId, session.documentId, ext);
  await storage.finalize(session.tempPath, finalRel);

  const isText = TEXT_EXTENSIONS.has(ext);
  const hasExtractor = isText || pickPipeline(session.filename) !== null;
  const initialStatus = !hasExtractor ? 'failed' : isText ? 'ready' : 'pending';
  const initialError = !hasExtractor ? unsupportedFormatMessage(ext) : null;

  // Read final bytes for the text/inline path + processFileAsync. For
  // a 100MB file this still buffers — same memory ceiling as the
  // single-shot route. Phase 1 keeps post-finalize cost at parity;
  // Phase 3 may stream extractors.
  const finalBytes = await storage.get(finalRel);
  if (!finalBytes) {
    return c.json({ error: 'finalize: storage.get returned null after rename' }, 500);
  }
  const buffer = Buffer.from(finalBytes);

  await trail.db
    .update(documents)
    .set({
      status: initialStatus,
      errorMessage: initialError,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(documents.id, session.documentId))
    .run();

  if (isText) {
    const content = new TextDecoder().decode(buffer);
    const title = ext === 'md' ? extractTitle(content) ?? session.filename : session.filename;
    await trail.db
      .update(documents)
      .set({ content, title, status: 'processing', version: 1 })
      .where(eq(documents.id, session.documentId))
      .run();

    if (content.trim()) {
      const chunks = chunkText(content);
      await storeChunks(trail, session.documentId, tenant.id, session.knowledgeBaseId, chunks);
    }
  }

  if (!isText && pickPipeline(session.filename) !== null) {
    processFileAsync(
      trail,
      session.documentId,
      tenant.id,
      session.knowledgeBaseId,
      user.id,
      session.filename,
      buffer,
    ).catch(async (err) => {
      console.error(`[pipeline] failed for ${session.filename}:`, err);
      await trail.db
        .update(documents)
        .set({
          status: 'failed',
          errorMessage: String(err).slice(0, 1000),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(documents.id, session.documentId))
        .run();
    });
  }

  await trail.db
    .update(uploadSessions)
    .set({ status: 'complete', updatedAt: new Date().toISOString() })
    .where(eq(uploadSessions.id, uploadId))
    .run();

  const doc = await trail.db
    .select()
    .from(documents)
    .where(eq(documents.id, session.documentId))
    .get();

  let connector: string | undefined;
  if (doc?.metadata) {
    try {
      connector = JSON.parse(doc.metadata).connector;
    } catch {
      // metadata may legitimately be non-JSON; fall through.
    }
  }

  await logActivity(trail, {
    tenantId: tenant.id,
    knowledgeBaseId: session.knowledgeBaseId,
    actorId: user.id,
    actorKind: 'user',
    kind: 'source.uploaded',
    subjectType: 'document',
    subjectId: session.documentId,
    summary: `Uploaded ${session.filename}`,
    metadata: {
      fileType: ext,
      fileSize: session.contentLength,
      connector: connector ?? 'upload',
      initialStatus,
      uploadMode: 'chunked',
    },
  });

  if (isText) {
    triggerIngest({
      trail,
      docId: session.documentId,
      kbId: session.knowledgeBaseId,
      tenantId: tenant.id,
      userId: user.id,
    });
  }

  return c.json({ doc }, 201);
});

// GET /api/v1/uploads/:uploadId — resume probe
uploadRoutes.get('/uploads/:uploadId', async (c) => {
  const trail = getTrail(c);
  const user = getUser(c);
  const tenant = getTenant(c);
  const uploadId = c.req.param('uploadId');

  const session = await trail.db
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.id, uploadId))
    .get();
  if (!session) return c.json({ error: 'Upload session not found' }, 404);
  if (session.tenantId !== tenant.id || session.userId !== user.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  return c.json({
    uploadId: session.id,
    docId: session.documentId,
    knowledgeBaseId: session.knowledgeBaseId,
    filename: session.filename,
    contentLength: session.contentLength,
    contentHash: session.contentHash,
    receivedBytes: session.receivedBytes,
    status: session.status,
    chunkSize: CHUNK_SIZE,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
});

// DELETE /api/v1/uploads/:uploadId — curator-driven cancel
uploadRoutes.delete('/uploads/:uploadId', async (c) => {
  const trail = getTrail(c);
  const user = getUser(c);
  const tenant = getTenant(c);
  const uploadId = c.req.param('uploadId');

  const session = await trail.db
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.id, uploadId))
    .get();
  if (!session) return c.body(null, 204); // idempotent

  if (session.tenantId !== tenant.id || session.userId !== user.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Mark + delete temp file + cascade-delete documents row. Order
  // matters: mark first so a concurrent finalize-attempt sees the
  // 'aborted' status and 410s out cleanly.
  await trail.db
    .update(uploadSessions)
    .set({ status: 'aborted', updatedAt: new Date().toISOString() })
    .where(eq(uploadSessions.id, uploadId))
    .run();

  try {
    await storage.delete(session.tempPath);
  } catch {
    // Best-effort — GC will sweep stragglers.
  }

  // Documents row cascade-deletes the upload_sessions row via FK,
  // so we delete the document last. (If we deleted the document
  // first, the upload_sessions row would be gone before we could
  // mark it 'aborted'.)
  if (session.status === 'uploading') {
    await trail.db.delete(documents).where(eq(documents.id, session.documentId)).run();
  }

  return c.body(null, 204);
});

/**
 * F28 — unified file orchestrator. Replaces the per-format
 * `processPdfAsync` / `processDocxAsync` / `processPptxAsync` /
 * `processXlsxAsync` helpers — they all did the same status →
 * extract → store-chunks → trigger-ingest dance, just with different
 * extractors. Now the dispatch picks the right pipeline and the
 * shared body handles the rest.
 *
 * Adding a new format (F24 image, F47 audio, F46 video) means
 * registering a Pipeline in @trail/pipelines — no changes here.
 */
export async function processFileAsync(
  trail: TrailDatabase,
  docId: string,
  tenantId: string,
  kbId: string,
  userId: string,
  filename: string,
  buffer: Buffer,
  // F191 — Local Ingest Station. When true, run extract but SKIP the cloud
  // compile and park the source ('extracted', awaitingLocalCompile=true) for
  // the /local-ingest skill to compile in an interactive cc session ($0).
  awaitingLocalCompile = false,
): Promise<void> {
  await trail.db
    .update(documents)
    .set({ status: 'processing', updatedAt: new Date().toISOString() })
    .where(eq(documents.id, docId))
    .run();

  // F165 — describeImage is intentionally NOT passed: PDF body-images run
  // through the async vision-rerun job after extract completes (see below).
  // describeImageAsSource stays — the image-pipeline (.png/.jpg as the
  // entire source) needs it inline because the description IS the doc's
  // content; without it the source has no markdown body.
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const timeoutMs = ext === 'pdf'
    ? PDF_TIMEOUT_MS
    : ext === 'pptx'
      ? PPTX_TIMEOUT_MS
      : ext === 'xlsx'
        ? XLSX_TIMEOUT_MS
        : ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp' || ext === 'gif' || ext === 'svg'
          ? IMAGE_TIMEOUT_MS
          : ext === 'wav' || ext === 'mp3' || ext === 'm4a' || ext === 'ogg' || ext === 'flac' || ext === 'aac'
            ? AUDIO_TIMEOUT_MS
            : DOCX_TIMEOUT_MS;

  const { pipeline, result } = await withTimeout(
    dispatch({
      buffer,
      filename,
      storage,
      imagePrefix: `${tenantId}/${kbId}/${docId}/images`,
      imageUrlPrefix: `/api/v1/documents/${docId}/images`,
      describeImage: undefined,
      // F190.6 — tag the image-source vision call with tenant/KB so its cost
      // reaches upmetrics per-tenant (the pipeline interface is fixed, so we
      // wrap rather than widen its signature).
      // F191.7 — local-ingest defers vision to the $0 cc session. For a
      // standalone image with awaitingLocalCompile we return a $0 placeholder
      // instead of calling paid Haiku; the /local-ingest skill fetches the raw
      // image, views it, and writes the real description via PUT /content.
      describeImageAsSource: awaitingLocalCompile
        ? async (_buf, _mt, fn) => ({
            markdown: `# ${fn.replace(/\.[a-z0-9]+$/i, '')}\n\n*Billede — afventer lokal vision (F191.7).*`,
            costCents: 0,
            model: 'deferred-local-vision',
          })
        : (buf, mt, fn) => describeImageAsSource(buf, mt, fn, { tenantId, kbId }),
      transcribeAudio,
    }),
    timeoutMs,
    `${ext} extract "${filename}"`,
  );

  // Format-specific summary log. The pipeline.name lets us keep the
  // format prefix consistent with pre-F28 logs ("[pdf] foo.pdf: ...").
  if (pipeline.name === 'pdf' && result.images) {
    const describedCount = result.images.filter((i) => i.description).length;
    console.log(
      `[pdf] ${filename}: ${result.pageCount} pages, ${result.images.length} images ` +
        `(${describedCount} described)`,
    );
  } else if (pipeline.name === 'docx') {
    if (result.warnings.length) {
      console.log(`[docx] ${filename}: ${result.warnings.length} conversion warnings`);
    }
  } else if (pipeline.name === 'pptx') {
    console.log(`[pptx] ${filename}: ${result.slideCount} slide${result.slideCount === 1 ? '' : 's'} extracted`);
  } else if (pipeline.name === 'xlsx') {
    console.log(`[xlsx] ${filename}: ${result.sheetCount} sheet${result.sheetCount === 1 ? '' : 's'} extracted`);
  } else if (pipeline.name === 'image') {
    const cost = result.extractCostCents ?? 0;
    console.log(
      `[image] ${filename}: ${result.markdown.length} chars described, cost=${cost}¢` +
        (result.extractModel ? ` (${result.extractModel})` : ''),
    );
  } else if (pipeline.name === 'audio') {
    const cost = result.extractCostCents ?? 0;
    console.log(
      `[audio] ${filename}: ${result.markdown.length} chars transcribed, cost=${cost}¢` +
        (result.extractModel ? ` (${result.extractModel})` : ''),
    );
  }

  // F161 — persist extracted images to document_images so /retrieve,
  // image-search, and Vision-rerun work on structured data instead of
  // markdown alt-text. Pipelines that don't return images[] (docx,
  // xlsx, audio, etc.) just skip — persistImagesFromExtraction is a
  // no-op on empty arrays. Idempotent on re-ingest (deletes prior
  // rows for this docId before inserting fresh).
  if (Array.isArray(result.images) && result.images.length > 0) {
    try {
      const visionModel = getActiveVisionModel();
      // F226 — the Trail's own minimum image size. NULL for every KB that has
      // not set one, so behaviour is unchanged until a curator chooses.
      const kbRow = await trail.db
        .select({
          minImagePx: knowledgeBases.minImagePx,
          minImageEntropy: knowledgeBases.minImageEntropy,
        })
        .from(knowledgeBases)
        .where(eq(knowledgeBases.id, kbId))
        .get();
      const res = await persistImagesFromExtraction(
        trail,
        docId,
        tenantId,
        kbId,
        result.images,
        visionModel,
        kbRow?.minImagePx ?? null,
        kbRow?.minImageEntropy ?? null,
      );
      if (res.filteredBlank > 0) {
        // F229.1 — said out loud for the same reason as F226 below: a Trail
        // that quietly drops a fifth of its images looks identical to one that
        // extracted fewer.
        console.log(
          `[F229.1] ${docId}: discarded ${res.filteredBlank} image(s) with entropy below ${kbRow?.minImageEntropy}, kept ${res.inserted}`,
        );
      }
      if (res.filteredSmall > 0) {
        // Said out loud rather than counted in silence: "we filtered 690 small
        // images" and "extraction produced nothing" must never look alike.
        console.log(
          `[F226] ${docId}: filtered ${res.filteredSmall} image(s) below ${kbRow?.minImagePx}px, kept ${res.inserted}`,
        );
      }
    } catch (err) {
      // Don't fail the whole ingest if image-persist hiccups; the
      // bytes are still in storage and backfill will pick them up
      // next boot.
      console.warn(
        `[F161] persistImagesFromExtraction failed for ${docId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Title — pipeline result first, then strip extension from filename.
  const stem = filename.replace(/\.[a-z0-9]+$/i, '');
  const title = result.title ?? stem;
  // pageCount column doubles as slideCount/sheetCount for non-PDF.
  const pageCount = result.pageCount ?? result.slideCount ?? result.sheetCount ?? null;
  // F25/F156 — stamp extract cost so credits-tracking can sum it later.
  const extractCostCents = result.extractCostCents ?? 0;

  await trail.db
    .update(documents)
    .set({
      content: result.markdown,
      title,
      ...(pageCount !== null ? { pageCount } : {}),
      ...(extractCostCents > 0 ? { extractCostCents } : {}),
      ...(awaitingLocalCompile ? { awaitingLocalCompile: true } : {}),
      status: 'ready',
      version: 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(documents.id, docId))
    .run();

  if (result.markdown.trim()) {
    const chunks = chunkText(result.markdown);
    await storeChunks(trail, docId, tenantId, kbId, chunks);
  }

  // F191 — local-ingest uploads skip the cloud OpenRouter compile; the source
  // is parked for the /local-ingest skill to compile in-session ($0).
  if (!awaitingLocalCompile) {
    triggerIngest({ trail, docId, kbId, tenantId, userId });
  }

  // F165 — async Vision-describe. We extracted images without running
  // Vision inline; queue a background job to fill in descriptions. The
  // F164 vision-rerun handler runs with pLimit(4), reports SSE progress,
  // and is idempotent on `vision_description IS NULL` so a crashed/aborted
  // run can be re-submitted safely. Only fires for pipelines that produced
  // body-images (PDF today; pptx/docx if/when they extract images).
  // F191.7 — but NOT for local-ingest: paid cloud vision is exactly what we're
  // deferring. The embedded image rows stay vision_description=NULL and the
  // /local-ingest skill describes them in-session ($0) via /images?pending=1.
  if (!awaitingLocalCompile && Array.isArray(result.images) && result.images.length > 0) {
    try {
      const runner = getJobRunner();
      const jobId = await runner.submit<VisionRerunPayload>({
        kind: 'vision-rerun',
        tenantId,
        knowledgeBaseId: kbId,
        userId,
        payload: { documentIds: [docId], filter: 'null-only' },
      });
      console.log(
        `[F165] queued vision-rerun job=${jobId} doc=${docId} images=${result.images.length}`,
      );
    } catch (err) {
      // Non-fatal: doc is already 'ready', curator can trigger Vision
      // manually from the gallery / per-row Re-scan button.
      console.warn(
        `[F165] auto-submit vision-rerun failed for ${docId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ── Legacy shims (back-compat for recover-pending-sources.ts) ─────────
// All four helpers now route through processFileAsync; kept under the
// old names so existing callers don't break. Will be deleted once
// recover-pending-sources.ts is updated to call processFileAsync.

export const processPdfAsync = processFileAsync;
export const processDocxAsync = processFileAsync;
export const processPptxAsync = processFileAsync;
export const processXlsxAsync = processFileAsync;

function extractTitle(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}
