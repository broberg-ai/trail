/**
 * F232.3 — the triage job: does this image hold anything of value?
 *
 * THE OWNER'S DESIGN, in his words: *"kør en kontrol om der er noget af værdi
 * på billede inden det får lov at komme igennem. Det skal ikke være en
 * blokkerende proces. Når Ingest og compilation er færdig kan et job begynde at
 * kigge på billeder fra et temp lager og slette det der ikke er noget værd."*
 *
 * So this runs AFTER compilation, over the pending store, and it is allowed to
 * delete. Ingest never waits for it and never pays for it.
 *
 * TWO STEPS, AND THE ORDER IS THE WHOLE SAVING:
 *
 *   1. ENTROPY — free, local, no model. A solid fill measures exactly 0.
 *      296 of Sanne's 1.557 images are exactly that, so this step alone
 *      removes ~19% of the corpus for nothing. It is ALSO a correctness guard:
 *      measured, Mistral OCR invents a LaTeX formula when handed a blank
 *      rectangle, so asking a model about a blank image is not merely wasteful
 *      — it fabricates.
 *
 *   2. VISION + OCR — the cheap EU pair we already run. "Nothing of value"
 *      means BOTH are empty: no description AND no readable text. Both, not
 *      either — an image with no describable subject but readable text is a
 *      scanned page, and that is exactly the thing worth keeping.
 *
 * A FAILED MODEL CALL NEVER DELETES. The image stays pending and the next run
 * judges it. Deleting on a provider hiccup would destroy a customer's material
 * because a network was briefly unhappy, and the count would look like a
 * successful triage.
 */
import { documentImages, knowledgeBases, type TrailDatabase } from '@trail/db';
import { and, eq } from 'drizzle-orm';
import pLimit from 'p-limit';
import { storage, imagePath } from '../../../lib/storage.js';
import { imageEntropyVerdict } from '../../document-images.js';
import { createVisionBackendWithMetadata, getActiveVisionModel, ocrImage } from '../../vision.js';
import type { JobHandler } from '../types.js';

export interface ImageTriagePayload {
  /** Documents whose pending images should be judged. */
  documentIds: string[];
}

export interface ImageTriageResult {
  total: number;
  /** Removed by the free entropy step — no model call was made for these. */
  blankDeleted: number;
  /** Removed after vision+OCR both came back empty. */
  worthlessDeleted: number;
  kept: number;
  /** Left pending because a call failed. NOT deleted, NOT kept. */
  deferred: number;
  model: string;
}

const CONCURRENCY = Number(process.env.TRAIL_TRIAGE_CONCURRENCY ?? 4);

/** Entropy below this is a picture of nothing. See F229/F232 plan-docs for the
 *  measured distribution: 296 images at exactly 0, an EMPTY band from 0.0001 to
 *  0.01, and the least contentful readable thing we could build at 0.0222. */
const BLANK_FLOOR = 0.01;

export const imageTriageHandler: JobHandler<ImageTriagePayload, ImageTriageResult> = async (
  ctx,
) => {
  const payload = ctx.payload as ImageTriagePayload | null;
  if (!payload?.documentIds?.length) {
    throw new Error('image-triage: payload.documentIds[] required');
  }

  const rows = await ctx.trail.db
    .select({
      id: documentImages.id,
      documentId: documentImages.documentId,
      knowledgeBaseId: documentImages.knowledgeBaseId,
      filename: documentImages.filename,
      storagePath: documentImages.storagePath,
      page: documentImages.page,
      width: documentImages.width,
      height: documentImages.height,
      kbLanguage: knowledgeBases.language,
    })
    .from(documentImages)
    .innerJoin(knowledgeBases, eq(knowledgeBases.id, documentImages.knowledgeBaseId))
    .where(
      and(eq(documentImages.tenantId, ctx.tenantId), eq(documentImages.triage, 'pending')),
    )
    .all();

  const scoped = rows.filter((r) => payload.documentIds.includes(r.documentId));
  const total = scoped.length;
  const model = getActiveVisionModel();

  if (total === 0) {
    await ctx.report({ current: 0, total: 0, etaMs: null, phase: 'no-candidates' });
    return {
      result: { total: 0, blankDeleted: 0, worthlessDeleted: 0, kept: 0, deferred: 0, model },
    };
  }

  const backend = createVisionBackendWithMetadata({ tenantId: ctx.tenantId });
  if (!backend) {
    // NO VISION CONFIGURED IS NOT A VERDICT. Without a model we cannot say an
    // image is worthless, and the entropy step alone would delete the blanks
    // while silently leaving every other image pending forever — a half-done
    // triage that looks like a finished one. Fail loudly instead.
    throw new Error('image-triage: no vision backend configured (MISTRAL_API_KEY missing)');
  }
  let blankDeleted = 0;
  let worthlessDeleted = 0;
  let kept = 0;
  let deferred = 0;
  let done = 0;

  const report = async (phase: string) =>
    ctx.report({ current: done, total, etaMs: null, phase, extra: { blankDeleted, worthlessDeleted, kept, deferred } });
  await report('starting');

  /** Row + bytes, both. A row without bytes is a broken link; bytes without a
   *  row are invisible waste. Neither half alone is a deletion. */
  const discard = async (row: (typeof scoped)[number], why: string) => {
    await storage.delete(row.storagePath).catch((err) => {
      console.warn(`[F232.3] could not delete ${why} bytes at ${row.storagePath}: ${err}`);
    });
    await ctx.trail.db.delete(documentImages).where(eq(documentImages.id, row.id)).run();
  };

  const limit = pLimit(CONCURRENCY);
  await Promise.all(
    scoped.map((row) =>
      limit(async () => {
        if (ctx.signal.aborted) return;
        try {
          const bytes = await storage.get(row.storagePath);
          if (!bytes) {
            // No bytes to judge. Not a verdict — leave the row for a human.
            deferred += 1;
            return;
          }

          // ── 1. free ──
          const verdict = await imageEntropyVerdict(bytes, BLANK_FLOOR);
          if (verdict.kind === 'blank') {
            await discard(row, 'blank');
            blankDeleted += 1;
            return;
          }

          // ── 2. paid, and only now ──
          const described = await backend(bytes, {
            page: row.page ?? 0,
            width: row.width,
            height: row.height,
            filename: row.filename,
            language: row.kbLanguage,
          });
          const ocr = await ocrImage(bytes, 'image/png', { tenant: ctx.tenantId });

          const hasDescription = Boolean(described.description?.trim());
          const hasText = Boolean(ocr?.text?.trim());
          if (!hasDescription && !hasText) {
            await discard(row, 'worthless');
            worthlessDeleted += 1;
            return;
          }

          // ── keep: move the bytes into the Trail, then record it ──
          const finalPath = imagePath(
            ctx.tenantId,
            row.knowledgeBaseId,
            row.documentId,
            row.filename,
          );
          await storage.put(finalPath, bytes, 'image/png');
          const now = new Date().toISOString();
          await ctx.trail.db
            .update(documentImages)
            .set({
              triage: 'kept',
              storagePath: finalPath,
              visionDescription: described.description ?? null,
              visionModel: described.description ? model : null,
              visionAt: now,
              ocrText: ocr?.text ?? null,
              ocrModel: ocr?.text ? ocr.model : null,
              ocrAt: ocr ? now : null,
              updatedAt: now,
            })
            .where(eq(documentImages.id, row.id))
            .run();
          // Only after the row points at the new bytes — an interruption
          // between the two leaves a duplicate, never a dangling row.
          await storage.delete(row.storagePath).catch(() => {});
          kept += 1;
        } catch (err) {
          // A failed call is NOT a verdict. The row stays pending.
          deferred += 1;
          console.warn(
            `[F232.3 job=${ctx.jobId}] image=${row.id} deferred: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          done += 1;
          await report('triaging');
        }
      }),
    ),
  );

  console.log(
    `[F232.3] doc(s)=${payload.documentIds.length}: ${blankDeleted} blank (free), ${worthlessDeleted} worthless, ${kept} kept, ${deferred} deferred`,
  );
  return { result: { total, blankDeleted, worthlessDeleted, kept, deferred, model } };
};
