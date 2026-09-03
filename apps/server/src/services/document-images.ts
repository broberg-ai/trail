/**
 * F161 — persist image-metadata to `document_images` from pipeline
 * extraction results.
 *
 * The PDF pipeline (and the standalone image-pipeline) writes image
 * bytes to storage and returns an `ExtractedImage[]` array. Pre-F161
 * that array got embedded as alt-text in the compiled wiki-Neuron's
 * markdown and then forgotten. This service is the bridge that turns
 * the in-memory array into structured rows so /retrieve, image-search,
 * Vision-rerun, and audience-filter can all work off a single source
 * of truth.
 *
 * Idempotent per (document_id, filename): if the upload re-fires
 * (e.g. after a pipeline retry), we delete prior rows for the doc
 * before inserting fresh ones. Avoids duplicate rows on re-ingest
 * without making callers think about it.
 */

import { createHash } from 'node:crypto';
import { documentImages, type TrailDatabase } from '@trail/db';
import { eq } from 'drizzle-orm';
import { storage } from '../lib/storage.js';

export interface ExtractedImageRow {
  filename: string;
  storagePath: string;
  page?: number;
  width: number;
  height: number;
  description?: string;
}

/**
 * F226 — is this image big enough to be worth storing?
 *
 * Measured on Sanne's Trail (1.557 images): a THIRD of every image row is a
 * bullet, a rule or a logo fragment lifted out of a PDF, and together they are
 * 0,03% of the bytes. The cost of keeping them is not disk — it is a vision
 * description per meaningless image and an image search full of dots.
 *
 * The threshold is on the SMALLEST SIDE, deliberately, not on area and not on
 * file size:
 *   · area would pass a 2000x10 divider rule, which is exactly the shape we
 *     want gone;
 *   · bytes measure the wrong property — a 1 MB file can be a 20x20 icon and a
 *     2 KB file a meaningful 400x400 line drawing.
 *
 * `>=` and not `>`: an image exactly AT the threshold is kept.
 */
export function isImageLargeEnough(
  width: number,
  height: number,
  minPx: number | null | undefined,
): boolean {
  if (minPx == null || minPx <= 0) return true; // no filter configured
  // A missing dimension is NOT a small image — it is an unknown one, and
  // discarding on absent data would silently drop images whose extractor
  // simply did not report a size.
  if (!width || !height) return true;
  return Math.min(width, height) >= minPx;
}

export async function persistImagesFromExtraction(
  trail: TrailDatabase,
  docId: string,
  tenantId: string,
  kbId: string,
  extracted: ExtractedImageRow[],
  visionModel: string | null,
  minImagePx: number | null = null,
): Promise<{ inserted: number; skipped: number; filteredSmall: number }> {
  if (extracted.length === 0) {
    return { inserted: 0, skipped: 0, filteredSmall: 0 };
  }

  // Re-running the same upload (manual reingest, recover-pending-sources
  // etc.) shouldn't multiply rows. Drop any prior rows for this doc and
  // insert fresh — the delete is FK-cascade-safe because no other table
  // references document_images.
  await trail.db.delete(documentImages).where(eq(documentImages.documentId, docId)).run();

  let inserted = 0;
  let skipped = 0;
  let filteredSmall = 0;
  const visionAt = new Date().toISOString();

  for (const img of extracted) {
    // F226 — filter BEFORE we read the bytes: a decorative fragment should
    // cost us neither a storage read nor a row nor a vision description.
    // Counted separately from `skipped` on purpose — "we chose not to keep
    // this" and "we could not read it" are different facts, and merging them
    // is the failure this repo has met all week.
    if (!isImageLargeEnough(img.width, img.height, minImagePx)) {
      filteredSmall += 1;
      continue;
    }
    try {
      const bytes = await storage.get(img.storagePath);
      if (!bytes) {
        skipped += 1;
        console.warn(`[F161] persist skip — no bytes at ${img.storagePath}`);
        continue;
      }
      const contentHash = createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
      await trail.db
        .insert(documentImages)
        .values({
          id: `dim_${crypto.randomUUID().slice(0, 12)}`,
          documentId: docId,
          tenantId,
          knowledgeBaseId: kbId,
          filename: img.filename,
          storagePath: img.storagePath,
          contentHash,
          sizeBytes: bytes.length,
          page: img.page ?? null,
          width: img.width,
          height: img.height,
          visionDescription: img.description?.trim() ?? null,
          visionModel: img.description ? visionModel : null,
          visionAt: img.description ? visionAt : null,
        })
        .run();
      inserted += 1;
    } catch (err) {
      skipped += 1;
      console.warn(
        `[F161] persist failed for ${img.filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { inserted, skipped, filteredSmall };
}
