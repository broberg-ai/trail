/**
 * F191 — Station API client. Auth is a personal `trail_` key (F188) the user
 * pastes once; we send it as `Authorization: Bearer` and Vite proxies /api to
 * the cloud admin (which routes to the key's tenant engine). No cookies, no
 * CORS (same-origin localhost via the dev proxy).
 */
import type { KnowledgeBase, Document } from '@trail/shared';

const KEY_STORAGE = 'trail.ingest.key';

export function getKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? '';
}
export function setKey(key: string): void {
  if (key) localStorage.setItem(KEY_STORAGE, key.trim());
  else localStorage.removeItem(KEY_STORAGE);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getKey();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const b = (await res.json()) as { error?: unknown };
      if (b.error) msg = typeof b.error === 'string' ? b.error : JSON.stringify(b.error);
    } catch { /* non-JSON body */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** List the KBs for the key's tenant — the engine scopes by the bearer. */
export function listKbs(): Promise<KnowledgeBase[]> {
  return api<KnowledgeBase[]>('/api/v1/knowledge-bases');
}

/** Sources for a KB. `awaitingOnly` filters to those parked for local compile. */
export function listSources(kbId: string, awaitingOnly = false): Promise<Document[]> {
  const q = awaitingOnly ? '?awaitingLocalCompile=true' : '';
  return api<Document[]>(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents${q}`);
}

/** Upload a file as a source PARKED for $0 in-session compile (?localCompile=true). */
export async function uploadSource(kbId: string, file: File): Promise<Document> {
  const fd = new FormData();
  fd.append('file', file);
  return api<Document>(
    `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents/upload?localCompile=true`,
    { method: 'POST', body: fd },
  );
}

/** A normalized event off the engine's /api/v1/stream SSE bus. */
export interface StreamEvent {
  event: string; // e.g. 'candidate_created', 'ping', 'hello', 'ingest_started'
  data: Record<string, unknown>;
}

/**
 * Subscribe to the tenant's live event stream. EventSource can't send an
 * Authorization header, so we consume the SSE stream via fetch + a reader and
 * parse the frames ourselves. Returns an unsubscribe fn (aborts the stream).
 */
export function subscribeStream(onEvent: (e: StreamEvent) => void): () => void {
  const ac = new AbortController();
  (async () => {
    try {
      const res = await fetch('/api/v1/stream', {
        headers: { Authorization: `Bearer ${getKey()}` },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        // SSE frames are separated by a blank line.
        let sep: number;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          let ev = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          try {
            onEvent({ event: ev, data: JSON.parse(data) as Record<string, unknown> });
          } catch { /* non-JSON data line — ignore */ }
        }
      }
    } catch {
      // aborted (unsubscribe) or network drop — caller re-subscribes if it wants.
    }
  })();
  return () => ac.abort();
}
