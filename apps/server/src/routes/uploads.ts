import { Hono } from 'hono';
import { documents, documentChunks, uploadSessions, knowledgeBases, type TrailDatabase } from '@trail/db';
import { and, desc, eq, ne, sql , isNotNull} from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { requireAuth, getUser, getTenant, getTrail, getAmbientKbGrant } from '../middleware/auth.js';
import { kildeIdentitet, laesSlukkedeKonnektorer, nyUdgaveErKanon, fingeraftryk, lighed, navnesag } from '@trail/shared';
import { processPdf, processDocx, processPptx, processXlsx, dispatch, pickPipeline } from '@trail/pipelines';
import { storage, sourcePath, stagingFsPath } from '../lib/storage.js';
import { chunkText, storeChunks } from '../services/chunker.js';
import { triggerIngest } from '../services/ingest.js';
import { describeImageAsSource, getActiveVisionModel } from '../services/vision.js';
import { transcribeAudio } from '../services/transcription.js';
import { resolveKbId, logActivity } from '@trail/core';
import { persistImagesFromExtraction } from '../services/document-images.js';
import { getJobRunner } from '../services/jobs/runner.js';
import type { VisionRerunPayload } from '../services/jobs/handlers/vision-rerun.js';
import type { ImageTriagePayload } from '../services/jobs/handlers/image-triage.js';

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

  // F263.17.3 — EN AFGRÆNSET NØGLE MÅ KUN UPLOADE TIL EN PRØVE-BRAIN.
  //
  // Christians ordre 17/9: «åbn upload for prøve-Brains». Den smalle udgave er
  // ikke en bredere nøgle — det er en egenskab ved MÅLET.
  //
  // `ambient` udelukker kilder med vilje (F201.2: «never keys, settings,
  // sources»). Havde vi bare sat upload på allowlisten, ville en Ambient
  // capture-enhed pludselig kunne lægge filer i den Brain den er parret med.
  // Det er en anden beslutning end den der blev truffet, og den ville være
  // sket i forbifarten.
  //
  // Derfor hænger udvidelsen på `isSandbox`. En uafgrænset nøgle (scopeKbIds
  // NULL — en curator, admin-fladen, en integration fra før F263.8) er URØRT
  // og kan uploade hvor som helst, præcis som hidtil.
  const grant = getAmbientKbGrant(c);
  if (grant) {
    const kb = await trail.db
      .select({ sandkasse: knowledgeBases.isSandbox, navn: knowledgeBases.name })
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, kbId))
      .get();
    if (!kb?.sandkasse) {
      return c.json({
        error: 'upload-requires-sandbox-kb',
        message: `«${kb?.navn ?? kbId}» er ikke en prøve-Brain. En afgrænset `
          + 'nøgle kan kun uploade til en Brain der er markeret som sandkasse.',
        knowledgeBaseId: kbId,
      }, 403);
    }
  }

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
  // F275.2 AC#4 — brugerens svar på «det er en ny kilde, ikke en ny udgave».
  // Uden den er default ON en lydløs overskrivning ved navnesammenfald.
  const nyKilde = c.req.query('nyKilde') === 'true';

  // F243.1 — UPSERT ON SOURCE URL. A re-push of the SAME page must update the
  // document, not create a twin.
  //
  // The consumer is broberg-ai-site's sync of its CMS pages into Aidan's
  // knowledge base: every document carries `metadata.sourceUrl`, and a re-sync
  // after an article edit used to double the KB — the assistant then cited the
  // old version side by side with the new. Owner's GO 4 September 2026:
  // «Ja tak til overskrivning-på-URL».
  //
  // The key is (tenant, KB, metadata.sourceUrl) over ACTIVE source documents.
  // Uploads without a sourceUrl take the exact path they always did — including
  // the F162 duplicate-hash 409 below. `?force=true` also skips this branch:
  // force has always meant "upload anyway as a separate Source", and an upsert
  // that ate the escape hatch would leave no way to intentionally fork a page.
  if (sourceUrl && !force) {
    const matches = await trail.db
      .select({ id: documents.id, contentHash: documents.contentHash })
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenant.id),
          eq(documents.knowledgeBaseId, kbId),
          eq(documents.kind, 'source'),
          eq(documents.archived, false),
          sql`json_extract(${documents.metadata}, '$.sourceUrl') = ${sourceUrl}`,
        ),
      )
      .orderBy(desc(documents.createdAt))
      .all();

    if (matches.length > 0) {
      // Several matches are possible historically (?force=true twins). The
      // NEWEST is updated, and the count rides in the response so an abnormal
      // state is visible instead of silently chosen away.
      const target = matches[0]!;

      if (target.contentHash === contentHash) {
        // Unchanged bytes: nothing is written — not even updatedAt, so a
        // no-op re-sync of 103 pages leaves no trace of churn. The consumer's
        // own proof is "0 new documents", and this branch is what makes a
        // full re-sync idempotent.
        const doc = await trail.db.select().from(documents).where(eq(documents.id, target.id)).get();
        console.log(`[upload] upsert-unchanged doc=${target.id} sourceUrl=${sourceUrl} ${lap()}`);
        return c.json({ ...doc, upsert: 'unchanged', upsertMatches: matches.length }, 200);
      }

      // Changed bytes: SAME document id (the consumer never has to book-keep
      // ids), new bytes, chunks rebuilt, compile re-triggered.
      console.log(`[upload] upsert-update doc=${target.id} sourceUrl=${sourceUrl} ${lap()}`);
      await storage.put(sourcePath(tenant.id, kbId, target.id, ext), buffer, file.type);

      const isTextUpdate = TEXT_EXTENSIONS.has(ext);
      const hasExtractorU = isTextUpdate || pickPipeline(file.name) !== null;
      const decoded = isTextUpdate ? new TextDecoder().decode(buffer) : null;
      await trail.db
        .update(documents)
        .set({
          filename: file.name,
          fileType: ext,
          fileSize: file.size,
          contentHash,
          metadata: JSON.stringify({ connector, sourceUrl }),
          // F275.1 — identiteten sættes SAMME sted som metadata. Står de to
          // hver sit sted, bliver de uenige den dag det ene bliver rettet.
          sourceIdentity: kildeIdentitet('url', sourceUrl),
          tags: uploadTags?.join(', ') ?? null,
          awaitingLocalCompile: localCompile,
          status: !hasExtractorU ? 'failed' : 'processing',
          errorMessage: !hasExtractorU ? unsupportedFormatMessage(ext) : null,
          ...(decoded !== null
            ? { content: decoded, title: ext === 'md' ? extractTitle(decoded) ?? file.name : file.name }
            : {}),
          version: sql<number>`COALESCE(${documents.version}, 1) + 1`,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(documents.id, target.id))
        .run();

      // Replace the search chunks — the pattern documents.ts:482 already uses.
      // The read-back rule applies to these: the F243 tests assert through the
      // SEARCH endpoint that old-only words stop matching and new words match.
      await trail.db.delete(documentChunks).where(eq(documentChunks.documentId, target.id)).run();
      if (decoded !== null && decoded.trim()) {
        const chunks = chunkText(decoded);
        await storeChunks(trail, target.id, tenant.id, kbId, chunks);
      }

      if (!isTextUpdate && pickPipeline(file.name) !== null) {
        processFileAsync(trail, target.id, tenant.id, kbId, user.id, file.name, buffer, localCompile).catch(async (err) => {
          console.error(`[pipeline] upsert re-run failed for ${file.name}:`, err);
          await trail.db
            .update(documents)
            .set({ status: 'failed', errorMessage: String(err).slice(0, 1000), updatedAt: new Date().toISOString() })
            .where(eq(documents.id, target.id))
            .run();
        });
      }

      await logActivity(trail, {
        tenantId: tenant.id,
        knowledgeBaseId: kbId,
        actorId: user.id,
        actorKind: 'user',
        kind: 'source.uploaded',
        subjectType: 'document',
        subjectId: target.id,
        summary: `Updated ${file.name} (re-push of same source URL)`,
        metadata: { fileType: ext, fileSize: file.size, connector: connector ?? 'upload', upsert: 'updated' },
      });

      if (isTextUpdate && !localCompile) {
        triggerIngest({ trail, docId: target.id, kbId, tenantId: tenant.id, userId: user.id });
      }

      const doc = await trail.db.select().from(documents).where(eq(documents.id, target.id)).get();
      return c.json({ ...doc, upsert: 'updated', upsertMatches: matches.length }, 200);
    }
  }
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
          error: 'A source with identical content already exists in this Brain.',
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
      // F275.1 — se ovenfor. `null` når der ingen URL er (en upload); den
      // identitet hører til F275.6's fingeraftryk, og null er sandt frem for gættet.
      sourceIdentity: uploadIdentitet(kbId, file.name, sourceUrl, nyKilde, docId),
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
    // F275.6 — lighedsaftrykket sættes hvor teksten FØRST findes. En binær fil
    // (PDF, DOCX) får sit når pipelinen har udtrukket teksten; indtil da er det
    // NULL, hvilket betyder «ikke målt» og ikke «ny kilde».
    const aftryk = fingeraftryk(content);
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
      .set({ content, title, status: 'processing', version: 1, contentFingerprint: aftryk })
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

  // F275.2 AC#4 — BESKED VED NAVNESAMMENFALD. Ejeren valgte default ON for
  // uploads mod rådgivningen, og denne besked er derfor det eneste sikkerhedsnet:
  // uden den er ON en lydløs overskrivning, og et lydløst indgreb kan ikke
  // skelnes fra at intet skete.
  //
  // Vi siger også OM afløsningen faktisk sker — begge kontakter læses her, ét
  // sted, gennem `nyUdgaveErKanon()`. En besked der påstod «dette erstatter …»
  // mens Brain-kontakten stod på FRA ville være forkert i den beroligende retning.
  // F275.6 — to sager, i rækkefølge. Navnesammenfaldet er det alvorligste
  // (identiteten siger allerede «samme kilde»), så det vinder. Er der intet
  // navnesammenfald, spørger vi om den ligner noget under et ANDET navn.
  const advarsel =
    (await navnesammenfaldAdvarsel(trail, tenant.id, kbId, doc, connector)) ??
    (doc
      ? await sammeVaerkNytNavn(trail, tenant.id, kbId, {
          id: doc.id,
          filename: doc.filename,
          contentFingerprint: doc.contentFingerprint,
        })
      : undefined);

  console.log(`[upload] response-ready 201 ${lap()}`);
  return c.json(advarsel ? { ...doc, advarsel } : doc, 201);
});

/**
 * F275.2 AC#4 — «det er en ny kilde, ikke en ny udgave.»
 *
 * Giver dokumentet sin egen identitet for altid. Fortrydelsen er en HANDLING og
 * ikke en indstilling: den gælder netop denne fil, den kan ikke komme til at
 * gælde noget andet, og den kan ikke falde tilbage ved næste upload.
 */
uploadRoutes.post('/documents/:id/ny-kilde', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const id = c.req.param('id');

  const doc = await trail.db
    .select({ id: documents.id, kbId: documents.knowledgeBaseId, filename: documents.filename })
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.tenantId, tenant.id)))
    .get();
  if (!doc) return c.json({ error: 'Not found' }, 404);

  // F263.8 — ANDEN DØR, ikke den første.
  //
  // Sikkerhedsgennemgangen af denne rute rejste spørgsmålet «kan en
  // ambient-afgrænset nøgle flytte identiteten i en Brain den ikke har fået?».
  // MÅLT, ikke antaget: nej — `AMBIENT_ALLOWED` i middleware/auth.ts er en
  // allowlist over STIER, og denne står ikke på den, så kaldet afvises med
  // «ambient key scope» før det når hertil. Min første antagelse var forkert,
  // og prøven herunder asserter derfor på den ÆGTE afvisning.
  //
  // Kontrollen bliver alligevel stående, og grunden er hvad der sker DEN DAG
  // nogen udvider allowlisten: den øverste spærre kender kun stier, ikke hvilken
  // Brain der ligger bag, så en ny linje i den liste ville åbne denne rute for
  // enhver Brain i lejemålet — stille. Præcis samme todeling som upload-ruten
  // ovenfor allerede bruger mod sandkasse-kravet.
  const grant = getAmbientKbGrant(c);
  if (grant && !grant.includes(doc.kbId)) {
    return c.json({ error: 'kb-not-granted', knowledgeBaseId: doc.kbId }, 403);
  }

  const identitet = kildeIdentitet('path', `${doc.kbId}/${doc.id}/${doc.filename}`);
  await trail.db
    .update(documents)
    .set({ sourceIdentity: identitet, updatedAt: new Date().toISOString() })
    .where(and(eq(documents.id, id), eq(documents.tenantId, tenant.id)))
    .run();

  // LÆS TILBAGE. En kolonne ORM'en taber lydløst ville ellers se ud som et
  // valg der blev registreret — og brugeren ville tro han havde reddet sin fil.
  const efter = await trail.db
    .select({ sourceIdentity: documents.sourceIdentity })
    .from(documents)
    .where(eq(documents.id, id))
    .get();
  if (efter?.sourceIdentity !== identitet) {
    return c.json({ error: 'ny-kilde-blev-ikke-gemt' }, 500);
  }
  return c.json({ id, sourceIdentity: efter.sourceIdentity });
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

/**
 * F275.2 — hvad ER en uploadet fils kilde-identitet?
 *
 * Ejerens afgørelse 16/9: **filnavn + Brain**. To gange `rapport.pdf` i samme
 * Brain er altså to udgaver af samme kilde, og den seneste er kanon.
 *
 * Han overtog forbeholdet bevidst — peer-sessionens råd var upload default OFF,
 * fordi en upload lige så godt kan være et TILLÆG som en erstatning. Prisen for
 * ON er derfor at to forskellige `rapport.pdf` lydløst ville overskrive hinandens
 * viden, og `nyKilde` er det eneste sted den pris kan betales tilbage: den giver
 * filen sin egen identitet for altid, så den aldrig kan læses som en ny udgave.
 *
 * En URL slår altid filnavnet — en site-sync-kilde ER sin adresse.
 */
function uploadIdentitet(
  kbId: string,
  filename: string,
  sourceUrl: string | null | undefined,
  nyKilde: boolean,
  docId: string,
): string | null {
  const url = kildeIdentitet('url', sourceUrl);
  if (url) return url;
  // docId'et gør identiteten unik for evigt. Uden det ville «ny kilde» kun
  // holde indtil næste upload med samme navn, og brugerens valg ville
  // forsvinde uden at nogen fik det at vide.
  return kildeIdentitet('path', nyKilde ? `${kbId}/${docId}/${filename}` : `${kbId}/${filename}`);
}

/**
 * F275.2 AC#4 — beskeden, bygget ÉT sted for begge upload-veje.
 *
 * Der er to: den gamle enkelt-POST og den chunk-delte, og admin-panelet bruger
 * KUN den chunk-delte. En besked der blev bygget hvert sted for sig ville derfor
 * kunne findes i en prøve og mangle på skærmen — netop det lydløse hul featuren
 * findes for at lukke.
 */
async function navnesammenfaldAdvarsel(
  trail: ReturnType<typeof getTrail>,
  tenantId: string,
  kbId: string,
  doc: { id: string; sourceIdentity: string | null; contentFingerprint?: string | null } | null | undefined,
  connector: string | null | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!doc) return undefined;
  const forrige = await forrigeUdgave(trail, tenantId, kbId, doc.sourceIdentity ?? null, doc.id);
  if (!forrige) return undefined;

  // Begge kontakter læses HER, gennem den ene resolver. Beskeden siger hvad der
  // SKER — ikke hvad der er sat op. En besked der påstod «dette erstatter …»
  // mens hovedafbryderen stod på FRA ville være forkert i den beroligende retning.
  const kbRow = await trail.db
    .select({ brain: knowledgeBases.newVersionIsCanon, off: knowledgeBases.canonOffConnectors })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, kbId))
    .get();
  const svar = nyUdgaveErKanon(
    { brain: kbRow?.brain ?? true, slukkedeKonnektorer: laesSlukkedeKonnektorer(kbRow?.off) },
    connector ?? 'upload',
  );
  // F275.6 — HVOR MEGET ligner de to hinanden? Aftrykket afgør ikke hvad der
  // sker; det afgør hvilken af de fire sager vi står i, og dermed hvad vi
  // SPØRGER om. Se fingeraftryk.ts for hvorfor ingen tærskel må afgøre.
  const grad = lighed(doc.contentFingerprint ?? null, forrige.contentFingerprint ?? null);
  const sag = navnesag(grad, true);

  return {
    kind: 'samme-kilde',
    erstatter: { id: forrige.id, filename: forrige.filename, uploadet: forrige.createdAt },
    erstatterNu: svar.kanon,
    grund: svar.grund,
    sag,
    lighed: grad,
    // Fortrydelsen skal med i beskeden, ellers er valget kun teoretisk.
    nyKildeEndpoint: `/api/v1/documents/${doc.id}/ny-kilde`,
  };
}

/**
 * F275.6 — SAMME VÆRK UNDER ET NYT NAVN.
 *
 * Den anden halvdel af advarselslampen: en fil hvis navn er FRIT, men hvis
 * indhold er næsten identisk med noget vi har i forvejen. Filnavn+Brain-
 * identiteten kan ikke se den — for navnene er jo forskellige — og uden dette
 * opslag lander «Årsrapport 2025 (endelig).pdf» ved siden af «Årsrapport
 * 2025.pdf» som to uafhængige værker, og hjernen svarer på begge.
 *
 * Vi sammenligner mod hver kilde i Brain'en. Målt på broberg.ai: 212 kilder, og
 * hver sammenligning er 64 strengstykker — prisen er intet ved siden af en
 * upload. Bliver det en dag for meget, er svaret et indeks, ikke at holde op
 * med at spørge.
 */
async function sammeVaerkNytNavn(
  trail: ReturnType<typeof getTrail>,
  tenantId: string,
  kbId: string,
  doc: { id: string; filename: string; contentFingerprint: string | null },
): Promise<Record<string, unknown> | undefined> {
  if (!doc.contentFingerprint) return undefined;

  const andre = await trail.db
    .select({
      id: documents.id,
      filename: documents.filename,
      createdAt: documents.createdAt,
      aftryk: documents.contentFingerprint,
    })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        eq(documents.knowledgeBaseId, kbId),
        eq(documents.kind, 'source'),
        eq(documents.archived, false),
        ne(documents.id, doc.id),
        isNotNull(documents.contentFingerprint),
      ),
    )
    .all();

  let bedst: { id: string; filename: string; createdAt: string; grad: number } | null = null;
  for (const a of andre) {
    if (a.filename === doc.filename) continue; // den sag er allerede dækket ovenfor
    const g = lighed(doc.contentFingerprint, a.aftryk);
    if (g === null) continue;
    if (!bedst || g > bedst.grad) bedst = { id: a.id, filename: a.filename, createdAt: a.createdAt, grad: g };
  }
  if (!bedst) return undefined;

  const sag = navnesag(bedst.grad, false);
  // Kun 'samme-vaerk-nyt-navn' er værd at forstyrre for. 'ny-kilde' er det
  // normale udfald for enhver upload, og en besked ved hver eneste ville være
  // støj — og en besked man lærer at klikke væk er ingen besked.
  if (sag !== 'samme-vaerk-nyt-navn') return undefined;

  return {
    kind: 'samme-vaerk-nyt-navn',
    ligner: { id: bedst.id, filename: bedst.filename, uploadet: bedst.createdAt },
    lighed: bedst.grad,
    sag,
    // Den ER en selvstændig kilde indtil nogen siger andet — vi spørger, vi
    // afgør ikke. Derfor peger fortrydelsen den ANDEN vej end ved navnesammenfald.
    besked:
      'Denne fil ligner en vi har i forvejen, under et andet navn. Er det en ny udgave ' +
      'af det samme værk, så giv den samme filnavn som den forrige — så afløser den. ' +
      'Er det et selvstændigt værk, skal du ikke gøre noget.',
  };
}

/**
 * F275.2 AC#4 — den forrige udgave af samme kilde, hvis der er en.
 *
 * Returnerer `null` når identiteten er `null`: «vi ved ikke hvilken kilde det er»
 * må ALDRIG kunne matche en anden ukendt og se ud som et navnesammenfald.
 */
async function forrigeUdgave(
  trail: ReturnType<typeof getTrail>,
  tenantId: string,
  kbId: string,
  identitet: string | null,
  egetDocId: string,
) {
  if (!identitet) return null;
  return (
    (await trail.db
      .select({
        id: documents.id,
        filename: documents.filename,
        createdAt: documents.createdAt,
        contentFingerprint: documents.contentFingerprint,
      })
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, tenantId),
          eq(documents.knowledgeBaseId, kbId),
          eq(documents.kind, 'source'),
          eq(documents.archived, false),
          eq(documents.sourceIdentity, identitet),
          ne(documents.id, egetDocId),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .get()) ?? null
  );
}

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
  // Resolve through the backend's staging location (F222.1: local uploads-root
  // on LocalStorage, DATA_DIR/upload-staging on Tigris) for hash-on-disk
  // verification + GC. We don't read this file via storage.get() because
  // partial reads are O(file-size) over the whole buffer; createReadStream
  // is fine.
  return stagingFsPath(tempPathFor(uploadId));
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
  // F280.1 — samme flag, samme navn, samme betydning som på enkelt-POST'en.
  const localCompileChunket = c.req.query('localCompile') === 'true';

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
          error: 'A source with identical content already exists in this Brain.',
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
      // F280.1 — PARKÉR, hvis der bliver bedt om det. Enkelt-POST'en har gjort
      // det hele tiden; denne vej læste slet ikke flaget, så en kilde der var
      // bedt parkeret til $0-kompilering blev alligevel sendt til skyen.
      awaitingLocalCompile: localCompileChunket,
      // F275.1 + F275.2 — samme identitet som enkelt-POST'en. Var de to veje
      // uenige om hvad en kildes identitet ER, ville det afhænge af hvilken
      // klient der uploadede om to filer var samme kilde.
      sourceIdentity: uploadIdentitet(
        kbId,
        filename,
        body.metadata?.sourceUrl,
        c.req.query('nyKilde') === 'true',
        docId,
      ),
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
      .set({
        content,
        title,
        status: 'processing',
        version: 1,
        // F275.6 — SAMME sted som enkelt-POST'en. Admin-panelet uploader kun ad
        // DENNE vej, så et aftryk der kun blev sat på den anden ville være
        // grønt i prøverne og fraværende på skærmen. Den fælde har allerede
        // kostet én gang i F275.2.
        contentFingerprint: fingeraftryk(content),
      })
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

  // F280.1 — SAMME SPÆRRE SOM SØSKENDEN på linje ~462. Uden `!parkeret` blev en
  // kilde der udtrykkeligt var bedt parkeret til gratis kompilering alligevel
  // sendt til en betalt sky-model — og en sky-kompilering ser ud som en
  // vellykket kompilering, så regningen ville komme uden en beslutning bag.
  const parkeret = await trail.db
    .select({ p: documents.awaitingLocalCompile })
    .from(documents)
    .where(eq(documents.id, session.documentId))
    .get();
  if (isText && !parkeret?.p) {
    triggerIngest({
      trail,
      docId: session.documentId,
      kbId: session.knowledgeBaseId,
      tenantId: tenant.id,
      userId: user.id,
    });
  }

  // F275.2 AC#4 — beskeden hører til HER også. Admin-panelet uploader kun ad
  // denne vej, så uden den ville sikkerhedsnettet kun findes i prøverne.
  const advarsel =
    (await navnesammenfaldAdvarsel(trail, tenant.id, session.knowledgeBaseId, doc, connector)) ??
    (doc
      ? await sammeVaerkNytNavn(trail, tenant.id, session.knowledgeBaseId, {
          id: doc.id,
          filename: doc.filename,
          contentFingerprint: doc.contentFingerprint,
        })
      : undefined);

  return c.json(advarsel ? { doc, advarsel } : { doc }, 201);
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
      // F232.1 — extraction writes into the PENDING store. Nothing is in the
      // Trail until the triage job has decided it is worth keeping. The public
      // URL below is unchanged on purpose: it names the document and the file,
      // not where the bytes sit, so promotion is invisible to the markdown the
      // extractor writes.
      imagePrefix: `${tenantId}/${kbId}/${docId}/images-pending`,
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
        // F232.1 — the entropy gate has MOVED OUT of the ingest path. It is now
        // step 1 of the triage job (F232.3), where it decides whether to spend
        // a model call rather than whether to keep a row. Passing null keeps
        // the function's contract intact without evaluating anything here.
        null,
        'pending',
      );
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
      // F232.3 — this is now TRIAGE, not merely description. The images are
      // sitting in the pending store; the job decides which of them are worth
      // anything, deletes the rest, and moves the survivors into the Trail.
      // Vision + OCR happen inside it, so the old vision-rerun submit here
      // would have described images that were about to be deleted.
      const jobId = await runner.submit<ImageTriagePayload>({
        kind: 'image-triage',
        tenantId,
        knowledgeBaseId: kbId,
        userId,
        payload: { documentIds: [docId] },
      });
      console.log(
        `[F232.3] queued image-triage job=${jobId} doc=${docId} images=${result.images.length}`,
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
