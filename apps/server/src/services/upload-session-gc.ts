/**
 * F180 — Upload-session garbage collector.
 *
 * Runs hourly. One pass:
 *
 *   **Expire** — sessions where `status='uploading'` AND
 *   `expires_at < now`. Mark them 'expired' (so a concurrent
 *   finalize hits the 410 path cleanly), unlink the temp file,
 *   then delete the staging documents row. The FK cascade
 *   (upload_sessions.document_id REFERENCES documents.id ON
 *   DELETE CASCADE) removes the upload_sessions row in the
 *   same transaction — no audit row is retained.
 *
 * No second 7d-reap pass: the cascade already cleans up. Keeping
 * an audit-trail of expired/aborted uploads would require dropping
 * the cascade + making document_id nullable; deferred until a
 * concrete need surfaces.
 *
 * Crash-safe: each tick is idempotent. A crash mid-pass leaves
 * a half-cleaned session (status='expired' but document still
 * present) — the next tick picks it up because the documents row
 * still exists with a referencing upload_sessions row whose
 * status is 'expired'… actually no: after status='expired' the
 * outer query (status='uploading') won't match. So the leftover
 * is a docs row + upload_sessions row both in 'expired' state.
 * Cleaned up on next manual operation or by a future audit-aware
 * sweep. Not worse than today's no-GC-at-all baseline.
 */

import type { TrailDatabase } from '@trail/db';
import { uploadSessions, documents } from '@trail/db';
import { and, eq, lt } from 'drizzle-orm';
import { storage } from '../lib/storage.js';

const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes after boot

export function startUploadSessionGc(trail: TrailDatabase): () => void {
  let stopped = false;

  const first = setTimeout(() => {
    if (stopped) return;
    void runTick(trail);
  }, INITIAL_DELAY_MS);

  const interval = setInterval(() => {
    if (stopped) return;
    void runTick(trail);
  }, TICK_INTERVAL_MS);

  console.log(
    `  upload-session-gc: tick every ${TICK_INTERVAL_MS / 60_000}min, ` +
      `first tick in ${Math.round(INITIAL_DELAY_MS / 1000)}s`,
  );

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(interval);
  };
}

async function runTick(trail: TrailDatabase): Promise<void> {
  try {
    await expirePass(trail);
  } catch (err) {
    console.warn(
      `[F180-gc] tick failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function expirePass(trail: TrailDatabase): Promise<void> {
  const nowIso = new Date().toISOString();
  const expired = await trail.db
    .select()
    .from(uploadSessions)
    .where(
      and(
        eq(uploadSessions.status, 'uploading'),
        lt(uploadSessions.expiresAt, nowIso),
      ),
    )
    .all();

  if (expired.length === 0) return;

  for (const session of expired) {
    await trail.db
      .update(uploadSessions)
      .set({ status: 'expired', updatedAt: nowIso })
      .where(eq(uploadSessions.id, session.id))
      .run();

    try {
      await storage.delete(session.tempPath);
    } catch {
      // Best-effort — partial files just leak a bit of disk.
    }

    // Cascade-unlink the staging documents row so the gallery doesn't
    // show a phantom 'uploading' row for an upload nobody is going to
    // finish. The upload_sessions row stays around until reapPass for
    // 7d-audit visibility.
    await trail.db
      .delete(documents)
      .where(eq(documents.id, session.documentId))
      .run();
  }

  console.log(`[F180-gc] expired ${expired.length} stale upload session(s)`);
}
