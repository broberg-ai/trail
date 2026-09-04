import { join } from 'node:path';
import { DATA_DIR } from '@trail/db';
import { LocalStorage } from '@trail/storage';

// Phase 1: local filesystem under the same DATA_DIR as the SQLite DB.
// The uploads subdir mirrors the future R2 layout ({tenantId}/{kbId}/{docId}/...)
// so migrating to R2 in Phase 2 is a prefix swap.
const UPLOADS_ROOT = process.env.TRAIL_UPLOADS_DIR ?? join(DATA_DIR, 'uploads');

export const storage = new LocalStorage(UPLOADS_ROOT);

export function sourcePath(tenantId: string, kbId: string, docId: string, ext: string): string {
  return `${tenantId}/${kbId}/${docId}/source.${ext}`;
}

export function imagePath(tenantId: string, kbId: string, docId: string, filename: string): string {
  return `${tenantId}/${kbId}/${docId}/images/${filename}`;
}

/**
 * F232.1 — where an image waits while nobody has judged it yet.
 *
 * A separate PREFIX, not a flag on the same folder: an image that is deleted
 * during triage should never have touched the Trail's real image store, so
 * "what is in the Trail" and "what was extracted" cannot drift. It also means a
 * crashed triage run leaves its mess in one identifiable place.
 */
export function pendingImagePath(
  tenantId: string,
  kbId: string,
  docId: string,
  filename: string,
): string {
  return `${tenantId}/${kbId}/${docId}/images-pending/${filename}`;
}
