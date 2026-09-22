/**
 * The read-only HTTP surface both F286 tools speak to.
 *
 * WHY THE HTTP API AND NOT THE DATABASE, unchanged from F286.1: the dataset is
 * meant to live on cb-ubuntu, and only the API is reachable from there — the
 * sqld tokens are Fly secrets on the engine. A direct-DB export would work from
 * exactly one machine, which is the one place it must not be tied to.
 *
 * Extracted from export-dataset.ts when build-dataset.ts became the second
 * caller. Same code, same behaviour — moved, not rewritten.
 */

const API = process.env.TRAIL_CLOUD_API ?? 'https://app.trailmem.com';

/** Every tenant whose material we are allowed to train on (owner, 21/9 2026). */
export const TENANTS = ['broberg-ai', 'sanne-andersen'] as const;

export function requireKey(): string {
  const key = process.env.TRAIL_API_KEY;
  if (!key) {
    console.error(
      'TRAIL_API_KEY mangler. Kør med:  set -a; . ./.env.local-ingest; set +a; bun run …',
    );
    process.exit(1);
  }
  return key;
}

export async function get<T>(tenant: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${requireKey()}`, 'X-Trail-Tenant': tenant },
  });
  if (!res.ok) {
    // A failed call must never be counted as "this brain has nothing" — an
    // absence and an error look identical in a total, and only one of them
    // means what the total says.
    throw new Error(`${res.status} ${res.statusText} on ${path} (tenant ${tenant})`);
  }
  return (await res.json()) as T;
}

export function rowsOf<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    for (const key of ['documents', 'items', 'rows']) {
      if (Array.isArray(o[key])) return o[key] as T[];
    }
  }
  return [];
}

export interface KnowledgeBase {
  slug: string;
  name: string;
}

export interface DocumentRow {
  id: string;
  filename: string;
  path: string;
  title?: string | null;
  kind?: string | null;
  fileType?: string | null;
  tags?: string | null;
}

export interface GraphNode {
  id: string;
  label: string;
  path: string;
  excerpt?: string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  edgeType: string;
}

export interface QueueItem {
  id: string;
  kind: string;
  status: string;
  title: string;
  content: string;
  knowledgeBaseId: string;
}

/**
 * Every document of a kind in a knowledge base.
 *
 * ONE call, no paging — MEASURED 21/9 2026, not assumed. The route takes
 * `path`, `kind`, `archived`, `sort`, `from`/`to` and NOTHING else: no `limit`,
 * no `offset`, no cursor. It ends in `.all()` and returns a bare array.
 * `buddy-sessions` answers with all 5.679 rows in one 4 MB response.
 *
 * Building pagination against an API that has none is worse than not paging: it
 * looks careful and it never terminates. F286.1's first version did exactly
 * that and ran forever.
 */
export async function allDocuments(
  tenant: string,
  kb: string,
  kind: 'source' | 'wiki',
): Promise<DocumentRow[]> {
  // ACTIVE ONLY. An archived Neuron was taken out of the brain by a curator —
  // often because it was wrong — so it is the last thing to train on, and
  // leaving it out keeps F286.1's counts and F286.2's counts over the same
  // population. `?archived=all` would quietly add ~175 rows in buddy-sessions
  // alone and make the two tools disagree about how much material exists.
  return rowsOf<DocumentRow>(
    await get(tenant, `/api/v1/knowledge-bases/${kb}/documents?kind=${kind}`),
  );
}

export async function kbGraph(
  tenant: string,
  kb: string,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  try {
    const g = await get<{ nodes?: GraphNode[]; edges?: GraphEdge[] }>(
      tenant,
      `/api/v1/knowledge-bases/${kb}/graph`,
    );
    return { nodes: g.nodes ?? [], edges: g.edges ?? [] };
  } catch {
    return { nodes: [], edges: [] };
  }
}

/**
 * The queue, paged properly.
 *
 * `/api/v1/queue` DOES page (F214.2 keyset cursor) — unlike the documents
 * route. Both facts are measured, and getting them the wrong way round breaks
 * in opposite directions: paging a route that ignores the cursor loops forever,
 * NOT paging a route that caps at 200 silently reports 200 of 15.255 rows.
 */
export async function allQueueItems(tenant: string, status: string): Promise<QueueItem[]> {
  const out: QueueItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await get<{ items: QueueItem[]; nextCursor?: string | null }>(
      tenant,
      `/api/v1/queue?status=${status}&limit=200${cursor ? `&cursor=${cursor}` : ''}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return out;
}
