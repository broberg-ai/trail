/**
 * F230.1 — repair image rows whose `filename` starts with a slash.
 *
 * The cause is fixed in LocalStorage.list(); this repairs the rows that were
 * already written. 212 of Sanne's 1.557 images carry `/page-1-img-11.png`,
 * which makes the URL `.../images//page-1-img-11.png` — an empty path segment
 * that matches no route. The bytes are on disk and fine; only the address is
 * wrong.
 *
 * SHIPPED DARK, like rerunVisionOnNull. A data transform on a production
 * table is not something a deploy should perform on its own:
 *
 *   TRAIL_FIX_IMAGE_SLASH=1     — run the repair
 *   TRAIL_FIX_IMAGE_SLASH_DRY=1 — count only, change nothing
 *
 * Idempotent: a repaired row no longer matches the predicate, so a second run
 * reports 0 and writes nothing.
 */
import { documentImages, type TrailDatabase } from '@trail/db';
import { like } from 'drizzle-orm';
import { eq } from 'drizzle-orm';

export async function fixImageSlash(trail: TrailDatabase): Promise<void> {
  if (process.env.TRAIL_FIX_IMAGE_SLASH !== '1') return;
  const dry = process.env.TRAIL_FIX_IMAGE_SLASH_DRY === '1';

  const broken = await trail.db
    .select({
      id: documentImages.id,
      filename: documentImages.filename,
      storagePath: documentImages.storagePath,
    })
    .from(documentImages)
    .where(like(documentImages.filename, '/%'))
    .all();

  if (broken.length === 0) {
    console.log('[F230.1] no image rows with a leading slash — nothing to repair');
    return;
  }
  console.log(`[F230.1] ${broken.length} image row(s) with a leading slash${dry ? ' (DRY — nothing written)' : ''}`);
  if (dry) {
    for (const r of broken.slice(0, 5)) console.log(`  ${r.filename}  ←  ${r.storagePath}`);
    return;
  }

  let fixed = 0;
  for (const r of broken) {
    // Only the leading slash on the filename, and only a doubled slash in the
    // path. Deliberately NOT a general "tidy the string" pass: a repair that
    // rewrites more than the defect cannot be told apart from one that
    // corrupts, and a row that was never broken must come out untouched.
    const filename = r.filename.replace(/^\/+/, '');
    const storagePath = r.storagePath.replace(/\/{2,}/g, '/');
    if (filename === r.filename && storagePath === r.storagePath) continue;
    await trail.db
      .update(documentImages)
      .set({ filename, storagePath })
      .where(eq(documentImages.id, r.id))
      .run();
    fixed += 1;
  }
  console.log(`[F230.1] repaired ${fixed} image row(s)`);
}
