import { join } from 'node:path';
import { DATA_DIR } from '@trail/db';
import { LocalStorage, TigrisStorage, type Storage } from '@trail/storage';

// Phase 1: local filesystem under the same DATA_DIR as the SQLite DB.
// The uploads subdir mirrors the object-store layout ({tenantId}/{kbId}/{docId}/...)
// so the Tigris swap is a prefix swap.
const UPLOADS_ROOT = process.env.TRAIL_UPLOADS_DIR ?? join(DATA_DIR, 'uploads');

// F222.1 — the backend is chosen by an EXPLICIT flag, never by secret-presence.
// `flyctl storage create` already injected AWS_* secrets on the machine, so
// auto-detecting on those would have cut serving over to an EMPTY bucket on the
// very next deploy, before the migration ran. TRAIL_STORAGE=tigris is set only
// after the files are migrated and read back.
function buildStorage(): Storage {
  if (process.env.TRAIL_STORAGE === 'tigris') {
    return new TigrisStorage({
      bucket: process.env.BUCKET_NAME ?? '',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      endpoint: process.env.AWS_ENDPOINT_URL_S3 ?? '',
      region: process.env.AWS_REGION,
      stagingDir: join(DATA_DIR, 'upload-staging'),
    });
  }
  return new LocalStorage(UPLOADS_ROOT);
}

export const storage: Storage = buildStorage();

/**
 * F222.1 — where a chunked-upload staging file lives on the LOCAL disk.
 * Staging is always local (S3 has no write-at-offset); on the Tigris backend
 * it moves out of the uploads root so the migration can treat that root as
 * frozen. uploads.ts streams this path for sha256 verification.
 */
export function stagingFsPath(relPath: string): string {
  if (relPath.includes('..')) throw new Error('Invalid path: traversal not allowed');
  const root =
    process.env.TRAIL_STORAGE === 'tigris' ? join(DATA_DIR, 'upload-staging') : UPLOADS_ROOT;
  return join(root, relPath);
}

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
