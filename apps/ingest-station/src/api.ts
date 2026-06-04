/**
 * F191 — Station API client. Auth is a personal `trail_` key (F188) the user
 * pastes once; we send it as `Authorization: Bearer` and Vite proxies /api to
 * the cloud admin (which routes to the key's tenant engine). No cookies, no
 * CORS (same-origin localhost via the dev proxy).
 */
import type { KnowledgeBase, Document } from '@trail/shared';

const KEY_STORAGE = 'trail.ingest.key';
const TENANT_STORAGE = 'trail.ingest.tenant';

export function getKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? '';
}
export function setKey(key: string): void {
  if (key) localStorage.setItem(KEY_STORAGE, key.trim());
  else localStorage.removeItem(KEY_STORAGE);
}

// F191.6 — the active tenant slug. A scope='all' key spans multiple tenants;
// the admin proxy picks one per request from the X-Trail-Tenant header we
// attach below. Persisted so the choice survives reloads.
export function getActiveTenant(): string {
  return localStorage.getItem(TENANT_STORAGE) ?? '';
}
export function setActiveTenant(slug: string): void {
  if (slug) localStorage.setItem(TENANT_STORAGE, slug);
  else localStorage.removeItem(TENANT_STORAGE);
}

function authHeaders(): Record<string, string> {
  const key = getKey();
  const tenant = getActiveTenant();
  return {
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
    ...(tenant ? { 'X-Trail-Tenant': tenant } : {}),
  };
}

export class ApiError extends Error {
  // body carries the parsed JSON error payload (e.g. the 409 duplicate_source
  // fields) so callers can react without re-parsing.
  constructor(public status: number, message: string, public body?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...authHeaders(),
    },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    let body: Record<string, unknown> | undefined;
    try {
      body = (await res.json()) as Record<string, unknown>;
      if (body.error) msg = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
    } catch { /* non-JSON body */ }
    throw new ApiError(res.status, msg, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** A tenant the key's user can drop into (F191.6). */
export interface Tenant {
  slug: string;
  name: string;
  role: string;
}

/**
 * List the tenants this key can reach (F191.6). A scope='all' key returns
 * every tenant the user is a member of; a single-tenant key returns just its
 * home tenant. Key-authed, answered by the admin (not proxied to an engine).
 */
export function listTenants(): Promise<{ scope: string; tenants: Tenant[] }> {
  return api('/api/control/my-tenants');
}

/** List the KBs for the active tenant — proxy routes by key + X-Trail-Tenant. */
export function listKbs(): Promise<KnowledgeBase[]> {
  return api<KnowledgeBase[]>('/api/v1/knowledge-bases');
}

/** Sources for a KB. `awaitingOnly` filters to those parked for local compile. */
export function listSources(kbId: string, awaitingOnly = false): Promise<Document[]> {
  const q = awaitingOnly ? '?awaitingLocalCompile=true' : '';
  return api<Document[]>(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents${q}`);
}

/**
 * Upload a file as a source PARKED for $0 in-session compile (?localCompile=true).
 * A byte-identical file already in this Trail → the engine returns 409
 * `duplicate_source` (F162 hash dedup); pass `force` to upload it anyway as a
 * separate source.
 */
export async function uploadSource(kbId: string, file: File, force = false): Promise<Document> {
  const fd = new FormData();
  fd.append('file', file);
  const q = `?localCompile=true${force ? '&force=true' : ''}`;
  return api<Document>(
    `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents/upload${q}`,
    { method: 'POST', body: fd },
  );
}

/**
 * "Prøv igen" — re-park a failed source so the next `/local-ingest` drain
 * retries it. Clears the failed status and sets awaitingLocalCompile=true.
 */
export function recompileSource(docId: string): Promise<{ id: string; awaitingLocalCompile: boolean }> {
  return api(`/api/v1/documents/${encodeURIComponent(docId)}/local-recompile`, { method: 'POST' });
}

/**
 * Delete (soft-archive) a source — used to clear a failed source that can
 * never compile (e.g. a legacy .doc that extracts to nothing). Archived
 * sources drop out of the list, so the failed row disappears on refresh.
 */
export function deleteSource(docId: string): Promise<void> {
  return api(`/api/v1/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
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
        headers: authHeaders(),
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
