/**
 * F180 — Boot-time scan for resumable uploads.
 *
 * On admin boot we read `localStorage.trail.activeUploads` and probe
 * each entry against the server. Three outcomes per entry:
 *
 *   - status='uploading' AND receivedBytes < contentLength
 *     → eligible for resume; surface to UI.
 *   - status='complete' OR receivedBytes === contentLength
 *     → finished while we weren't looking; drop the localStorage entry.
 *   - status='aborted' / 'expired' / 404
 *     → unrecoverable; drop the localStorage entry.
 *
 * The actual resume UX (modal asking "Genoptag?" + reattach to a fresh
 * File-handle) lives in upload-dropzone.tsx; this module just
 * surfaces the candidates.
 */

import { ApiError } from '../api';
import {
  fetchUploadInfo,
  forgetActiveUpload,
  listActiveUploads,
  type ActiveUpload,
} from './upload-client';

export interface ResumableUpload {
  local: ActiveUpload;
  server: {
    uploadId: string;
    knowledgeBaseId: string;
    filename: string;
    contentLength: number;
    contentHash: string;
    receivedBytes: number;
    status: 'uploading' | 'complete' | 'aborted' | 'expired';
  };
  /** Percent received, 0-100. */
  progress: number;
}

export async function scanResumableUploads(): Promise<ResumableUpload[]> {
  const local = listActiveUploads();
  if (local.length === 0) return [];

  const probes = await Promise.all(
    local.map(async (entry) => {
      try {
        const server = await fetchUploadInfo(entry.uploadId);
        return { entry, server };
      } catch (err) {
        // 404 already drops the entry inside fetchUploadInfo. Other
        // errors leave it in place so a transient network blip
        // doesn't lose state.
        if (err instanceof ApiError && err.status === 404) return null;
        return null;
      }
    }),
  );

  const resumable: ResumableUpload[] = [];
  for (const probe of probes) {
    if (!probe) continue;
    const { entry, server } = probe;
    if (server.status !== 'uploading' || server.receivedBytes >= server.contentLength) {
      forgetActiveUpload(entry.uploadId);
      continue;
    }
    resumable.push({
      local: entry,
      server: {
        uploadId: server.uploadId,
        knowledgeBaseId: server.knowledgeBaseId,
        filename: server.filename,
        contentLength: server.contentLength,
        contentHash: server.contentHash,
        receivedBytes: server.receivedBytes,
        status: server.status,
      },
      progress: Math.floor((server.receivedBytes / server.contentLength) * 100),
    });
  }

  return resumable;
}
