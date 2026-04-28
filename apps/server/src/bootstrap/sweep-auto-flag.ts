/**
 * F163.2 Phase 5 — opt-in sweep-job for legacy image descriptions.
 *
 * Runs at engine boot when TRAIL_VISION_AUTO_FLAG_SWEEP=1 is set.
 * Pure regex-pass via parseQualitySignal() over rows where:
 *   - auto_flag_signal = 0 (haven't been touched by the new pipeline)
 *   - vision_description IS NOT NULL (no point regex-matching empty text)
 *
 * Forward-flow Vision-runs (post-F163.2 Phase 1+2 ship) already stamp
 * auto_flag_signal correctly. This sweep covers existing descriptions
 * stamped before the feature shipped.
 *
 * Idempotent: re-runs find no new candidates because matched rows now
 * have auto_flag_signal=1 (and so are excluded by the WHERE clause).
 *
 * Cost: zero LLM calls. Pure string-matching against descriptions
 * already in the DB. Safe to run on tenants with 100,000+ images.
 */

import { documentImages, type TrailDatabase } from '@trail/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { parseQualitySignal } from '../services/vision.js';

export async function sweepAutoFlag(trail: TrailDatabase): Promise<void> {
  if (process.env.TRAIL_VISION_AUTO_FLAG_SWEEP !== '1') return;

  const candidates = await trail.db
    .select({
      id: documentImages.id,
      visionDescription: documentImages.visionDescription,
    })
    .from(documentImages)
    .where(
      and(
        eq(documentImages.autoFlagSignal, 0),
        isNotNull(documentImages.visionDescription),
      ),
    )
    .all();

  if (candidates.length === 0) {
    console.log('[F163.2 sweep] no legacy candidates — nothing to do');
    return;
  }

  console.log(`[F163.2 sweep] scanning ${candidates.length} legacy description(s)…`);

  let flagged = 0;
  const reasonHist: Record<string, number> = {};
  const now = new Date().toISOString();

  for (const row of candidates) {
    if (!row.visionDescription) continue;
    // Marker won't be present on legacy rows (they predate the
    // QUALITY-marker prompt), so parseQualitySignal will only fire the
    // regex backstop. That's exactly what this sweep is for.
    const { autoFlag } = parseQualitySignal(row.visionDescription);
    if (!autoFlag.signal) continue;
    await trail.db
      .update(documentImages)
      .set({
        autoFlagSignal: 1,
        autoFlagReason: autoFlag.reason,
        updatedAt: now,
      })
      .where(eq(documentImages.id, row.id))
      .run();
    flagged += 1;
    if (autoFlag.reason) {
      reasonHist[autoFlag.reason] = (reasonHist[autoFlag.reason] ?? 0) + 1;
    }
  }

  const histStr = Object.entries(reasonHist)
    .map(([r, n]) => `${r}=${n}`)
    .join(', ');
  console.log(
    `[F163.2 sweep] flagged ${flagged} of ${candidates.length}` +
      (histStr ? ` (${histStr})` : ''),
  );
}
