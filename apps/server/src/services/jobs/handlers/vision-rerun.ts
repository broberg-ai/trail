/**
 * F164 Phase 2 — vision-rerun job handler.
 *
 * Generalises the synchronous loop that lived in
 * `routes/documents.ts:/rerun-vision` into a background-job handler.
 * Per-image concurrency = 4 via pLimit so 224 images take ~56s instead
 * of ~750s sequential. Progress reported per-image so the SSE channel
 * (and admin progress modal in Phase 4) sees live updates.
 *
 * Idempotency: filters on `vision_description IS NULL` — already-
 * described rows are skipped. Resume after crash picks up where it
 * left off automatically.
 *
 * Failure semantics:
 *   - Per-image failures stamp `vision_at` (mark scanned) but leave
 *     description NULL. They count toward `failed`. Operator can re-
 *     run; the NULL-filter still picks them up because vision_at-set-
 *     but-description-NULL means "tried but failed", and we do NOT
 *     skip those — only `vision_description IS NOT NULL` skips.
 *   - "Decorative" sentinel from Vision (model says "this image has no
 *     content worth describing") stamps vision_at + vision_model
 *     without description and counts toward `decorative`. NULL-filter
 *     would re-process these on re-run; that's fine — same answer.
 *
 * Cost tracking: not implemented in Phase 2 (Anthropic primary lands
 * in Phase 3 with proper token-based cost computation). For now, cost
 * is null and the progress modal shows "—" instead of $X.
 */

import { documentImages, documents, knowledgeBases, type TrailDatabase } from '@trail/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import pLimit from 'p-limit';
import { storage } from '../../../lib/storage.js';
import { applyDimensionFlag, createVisionBackendWithMetadata, getActiveVisionModel } from '../../vision.js';
import { ensureDerivative } from '../../vision-derivative.js';
import type { JobContext, JobHandler } from '../types.js';

export interface VisionRerunPayload {
  /** One or many docs. Bulk path passes all KB sources here. Mutually
   *  exclusive with imageIds at runtime — imageIds wins if both are
   *  set, since it's the more specific scope. */
  documentIds?: string[];
  /** Per-image scope. Used by the gallery-row "Kør vision" button to
   *  re-scan a single image without touching its siblings. */
  imageIds?: string[];
  /** 'null-only' = only re-vision NULL rows (default). 'all' = re-vision everything. */
  filter?: 'null-only' | 'all';
}

export interface VisionRerunResult {
  total: number;
  described: number;
  decorative: number;
  failed: number;
  model: string;
  /** Up to 6 random described rows for the visual-verification grid (Phase 5). */
  sampleImages: Array<{
    id: string;
    documentId: string;
    filename: string;
    description: string;
  }>;
}

const PER_IMAGE_CONCURRENCY = Number(process.env.TRAIL_VISION_CONCURRENCY ?? 4);

export const visionRerunHandler: JobHandler<VisionRerunPayload, VisionRerunResult> = async (ctx) => {
  const payload = ctx.payload as VisionRerunPayload | null;
  const hasImageIds = (payload?.imageIds?.length ?? 0) > 0;
  const hasDocIds = (payload?.documentIds?.length ?? 0) > 0;
  if (!hasImageIds && !hasDocIds) {
    throw new Error('vision-rerun: payload.imageIds[] or payload.documentIds[] required');
  }

  const filter = payload!.filter ?? 'null-only';
  // F163.2 — use the metadata-aware backend so we can stamp
  // auto_flag_signal alongside the description.
  // F190.6 — stamp tenantId for per-tenant cost in upmetrics. A batch can span
  // KBs (doc-scope), so only the tenant (the billing key) is constant here; the
  // per-KB split for embedded-image vision is left out by design.
  const backend = createVisionBackendWithMetadata({ tenantId: ctx.tenantId });
  if (!backend) {
    throw new Error(
      'No Vision backend configured (set ANTHROPIC_API_KEY or OPENROUTER_API_KEY)',
    );
  }
  const model = getActiveVisionModel();

  // F163.3 Phase 0 — JOIN knowledge_bases so we can pass KB.language
  // to the Vision-prompt per-image. Single SELECT (no N+1) keeps this
  // negligible even on 1000+ image batches.
  const candidatesQuery = ctx.trail.db
    .select({
      id: documentImages.id,
      documentId: documentImages.documentId,
      storagePath: documentImages.storagePath,
      filename: documentImages.filename,
      page: documentImages.page,
      width: documentImages.width,
      height: documentImages.height,
      sizeBytes: documentImages.sizeBytes,
      visionDerivativePath: documentImages.visionDerivativePath,
      kbLanguage: knowledgeBases.language,
    })
    .from(documentImages)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, documentImages.knowledgeBaseId));

  let candidates;
  if (hasImageIds) {
    // Per-image scope. Tenant_id sits on document_images directly so
    // we filter there — no need to validate the parent doc separately.
    // 'filter' param is ignored: user explicitly picked these ids.
    candidates = await candidatesQuery
      .where(
        and(
          inArray(documentImages.id, payload!.imageIds!),
          eq(documentImages.tenantId, ctx.tenantId),
        ),
      )
      .all();
  } else {
    // Doc-scope. Validate all docs belong to this tenant + are sources.
    const docs = await ctx.trail.db
      .select({ id: documents.id, tenantId: documents.tenantId, kind: documents.kind })
      .from(documents)
      .where(inArray(documents.id, payload!.documentIds!))
      .all();
    for (const d of docs) {
      if (d.tenantId !== ctx.tenantId) {
        throw new Error(`vision-rerun: doc ${d.id} not in tenant ${ctx.tenantId}`);
      }
      if (d.kind !== 'source') {
        throw new Error(`vision-rerun: doc ${d.id} is not a source`);
      }
    }

    candidates = await (filter === 'all'
      ? candidatesQuery.where(inArray(documentImages.documentId, payload!.documentIds!)).all()
      : candidatesQuery
          .where(
            and(
              inArray(documentImages.documentId, payload!.documentIds!),
              isNull(documentImages.visionDescription),
            ),
          )
          .all());
  }

  const total = candidates.length;
  if (total === 0) {
    await ctx.report({ current: 0, total: 0, etaMs: null, phase: 'no-candidates' });
    return {
      result: { total: 0, described: 0, decorative: 0, failed: 0, model, sampleImages: [] },
    };
  }

  let described = 0;
  let decorative = 0;
  let failed = 0;
  const start = Date.now();

  const reportNow = async (phase: string) => {
    const done = described + decorative + failed;
    const elapsed = Date.now() - start;
    const rate = elapsed > 0 ? done / elapsed : 0;
    const remaining = total - done;
    const etaMs = rate > 0 ? Math.round(remaining / rate) : null;
    await ctx.report({
      current: done,
      total,
      etaMs,
      phase,
      extra: { described, decorative, failed },
    });
  };

  await reportNow('starting');

  const limit = pLimit(PER_IMAGE_CONCURRENCY);
  const tasks = candidates.map((row) =>
    limit(async () => {
      if (ctx.signal.aborted) return;
      try {
        // F165.1 — derive WebP if original > 5MB or > 4MP. The
        // derivative path is persisted on the row so a subsequent
        // re-vision pass uses the cached file. ensureDerivative
        // throws if the original is missing — caller treats as
        // failed, same as the previous storage.get-was-null branch.
        const derivative = await ensureDerivative(
          row.storagePath,
          row.width,
          row.height,
          row.sizeBytes,
        ).catch(() => null);
        if (!derivative) {
          failed += 1;
          return;
        }
        if (derivative.isDerivative && derivative.derivativePath !== row.visionDerivativePath) {
          await ctx.trail.db
            .update(documentImages)
            .set({ visionDerivativePath: derivative.derivativePath })
            .where(eq(documentImages.id, row.id))
            .run();
        }
        const result = await backend(derivative.bytes, {
          page: row.page ?? 0,
          width: row.width,
          height: row.height,
          filename: row.filename,
          language: row.kbLanguage,
        });
        const visionAt = new Date().toISOString();
        if (!result.description) {
          // Decorative sentinel — mark as scanned + auto-flag (Vision
          // told us nothing's worth describing; that's exactly what
          // F163.2's filter wants to surface).
          await ctx.trail.db
            .update(documentImages)
            .set({
              visionAt,
              visionModel: model,
              autoFlagSignal: 1,
              autoFlagReason: 'vision-decorative',
              updatedAt: visionAt,
            })
            .where(eq(documentImages.id, row.id))
            .run();
          decorative += 1;
          return;
        }
        // F163.2 — stamp auto_flag_signal alongside description.
        // F163.2.1 — layer dim-check on top of the model's text-based
        // signal. Re-parsing result.description would lose the
        // [QUALITY:] marker (it's been stripped), so we keep the
        // existing signal as authoritative for text and only override
        // when text said 'normal' AND image is dimensionally tiny.
        const finalFlag = applyDimensionFlag(result.autoFlag, row.width, row.height);
        await ctx.trail.db
          .update(documentImages)
          .set({
            visionDescription: result.description,
            visionModel: model,
            visionAt,
            autoFlagSignal: finalFlag.signal ? 1 : 0,
            autoFlagReason: finalFlag.reason,
            updatedAt: visionAt,
          })
          .where(eq(documentImages.id, row.id))
          .run();
        described += 1;
      } catch (err) {
        failed += 1;
        console.warn(
          `[vision-rerun job=${ctx.jobId}] image=${row.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        await reportNow('describing');
      }
    }),
  );

  await Promise.all(tasks);

  // Sample-grid for visual verification (Phase 5 modal): up to 6 random
  // newly-described images from the scope we just operated on.
  // RANDOM() at SQLite-level keeps it cheap.
  const sampleScope = hasImageIds
    ? { col: 'id', vals: payload!.imageIds! }
    : { col: 'document_id', vals: payload!.documentIds! };
  const samples = await ctx.trail.execute(
    `
    SELECT id, document_id, filename, vision_description
      FROM document_images
     WHERE ${sampleScope.col} IN (${sampleScope.vals.map(() => '?').join(',')})
       AND vision_description IS NOT NULL
     ORDER BY RANDOM()
     LIMIT 6
    `,
    sampleScope.vals,
  );

  const sampleImages = (samples.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    documentId: String(r.document_id),
    filename: String(r.filename),
    description: String(r.vision_description ?? ''),
  }));

  return {
    result: {
      total,
      described,
      decorative,
      failed,
      model,
      sampleImages,
    },
  };
};
