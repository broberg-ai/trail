/**
 * F180 — Resumable uploads banner.
 *
 * Surfaces orphaned upload sessions found at boot via
 * scanResumableUploads(). For Phase 2, the only actions are:
 *
 *   - **Annullér** — DELETE the session + drop the localStorage entry.
 *   - **Skjul** — keep the server-side session (it'll GC after 24h)
 *     but remove the banner row.
 *
 * Full re-select-the-file-and-continue UX is Phase 3 polish — the
 * curator typically just re-uploads from scratch, and the orphan
 * gets reaped server-side an hour later.
 */

import { useEffect, useState } from 'preact/hooks';
import { scanResumableUploads, type ResumableUpload } from '../lib/upload-resume';
import { cancelUpload, forgetActiveUpload } from '../lib/upload-client';

export function ResumableUploadsBanner() {
  const [uploads, setUploads] = useState<ResumableUpload[] | null>(null);

  useEffect(() => {
    void scanResumableUploads().then((list) => setUploads(list));
  }, []);

  if (!uploads || uploads.length === 0) return null;

  const dismiss = (uploadId: string) => {
    forgetActiveUpload(uploadId);
    setUploads((prev) => prev?.filter((u) => u.local.uploadId !== uploadId) ?? null);
  };

  const cancel = async (uploadId: string) => {
    try {
      await cancelUpload(uploadId);
    } finally {
      setUploads((prev) => prev?.filter((u) => u.local.uploadId !== uploadId) ?? null);
    }
  };

  return (
    <div class="mx-auto max-w-7xl px-4 mt-3">
      <div class="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg-card)]/60 px-4 py-3">
        <div class="text-xs font-mono text-[color:var(--color-fg-muted)] mb-2">
          {uploads.length === 1
            ? '1 upload didn’t finish before this session restarted.'
            : `${uploads.length} uploads didn’t finish before this session restarted.`}
        </div>
        <ul class="space-y-1.5">
          {uploads.map((u) => (
            <li key={u.local.uploadId} class="flex items-center justify-between gap-3 text-[11px] font-mono">
              <span class="truncate text-[color:var(--color-fg)]">
                {u.server.filename}
                <span class="text-[color:var(--color-fg-subtle)] ml-2">
                  · {u.progress}% received
                </span>
              </span>
              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => cancel(u.local.uploadId)}
                  class="text-[color:var(--color-danger)] hover:underline active:opacity-80"
                >
                  Annullér
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(u.local.uploadId)}
                  class="text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg)] active:opacity-80"
                >
                  Skjul
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
