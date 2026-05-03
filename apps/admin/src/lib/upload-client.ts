/**
 * F180 — Resumable chunked upload client.
 *
 * Three-step protocol:
 *   1. POST /knowledge-bases/:kbId/documents/upload/init
 *      → { uploadId, docId, chunkSize, expiresAt }
 *   2. PATCH /uploads/:uploadId/chunk            (loop)
 *   3. POST /uploads/:uploadId/finalize          → Document
 *
 * Plus GET /uploads/:uploadId for resume + DELETE for cancel.
 *
 * The uploadId lives in localStorage during the upload so a browser
 * reload can find it and call resumeUpload(). On finalize-success,
 * the entry is dropped.
 *
 * Failure semantics:
 *   - Per-chunk fetch errors retry with exponential backoff (3
 *     attempts). On exhaustion, throws — caller decides whether to
 *     surface a "retry" UI or treat as unrecoverable.
 *   - Hash mismatch on finalize is unrecoverable (server returns
 *     422); the curator should re-upload from scratch.
 *   - 409 duplicate_source at /init is bubbled up untouched so the
 *     existing F162 dedup-modal logic handles it.
 */

import { ApiError } from '../api';
import type { Document } from '@trail/shared';

const ACTIVE_UPLOADS_KEY = 'trail.activeUploads';
const MAX_CHUNK_RETRIES = 3;

interface InitResponse {
  uploadId: string;
  docId: string;
  chunkSize: number;
  expiresAt: string;
}

interface ChunkResponse {
  uploadId: string;
  receivedBytes: number;
}

export interface UploadProgress {
  receivedBytes: number;
  totalBytes: number;
  uploadId: string;
}

export interface ActiveUpload {
  uploadId: string;
  kbId: string;
  filename: string;
  totalBytes: number;
  startedAt: string;
}

export interface UploadOptions {
  path?: string;
  force?: boolean;
  metadata?: { connector?: string; sourceUrl?: string; tags?: string[] };
  signal?: AbortSignal;
  onProgress?: (p: UploadProgress) => void;
  /**
   * If provided, skips /init + computes-hash and resumes against an
   * existing uploadId. The caller (resume-prompt) supplies this; the
   * file the curator re-selects must match the original by size +
   * sha256, else the server's finalize-time hash check will 422.
   */
  resume?: { uploadId: string; receivedBytes: number };
}

/**
 * Compute SHA-256 hex of a File's contents using the browser's
 * Web Crypto API. Streams the file via arrayBuffer() — for files up
 * to ~100 MB the memory cost is acceptable; larger files would need
 * a streaming hash, but 100 MB is the server's MAX_FILE_SIZE today.
 */
async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function loadActive(): ActiveUpload[] {
  try {
    const raw = localStorage.getItem(ACTIVE_UPLOADS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ActiveUpload[]) : [];
  } catch {
    return [];
  }
}

function saveActive(list: ActiveUpload[]): void {
  try {
    localStorage.setItem(ACTIVE_UPLOADS_KEY, JSON.stringify(list));
  } catch {
    // localStorage full / blocked — silently drop, the upload still
    // works for the current session, just no resume after reload.
  }
}

export function rememberActiveUpload(entry: ActiveUpload): void {
  const list = loadActive().filter((e) => e.uploadId !== entry.uploadId);
  list.push(entry);
  saveActive(list);
}

export function forgetActiveUpload(uploadId: string): void {
  saveActive(loadActive().filter((e) => e.uploadId !== uploadId));
}

export function listActiveUploads(): ActiveUpload[] {
  return loadActive();
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = MAX_CHUNK_RETRIES,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const res = await fetch(url, init);
      // 5xx + 0 (network) → retry; 4xx → bubble (client-side bug).
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') throw err;
      lastErr = err;
    }
    // Exponential backoff: 250ms, 500ms, 1s
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 250 * 2 ** i));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Upload `file` to the given KB using the chunked protocol. On
 * resume, pass `opts.resume = { uploadId, receivedBytes }` and the
 * fresh File the curator re-selected; init is skipped + chunks pick
 * up from `receivedBytes`.
 */
export async function uploadChunked(
  kbId: string,
  file: File,
  opts: UploadOptions = {},
): Promise<Document> {
  let uploadId: string;
  let chunkSize: number;
  let contentHash: string;

  if (opts.resume) {
    // Resume path: trust the localStorage-stored uploadId. The server
    // validates ownership via session cookie + tenant FK. We pull
    // contentHash off the server's GET response so we don't need to
    // re-hash the file (the original hash was committed at /init).
    const info = await fetchUploadInfo(opts.resume.uploadId);
    uploadId = info.uploadId;
    chunkSize = info.chunkSize;
    contentHash = info.contentHash;
  } else {
    contentHash = await sha256Hex(file);
    const url =
      `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents/upload/init` +
      (opts.force ? '?force=true' : '');
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        contentLength: file.size,
        contentHash,
        path: opts.path,
        metadata: opts.metadata,
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      let body: Record<string, unknown> | undefined;
      let message = `${res.status} ${res.statusText}`;
      try {
        body = (await res.json()) as Record<string, unknown>;
        if (body.error) {
          message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
        }
      } catch {
        // ignore
      }
      throw new ApiError(res.status, message, body);
    }

    const init = (await res.json()) as InitResponse;
    uploadId = init.uploadId;
    chunkSize = init.chunkSize;

    rememberActiveUpload({
      uploadId,
      kbId,
      filename: file.name,
      totalBytes: file.size,
      startedAt: new Date().toISOString(),
    });
  }

  let received = opts.resume?.receivedBytes ?? 0;
  opts.onProgress?.({ receivedBytes: received, totalBytes: file.size, uploadId });

  while (received < file.size) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const end = Math.min(received + chunkSize, file.size);
    const slice = file.slice(received, end);
    const body = await slice.arrayBuffer();
    const res = await fetchWithRetry(
      `/api/v1/uploads/${encodeURIComponent(uploadId)}/chunk`,
      {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Range': `bytes ${received}-${end - 1}/${file.size}`,
          'Content-Type': 'application/octet-stream',
        },
        body,
        signal: opts.signal,
      },
    );

    if (!res.ok) {
      // 410 gone → session expired or aborted; let the caller decide
      // whether to start a fresh upload. Drop the localStorage entry.
      if (res.status === 410) {
        forgetActiveUpload(uploadId);
      }
      let parsedBody: Record<string, unknown> | undefined;
      try {
        parsedBody = (await res.json()) as Record<string, unknown>;
      } catch {
        // ignore
      }
      throw new ApiError(res.status, `Chunk PATCH failed: ${res.status}`, parsedBody);
    }

    const ack = (await res.json()) as ChunkResponse;
    received = Math.max(received, ack.receivedBytes);
    opts.onProgress?.({ receivedBytes: received, totalBytes: file.size, uploadId });
  }

  const finalRes = await fetch(
    `/api/v1/uploads/${encodeURIComponent(uploadId)}/finalize`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentHash }),
      signal: opts.signal,
    },
  );

  if (!finalRes.ok) {
    let body: Record<string, unknown> | undefined;
    let message = `${finalRes.status} ${finalRes.statusText}`;
    try {
      body = (await finalRes.json()) as Record<string, unknown>;
      if (body.error) message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
    } catch {
      // ignore
    }
    throw new ApiError(finalRes.status, message, body);
  }

  const result = (await finalRes.json()) as { doc: Document };
  forgetActiveUpload(uploadId);
  return result.doc;
}

/**
 * GET /uploads/:uploadId — server-side state for resume.
 *
 * Returned shape mirrors the route. Adds `contentHash` so resume
 * doesn't need to re-hash the local file just to call finalize.
 */
export async function fetchUploadInfo(uploadId: string): Promise<InitResponse & {
  contentHash: string;
  filename: string;
  contentLength: number;
  receivedBytes: number;
  status: 'uploading' | 'complete' | 'aborted' | 'expired';
  knowledgeBaseId: string;
}> {
  const res = await fetch(`/api/v1/uploads/${encodeURIComponent(uploadId)}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    if (res.status === 404) {
      forgetActiveUpload(uploadId);
    }
    throw new ApiError(res.status, `GET upload ${uploadId} failed: ${res.status}`);
  }
  return (await res.json()) as InitResponse & {
    contentHash: string;
    filename: string;
    contentLength: number;
    receivedBytes: number;
    status: 'uploading' | 'complete' | 'aborted' | 'expired';
    knowledgeBaseId: string;
  };
}

/**
 * Curator-driven cancel. Server marks the session aborted, deletes
 * the temp file, and removes the staging documents row. Idempotent.
 */
export async function cancelUpload(uploadId: string): Promise<void> {
  try {
    await fetch(`/api/v1/uploads/${encodeURIComponent(uploadId)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  } finally {
    forgetActiveUpload(uploadId);
  }
}
