import type {
  QueueCandidate,
  QueueCandidateKind,
  QueueCandidateStatus,
  ResolveCandidatePayload,
  CandidateEffectKind,
  KnowledgeBase,
  Document,
} from '@trail/shared';
import { slugify } from '@trail/shared';

/**
 * Transient upstream statuses worth a retry. The Trail engine + admin each
 * run a SINGLE Fly machine (DB lives on a per-machine volume — F33 Phase 1),
 * so every deploy/restart/health-blip is a brief window with NO failover where
 * Fly's edge returns 502/503/504 to all clients. Riding through that window
 * with a short backoff keeps deploys invisible to the user and stops polluting
 * the error board with deploy-noise (the 2026-06-04 "ApiError: 503" issue).
 */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 3;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Only idempotent methods may auto-retry — never risk double-applying a write. */
function isSafeMethod(init?: RequestInit): boolean {
  const m = (init?.method ?? 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

/**
 * Typed fetch wrapper.
 * Cookies flow via credentials: 'include'. Errors surface as thrown
 * `ApiError` with status + server-provided message. Safe methods retry
 * transient 5xx / network blips with backoff (see TRANSIENT_STATUSES).
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const safe = isSafeMethod(init);
  const attempts = safe ? MAX_ATTEMPTS : 1;
  let lastNetworkErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(path, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...init?.headers,
        },
        ...init,
      });
    } catch (err) {
      // Connection refused/reset mid deploy window — retry safe methods.
      lastNetworkErr = err;
      if (safe && attempt < attempts) {
        await sleep(attempt * 400);
        continue;
      }
      throw err;
    }
    if (!response.ok) {
      if (safe && TRANSIENT_STATUSES.has(response.status) && attempt < attempts) {
        await sleep(attempt * 400);
        continue;
      }
      let message = `${response.status} ${response.statusText}`;
      let body: Record<string, unknown> | undefined;
      try {
        body = (await response.json()) as Record<string, unknown>;
        if (body.error) {
          message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
        }
      } catch {
        // ignore
      }
      throw new ApiError(response.status, message, body);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
  // Unreachable for non-safe methods; safe methods exhausted all network retries.
  throw lastNetworkErr instanceof Error ? lastNetworkErr : new Error('request failed');
}

export class ApiError extends Error {
  /**
   * Optional structured code from the server's error body — e.g.
   * F156 emits `code: 'session_turn_cap_reached'` on a 429 so the
   * chat panel can branch on identity rather than matching message
   * text. Undefined when the server didn't include one.
   */
  public readonly code?: string;
  /**
   * The raw parsed JSON body when the server returned one. Lets a
   * caller pull additional fields (e.g. `turnsUsed`, `turnsLimit`)
   * without re-parsing.
   */
  public readonly body?: Record<string, unknown>;

  constructor(
    public status: number,
    message: string,
    body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.body = body;
    if (body && typeof body.code === 'string') {
      this.code = body.code;
    }
  }
}

// ── Identity / tenants (admin-server, not engine) ───────────────

export interface AuthTenant {
  id: string;
  slug: string;
  name: string;
  language: string;
  plan: string | null;
  active: boolean;
  /** F187.4 — caller's per-tenant role (owner | admin | member). */
  role: string;
}

export interface AuthMe {
  user: { id: string; email: string; name: string | null; onboarded: boolean };
  organizationId: string;
  tenant: { id: string; slug: string; name: string; language: string; plan: string | null } | null;
  tenants: AuthTenant[];
  /** F194 — OAuth providers linked to this account (for the login-methods UI). */
  linkedProviders?: { provider: string; email: string | null }[];
  engineUrl: string | null;
}

/** F194 — unlink a Google/GitHub identity from the signed-in account. */
export function unlinkProvider(provider: string): Promise<{ ok: true; provider: string }> {
  return api(`/api/auth/${provider}/identity`, { method: 'DELETE' });
}

/** Fetch the user + their full tenant list from admin-server. */
export function fetchAuthMe(): Promise<AuthMe> {
  return api('/api/auth/me');
}

/** Switch the active tenant; cookie-based, takes effect on next request. */
export function switchTenant(slug: string): Promise<{ ok: true; slug: string }> {
  return api('/api/auth/switch-tenant', {
    method: 'POST',
    body: JSON.stringify({ slug }),
  });
}

/** Sign out — clears the session cookie on admin-server. */
export function signOut(): Promise<{ ok: true }> {
  return api('/api/auth/logout', { method: 'POST' });
}

// ── Invitations (F187) ───────────────────────────────────────────

export type InvitationRole = 'owner' | 'admin' | 'member' | 'service';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface Invitation {
  id: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

/** List the org's invitations (pending first, then most recent). */
export function listInvitations(): Promise<{ invitations: Invitation[] }> {
  return api('/api/control/invitations');
}

/** Send an invite — creates/refreshes a pending invitation + magic-link email. */
export function createInvitation(body: {
  email: string;
  role: InvitationRole;
}): Promise<{ ok: true; action: 'created' | 'reinvited'; invitationId: string }> {
  return api('/api/control/invite', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Revoke a pending invitation. */
export function revokeInvitation(id: string): Promise<{ ok: true; id: string }> {
  return api(`/api/control/invitations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Personal API keys (F188) ─────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** List the user's non-revoked personal API keys. */
export function listApiKeys(): Promise<{ keys: ApiKey[] }> {
  return api('/api/control/api-keys');
}

/** Create a key — the raw `key` is returned ONCE and never again. */
export function createApiKey(name: string): Promise<{ id: string; name: string; prefix: string; key: string }> {
  return api('/api/control/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** Revoke a personal API key. */
export function revokeApiKey(id: string): Promise<{ ok: true; id: string }> {
  return api(`/api/control/api-keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ── Resources ────────────────────────────────────────────────────

export function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  return api('/api/v1/knowledge-bases');
}

/**
 * Create a new Trail. The server auto-generates a unique slug from `name`
 * (uniqueSlug with `-2`, `-3`, … suffix on collision) and seeds the three
 * hub Neurons (overview.md, log.md, glossary.md per F102). Returns the
 * full KB row including the final slug so the caller can navigate.
 */
export function createKnowledgeBase(body: {
  name: string;
  description?: string | null;
  language?: string;
}): Promise<KnowledgeBase> {
  return api('/api/v1/knowledge-bases', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Partial update of a Trail's settings. PATCH body is whatever subset of
 * fields are being changed — the engine validates via UpdateKBSchema.
 * Returns the full updated row.
 */
export function updateKnowledgeBase(
  kbId: string,
  patch: {
    name?: string;
    description?: string | null;
    language?: string;
    lintPolicy?: 'trusting' | 'strict';
    /** F160 — null clears back to default; omit to leave unchanged. */
    chatPersonaTool?: string | null;
    /** F160 — null clears back to default; omit to leave unchanged. */
    chatPersonaPublic?: string | null;
    /** F176 — per-KB lint cadence (days). null clears the override
     *  so the KB falls back to global TRAIL_LINT_SCHEDULE_DAYS. */
    lintScheduleDays?: number | null;
  },
): Promise<KnowledgeBase> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export interface QueueListResponse {
  items: QueueCandidate[];
  count: number;
}

export interface QueueFilter {
  knowledgeBaseId?: string;
  kind?: QueueCandidateKind;
  status?: QueueCandidateStatus;
  /**
   * Filter by connector — comma-separated (e.g. `"upload,buddy,lint"`).
   * Matches against metadata.connector. Multiple values OR together.
   */
  connector?: string;
  limit?: number;
}

export interface NeuronProvenance {
  documentId: string;
  connector: string | null;
  candidateId: string | null;
  /**
   * 0-1 confidence the emitting candidate carried. `null` for curator-
   * authored candidates (they don't have a confidence signal; the
   * curator saying "save this" is the signal). Reflects the INITIAL
   * compile — a Neuron edited later via a new candidate keeps the
   * original confidence here; per-version history lives in wiki_events.
   */
  confidence: number | null;
  createdAt: string;
  actorKind: 'user' | 'llm' | 'system' | null;
  actorId: string | null;
  /**
   * F182.6 — LIVE lifecycle state (distinct from `confidence` above, which is
   * the write-time candidate score). `liveConfidence` is the decay-job-
   * maintained value; `confidencePinned` exempts it from decay (held at 1.0);
   * `supersededByNeuronId` points at the newer Neuron that replaced this one.
   */
  liveConfidence: number | null;
  confidencePinned: boolean;
  confidenceLastRecomputedAt: number | null;
  supersededByNeuronId: string | null;
}

export function getNeuronProvenance(docId: string): Promise<NeuronProvenance> {
  return api(`/api/v1/documents/${encodeURIComponent(docId)}/provenance`);
}

/** F182.8 — pin/unpin a Neuron's confidence (decay exemption). */
export function pinNeuronConfidence(
  docId: string,
  pinned: boolean,
): Promise<{ id: string; confidencePinned: boolean }> {
  return api(`/api/v1/documents/${encodeURIComponent(docId)}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned }),
  });
}

// ── F182.7 Memory Health ────────────────────────────────────────────────────

export interface DecayingNeuron {
  id: string;
  filename: string;
  title: string | null;
  path: string;
  confidence: number;
  lastRecomputedAt: number | null;
}

export interface SupersededChain {
  id: string;
  filename: string;
  title: string | null;
  path: string;
  replacementId: string | null;
  replacementFilename: string | null;
  replacementTitle: string | null;
}

export interface MemoryHealthData {
  /** 5 buckets: [0,0.2) … [0.8,1.0]. */
  histogram: number[];
  decaying: DecayingNeuron[];
  superseded: SupersededChain[];
  /** F195 — is age/usage decay active for this Trail? Default false (paused). */
  decayEnabled?: boolean;
}

/** Per-Neuron-type decay rate (τ, days). */
export type DecayRates = Record<string, number>;

export interface DecayRatesResponse {
  rates: DecayRates;
  defaults: DecayRates;
}

export function getMemoryHealth(kbId: string): Promise<MemoryHealthData> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/memory-health`);
}

export function getDecayRates(): Promise<DecayRatesResponse> {
  return api('/api/v1/memory-health/decay-rates');
}

export function saveDecayRates(rates: DecayRates): Promise<DecayRatesResponse> {
  return api('/api/v1/memory-health/decay-rates', {
    method: 'PUT',
    body: JSON.stringify({ rates }),
  });
}

/** F195 — turn memory-decay on/off for ONE Trail. Disabling resets that Trail's
 *  Neurons to full confidence immediately (server-side). */
export function setKbDecayEnabled(kbId: string, enabled: boolean): Promise<{ decayEnabled: boolean }> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/memory-health/decay-enabled`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

export function listQueue(filter: QueueFilter = {}): Promise<QueueListResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  return api(`/api/v1/queue?${qs.toString()}`);
}

export function getCandidate(id: string): Promise<QueueCandidate> {
  return api(`/api/v1/queue/${encodeURIComponent(id)}`);
}

export interface ResolutionResponse {
  candidateId: string;
  actionId: string;
  effect: CandidateEffectKind;
  documentId: string | null;
  wikiEventId: string | null;
  autoApproved: boolean;
  status: 'approved' | 'rejected';
}

/**
 * Execute a curator decision. `actionId` references one of the candidate's
 * actions (or the default 'approve'/'reject' on legacy candidates). Effect-
 * specific fields (filename/path for approve, reason for reject, args for
 * retire-neuron/flag-source) ride as siblings and are validated server-side.
 */
export function resolveCandidate(
  id: string,
  payload: ResolveCandidatePayload,
): Promise<ResolutionResponse> {
  return api(`/api/v1/queue/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Flip a rejected candidate back to pending. Use-case: the curator made
 * a wrong call and wants a do-over. Returns the previous rejection
 * reason so the admin can show "you had written: '...'" as a hint.
 */
export function reopenCandidate(
  id: string,
): Promise<{ candidateId: string; previousReason: string | null }> {
  return api(`/api/v1/queue/${encodeURIComponent(id)}/reopen`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export interface BulkQueueResult {
  actionId: string | null;
  effect: string | null;
  requested: number;
  succeeded: Array<{ id: string; actionId: string }>;
  failed: Array<{ id: string; error: string }>;
}

/**
 * Apply the same decision to many candidates. Two dispatch styles:
 *   - `actionId`: find THAT specific action on each candidate. Works when
 *     every selected candidate exposes the same actionId (legacy default
 *     'approve'/'reject').
 *   - `effect`: find ANY action with that effect on each candidate.
 *     The only universal mode — every candidate has a reject-effect
 *     action ('reject' on legacy, 'dismiss' on rich), so a bulk
 *     "Dismiss" works even when selected rows have different action
 *     catalogues.
 */
export function bulkQueue(args: {
  actionId?: string;
  effect?: string;
  ids: string[];
  reason?: string;
  filename?: string;
  path?: string;
  args?: Record<string, unknown>;
}): Promise<BulkQueueResult> {
  return api(`/api/v1/queue/bulk`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

/**
 * Bulk-execute each candidate's LLM-recommended action (F96). Skips
 * candidates that don't have a recommendation yet, or whose
 * recommendation is a reject-effect (those need a reason prompt).
 */
export function bulkAcceptRecommendations(ids: string[]): Promise<BulkQueueResult> {
  return api(`/api/v1/queue/bulk-accept-recommendations`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

// ── Documents (wiki + source) ────────────────────────────────────

export type WikiSortOrder = 'newest' | 'oldest' | 'title';

/** List wiki pages in a KB (kind='wiki', non-archived). */
export function listWikiPages(kbId: string, sort: WikiSortOrder = 'newest'): Promise<Document[]> {
  return api(
    `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents?kind=wiki&sort=${sort}`,
  );
}

/** F99 — Neuron graph data for a KB. Nodes + edges + layout meta. */
export interface GraphNode {
  id: string;
  label: string;
  filename: string;
  path: string;
  x: number | null;
  y: number | null;
  size: number;
  orphan: boolean;
  hub: boolean;
  tags: string[];
  backlinks: number;
  excerpt: string | null;
  /** F141 — access-rollup-derived usage weight, 0-1 normalised per-KB.
   *  0 means unknown (Neuron never read OR rollup hasn't fired yet) —
   *  treat as baseline, not "cold". */
  usageWeight: number;
  /** F138 — document kind drives node shape:
   *  'wiki' → circle (knowledge), 'work' → square (tasks/bugs/etc.). */
  kind?: 'wiki' | 'work';
  workStatus?: WorkStatus | null;
  workKind?: WorkKind | null;
  /** F182.6 — lifecycle state for confidence-aware rendering: node opacity
   *  scales with `confidence`; `confidencePinned` nodes never dim; `superseded`
   *  nodes render deemphasised (replaced by a newer Neuron). */
  confidence?: number;
  confidencePinned?: boolean;
  superseded?: boolean;
}
/** F137 — the closed set of edge types the LLM can emit via `[[target|type]]`
 *  syntax. Mirrors `VALID_EDGE_TYPES` on the server-side extractor. */
export type GraphEdgeType =
  | 'cites'
  | 'is-a'
  | 'part-of'
  | 'contradicts'
  | 'supersedes'
  | 'example-of'
  | 'caused-by';

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** F137 — typed relation. Pre-F137 rows migrated to `'cites'` default,
   *  but third-party callers shouldn't crash if the field is missing. */
  edgeType?: GraphEdgeType | null;
}
export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    layoutComputedAt: string | null;
    nodeCount: number;
    edgeCount: number;
  };
}
export function fetchGraph(kbId: string): Promise<GraphResponse> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/graph`);
}

// ── F138 — Work Layer ─────────────────────────────────────────────────────
export type WorkStatus = 'open' | 'in-progress' | 'done' | 'blocked';
export type WorkKind = 'task' | 'bug' | 'milestone' | 'decision';

export interface WorkItem {
  id: string;
  title: string | null;
  filename: string;
  path: string;
  tags: string | null;
  workStatus: WorkStatus | null;
  workKind: WorkKind | null;
  workAssignee: string | null;
  workDueAt: string | null;
  version: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export function listWorkItems(
  kbId: string,
  opts: { status?: WorkStatus; kind?: WorkKind; assignee?: string; archived?: 'true' | 'false' | 'all' } = {},
): Promise<WorkItem[]> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.kind) params.set('kind', opts.kind);
  if (opts.assignee) params.set('assignee', opts.assignee);
  if (opts.archived) params.set('archived', opts.archived);
  const qs = params.toString();
  return api(
    `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/work${qs ? `?${qs}` : ''}`,
  );
}

export function createWorkItem(
  kbId: string,
  body: {
    title: string;
    content?: string;
    workKind?: WorkKind;
    workStatus?: WorkStatus;
    workAssignee?: string | null;
    workDueAt?: string | null;
    path?: string;
    tags?: string | null;
  },
): Promise<WorkItem> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/work`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateWorkState(
  docId: string,
  patch: {
    workStatus?: WorkStatus;
    workAssignee?: string | null;
    workDueAt?: string | null;
    workKind?: WorkKind;
  },
): Promise<WorkItem> {
  return api(`/api/v1/work/${encodeURIComponent(docId)}/state`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * List sources in a KB (kind='source'). `filter` controls archive visibility:
 *   - 'active' (default): only non-archived
 *   - 'archived': only archived
 *   - 'all': both
 */
export function listSources(
  kbId: string,
  filter: 'active' | 'archived' | 'all' = 'active',
): Promise<Document[]> {
  const params = new URLSearchParams({ kind: 'source' });
  if (filter === 'archived') params.set('archived', 'true');
  else if (filter === 'all') params.set('archived', 'all');
  // default (active): no archived param — server defaults to archived=false
  return api(
    `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents?${params.toString()}`,
  );
}

/** Fetch a document + its full content + F112 user-note + F112.1 share-flag. */
export function getDocumentContent(
  docId: string,
): Promise<{
  id: string;
  content: string | null;
  version: number;
  userNote: string | null;
  userNoteShare: boolean;
}> {
  return api(`/api/v1/documents/${encodeURIComponent(docId)}/content`);
}

/**
 * F112 — Luhmann-friction "Your Take" upsert. Empty/whitespace-only
 * string clears it.
 *
 * F112.1 — pass `share` to opt this Neuron's note in (or out of)
 * chat + external-integration sharing. Omitting `share` keeps the
 * previous flag value (idempotent on text-only edits).
 *
 * The body intentionally only carries fields the caller wants to
 * change. Server treats missing fields as "leave alone". This matters
 * for share-only checkbox clicks where the textarea state may be
 * stale or empty — sending `userNote` then would either no-op the
 * edit or accidentally clear a saved note.
 */
export function updateUserNote(
  docId: string,
  userNote: string | null | undefined,
  share?: boolean,
): Promise<{ documentId: string; updatedAt: string }> {
  const body: { userNote?: string; share?: boolean } = {};
  if (typeof userNote === 'string') body.userNote = userNote;
  if (share !== undefined) body.share = share;
  return api(`/api/v1/documents/${encodeURIComponent(docId)}/user-note`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

/**
 * F91 — curator Neuron edit. Routes server-side through the queue via
 * `submitCuratorEdit`. Throws `NeuronEditConflictError` on HTTP 409 so
 * the editor can distinguish "someone else edited" from other failures
 * and prompt the curator to reload.
 */
export async function saveNeuronEdit(
  docId: string,
  input: {
    title?: string;
    content: string;
    tags?: string | null;
    expectedVersion: number;
  },
): Promise<{ id: string; version: number; wikiEventId: string | null }> {
  const response = await fetch(
    `/api/v1/documents/${encodeURIComponent(docId)}/content`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (response.status === 409) {
    const body = (await response.json().catch(() => ({}))) as {
      currentVersion?: number;
      expectedVersion?: number;
      message?: string;
    };
    throw new NeuronEditConflictError(
      body.currentVersion ?? input.expectedVersion + 1,
      body.expectedVersion ?? input.expectedVersion,
      body.message ?? 'Version conflict',
    );
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as { id: string; version: number; wikiEventId: string | null };
}

export class NeuronEditConflictError extends Error {
  readonly status = 409 as const;
  constructor(
    public currentVersion: number,
    public expectedVersion: number,
    message: string,
  ) {
    super(message);
    this.name = 'NeuronEditConflictError';
  }
}

/** Soft-archive a document. Sets archived=true + status='archived'. */
export function archiveDocument(docId: string): Promise<void> {
  return api(`/api/v1/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
}

/** Restore an archived document. Inverse of archiveDocument. */
export function restoreDocument(
  docId: string,
): Promise<{ id: string; archived: false; status: 'ready' }> {
  return api(`/api/v1/documents/${encodeURIComponent(docId)}/restore`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Retry a failed source's ingest pipeline against the bytes already in storage. */
export function retryDocument(docId: string): Promise<{ id: string; status: string }> {
  return api(`/api/v1/documents/${encodeURIComponent(docId)}/reprocess`, { method: 'POST' });
}

/**
 * Re-run ONLY the wiki-compile (LLM ingest) step. Skips file-format extract.
 * Use when extract produced good markdown but wiki-compile failed or stalled.
 */
export function reingestDocument(
  docId: string,
): Promise<{ id: string; status: string; alreadyRunning?: boolean }> {
  return api(`/api/v1/documents/${encodeURIComponent(docId)}/reingest`, { method: 'POST' });
}

/**
 * F161 follow-up — re-run Vision on this source's NULL-description
 * images. Returns counts: rowsScanned (NULL rows attempted),
 * described (got a non-empty description), skipped (decorative
 * sentinel or storage-blob-missing), model (provider-id used).
 *
 * Server-side gated by TRAIL_VISION_RERUN_UI=1; absence of the env
 * returns 404 here. Admin reads `features.visionRerun` from /me to
 * decide whether to render the button at all.
 */
export function rerunVisionForDocument(
  docId: string,
): Promise<{ rowsScanned: number; described: number; skipped: number; model: string }> {
  return api(`/api/v1/documents/${encodeURIComponent(docId)}/rerun-vision`, { method: 'POST' });
}

// ── F164 background jobs ─────────────────────────────────────────────────

/** Mirrors apps/server's serializeJob() shape. */
export interface Job {
  id: string;
  tenantId: string;
  knowledgeBaseId: string | null;
  userId: string;
  kind: 'noop' | 'vision-rerun' | 'bulk-vision-rerun';
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
  payload: unknown;
  progress: JobProgress | null;
  result: unknown;
  errorMessage: string | null;
  parentJobId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastHeartbeatAt: string | null;
  abortRequested: boolean;
  costCentsEstimated: number | null;
  costCentsActual: number | null;
}

export interface JobProgress {
  current: number;
  total: number;
  etaMs?: number | null;
  phase?: string;
  extra?: {
    described?: number;
    decorative?: number;
    failed?: number;
    [k: string]: unknown;
  };
}

export interface VisionRerunResult {
  total: number;
  described: number;
  decorative: number;
  failed: number;
  model: string;
  sampleImages: Array<{
    id: string;
    documentId: string;
    filename: string;
    description: string;
  }>;
}

export interface SubmitJobArgs {
  kind: 'vision-rerun' | 'bulk-vision-rerun';
  payload: unknown;
  knowledgeBaseId?: string | null;
  costCentsEstimated?: number;
}

export function submitJob(args: SubmitJobArgs): Promise<{ id: string }> {
  return api('/api/v1/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
}

export function getJob(jobId: string): Promise<Job> {
  return api(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
}

export function abortJob(jobId: string): Promise<{ ok: boolean }> {
  return api(`/api/v1/jobs/${encodeURIComponent(jobId)}/abort`, { method: 'POST' });
}

export function listJobs(filter: { status?: string; kind?: string; limit?: number } = {}): Promise<{ jobs: Job[] }> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.kind) params.set('kind', filter.kind);
  if (filter.limit) params.set('limit', String(filter.limit));
  const qs = params.toString();
  return api(`/api/v1/jobs${qs ? `?${qs}` : ''}`);
}

// F164 Phase 5 — image quality ratings (👍/👎 on Vision-described images).

export type ImageRating = 'up' | 'down' | null;

export function setImageRating(
  documentId: string,
  filename: string,
  rating: ImageRating,
): Promise<{ ok: boolean; rating: ImageRating }> {
  return api(
    `/api/v1/documents/${encodeURIComponent(documentId)}/images/${encodeURIComponent(
      filename.replace(/^\//, ''),
    )}/rating`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    },
  );
}

export function getImageRating(
  documentId: string,
  filename: string,
): Promise<{ rating: ImageRating }> {
  return api(
    `/api/v1/documents/${encodeURIComponent(documentId)}/images/${encodeURIComponent(
      filename.replace(/^\//, ''),
    )}/rating`,
  );
}

// ── F163 image gallery ──────────────────────────────────────────────────

export interface ImageHit {
  id: string;
  documentId: string;
  filename: string;
  /** Absolute proxy URL — same-origin auth via session cookie. */
  url: string;
  alt: string;
  page: number | null;
  width: number;
  height: number;
  visionModel: string | null;
  createdAt: string;
  /** F163.2 — Vision auto-flag signal (prompt-marker or regex backstop). */
  autoFlagSignal: boolean;
  /** Reason tag, e.g. 'vision-prompt-low' or 'regex:too-small-and-unclear'. */
  autoFlagReason: string | null;
  /** F163.2 — at least one curator has rated this image 'down'. */
  userFlagged: boolean;
}

export type FlagFilter = 'any' | 'auto' | 'user' | 'none';

export interface ImageSource {
  id: string;
  filename: string;
  title: string | null;
  imageCount: number;
}

export function listImageSources(kbId: string): Promise<{ sources: ImageSource[] }> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/images/sources?audience=curator`);
}

export interface ImageListResponse {
  hits: ImageHit[];
  nextCursor: string | null;
}

// F163.1 — bulk endpoints

export function bulkDeleteImages(
  kbId: string,
  imageIds: string[],
): Promise<{ deleted: number; storageWarnings: string[] }> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/images/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageIds }),
  });
}

export function bulkRateImages(
  kbId: string,
  imageIds: string[],
  rating: ImageRating,
): Promise<{ rated: number }> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/images/bulk-rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageIds, rating }),
  });
}

export function listImages(
  kbId: string,
  opts: {
    q?: string;
    docId?: string;
    cursor?: string;
    limit?: number;
    flag?: FlagFilter;
    missingDescription?: boolean;
  } = {},
): Promise<ImageListResponse> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.docId) params.set('docId', opts.docId);
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.flag) params.set('flag', opts.flag);
  if (opts.missingDescription) params.set('missingDescription', 'true');
  // Curator audience for the in-admin gallery — heuristics + internal-
  // tagged Neuron images should be visible to the KB owner.
  params.set('audience', 'curator');
  const qs = params.toString();
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/images?${qs}`);
}

// ── Search ───────────────────────────────────────────────────────

export interface DocumentSearchHit {
  id: string;
  knowledgeBaseId: string;
  filename: string;
  title: string | null;
  path: string;
  kind: 'source' | 'wiki';
  /** HTML snippet with FTS5 `<mark>` tags around matches. */
  highlight: string;
  rank: number;
  /**
   * F92 — comma-separated tag string decorated server-side so the
   * search UI can render chips per hit + so tag-facet filtering has
   * something to match against. Null for sources without tags or
   * when the server-side decoration is skipped.
   */
  tags?: string | null;
}

export interface ChunkSearchHit {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  chunkIndex: number;
  content: string;
  headerBreadcrumb: string | null;
  highlight: string;
  rank: number;
}

export interface SearchResponse {
  documents: DocumentSearchHit[];
  chunks: ChunkSearchHit[];
}

/** FTS5 search across documents + chunks in a KB. Empty query returns empty. */
export function searchKb(
  kbId: string,
  q: string,
  opts: { limit?: number; tags?: string[] } = {},
): Promise<SearchResponse> {
  const qs = new URLSearchParams({ q, limit: String(opts.limit ?? 10) });
  // Repeated ?tag= params — matches the plan doc's URL shape
  // (?q=sanne&tag=incident&tag=ops) so bookmarking hand-composed URLs
  // works without a comma-separator convention.
  for (const tag of opts.tags ?? []) {
    qs.append('tag', tag);
  }
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/search?${qs.toString()}`);
}

// ── Tags (F92) ──────────────────────────────────────────────────

export interface TagCount {
  tag: string;
  count: number;
}

/**
 * Per-KB tag aggregate — every distinct tag on non-archived Neurons
 * with its count. Used by the Queue + Neurons filter chip rows to
 * render the full tag vocabulary up-front. Cached server-side (60s
 * TTL, busted on candidate_approved).
 */
export function listTags(kbId: string): Promise<TagCount[]> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/tags`);
}

// ── Lint (F32) ──────────────────────────────────────────────────

export interface LintReport {
  kbId: string;
  ranAt: string;
  detectors: Array<{
    name: string;
    scanned: number;
    found: number;
    emitted: number;
    skippedExisting: number;
    elapsedMs: number;
  }>;
  totalEmitted: number;
}

/** Run lint detectors on demand. Idempotent via lint fingerprints. */
export function runLint(kbId: string): Promise<LintReport> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/lint`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ── Chat ────────────────────────────────────────────────────────

export interface ChatCitation {
  documentId: string;
  path: string;
  filename: string;
}

export interface ChatImage {
  documentId: string;
  filename: string;
  url: string;
  alt: string;
  page: number | null;
  width: number;
  height: number;
}

export interface ChatResponse {
  answer: string;
  /**
   * F30 — server-side transform of `[[wiki-links]]` → `[display](href)`
   * markdown. Ready for any markdown renderer without parsing.
   * Admin's chat panel prefers this over `answer` when present, so
   * cross-KB links and display labels render identically across consumers.
   */
  renderedAnswer?: string;
  citations?: ChatCitation[];
  /**
   * 2026-05-20 — images surfaced when matched Neurons have any
   * vision-described images. Omitted for `public` audience (Eir);
   * present (possibly empty) for `curator` + `tool`.
   */
  images?: ChatImage[];
  sessionId?: string;
  /**
   * F156 Phase 1 — per-session turn budget. `turnsUsed` is the count
   * AFTER this turn was persisted; `turnsLimit` is the env-tuned cap
   * (default 6). UI shows a soft warning at limit-1 and a hard
   * "start ny chat" prompt at limit. Server emits 429 with code
   * `session_turn_cap_reached` when a 7th attempt arrives.
   */
  turnsUsed?: number;
  turnsLimit?: number;
}

export type ChatAudience = 'curator' | 'tool' | 'public';

export interface ChatSession {
  id: string;
  knowledgeBaseId: string;
  tenantId: string;
  userId: string;
  title: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatTurnRow {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  citations: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
  createdAt: string;
}

/** Single-turn chat against a KB. Engine retrieves via FTS + calls Claude.
 * `audience` controls persona + image-surfacing (curator default, public
 * for Eir-style read-only, tool for downstream LLM integrations). */
export function chat(
  kbId: string,
  message: string,
  sessionId?: string,
  audience?: ChatAudience,
): Promise<ChatResponse> {
  const body: Record<string, unknown> = { message, knowledgeBaseId: kbId };
  if (sessionId) body.sessionId = sessionId;
  if (audience) body.audience = audience;
  return api(`/api/v1/chat`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** F144 — list chat sessions for a KB. `archived` defaults to false. */
export function listChatSessions(
  kbId: string,
  archived: 'false' | 'true' | 'all' = 'false',
): Promise<ChatSession[]> {
  const qs = new URLSearchParams({ archived });
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/chat/sessions?${qs.toString()}`);
}

/** F144 — fetch a session + all its turns in creation order. */
export function getChatSession(sessionId: string): Promise<{ session: ChatSession; turns: ChatTurnRow[] }> {
  return api(`/api/v1/chat/sessions/${encodeURIComponent(sessionId)}`);
}

/** F144 — rename or archive a session. */
export function patchChatSession(
  sessionId: string,
  patch: { title?: string; archived?: boolean },
): Promise<ChatSession> {
  return api(`/api/v1/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/** F144 — hard-delete a session. Cascades to turns via FK. */
export function deleteChatSession(sessionId: string): Promise<{ deleted: true }> {
  return api(`/api/v1/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

/**
 * Feedback loop: promote a chat Q+A into the Curation Queue as a candidate.
 * Uses kind='chat-answer'. Created by the curator (not service), so it lands
 * as pending for manual review — a human chose to save this, a human should
 * confirm it's worth committing to the wiki.
 */
export function saveChatAsNeuron(args: {
  kbId: string;
  question: string;
  answer: string;
  citations: ChatCitation[];
  title: string;
  confidence?: number;
}): Promise<unknown> {
  const slug = slugify(args.title);
  const metadata = JSON.stringify({
    op: 'create',
    filename: `${slug}.md`,
    path: '/neurons/queries/',
    source: 'chat',
    connector: 'chat',
    sourceCitations: args.citations.map((c) => c.documentId),
  });
  const content = [
    `# ${args.title}`,
    '',
    `**Question:** ${args.question}`,
    '',
    '---',
    '',
    args.answer,
    args.citations.length
      ? '\n\n---\n\n## Sources\n' +
        args.citations.map((c) => `- [[${c.filename.replace(/\.md$/i, '')}]]`).join('\n')
      : '',
  ].join('\n');

  return api(`/api/v1/queue/candidates`, {
    method: 'POST',
    body: JSON.stringify({
      knowledgeBaseId: args.kbId,
      kind: 'chat-answer',
      title: args.title,
      content,
      metadata,
      confidence: args.confidence ?? 0.6,
    }),
  });
}

/** Manually create a Neuron — lands in queue as a curator candidate. */
export function createNeuron(args: {
  kbId: string;
  title: string;
  path: string;
  content?: string;
  tags?: string;
}): Promise<{ id: string }> {
  const slug = slugify(args.title);
  const metadata = JSON.stringify({
    op: 'create',
    filename: `${slug}.md`,
    path: args.path,
    source: 'curator',
    connector: 'curator',
  });
  const fm = args.tags ? `---\ntags: [${args.tags}]\n---\n\n` : '';
  const content = `${fm}# ${args.title}\n\n${args.content ?? ''}`.trimEnd() + '\n';
  return api(`/api/v1/queue/candidates`, {
    method: 'POST',
    body: JSON.stringify({
      knowledgeBaseId: args.kbId,
      kind: 'external-feed',
      title: args.title,
      content,
      metadata,
      confidence: 1,
    }),
  });
}

/**
 * Upload a source file. Uses multipart/form-data — do NOT set Content-Type;
 * the browser generates the boundary. Flows through the same endpoint the
 * engine has had since F06.
 */
export async function uploadSource(
  kbId: string,
  file: File,
  opts: { path?: string; force?: boolean } = {},
): Promise<Document> {
  const form = new FormData();
  form.append('file', file);
  if (opts.path) form.append('path', opts.path);

  const url =
    `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/documents/upload` +
    (opts.force ? '?force=true' : '');
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let body: Record<string, unknown> | undefined;
    try {
      body = (await response.json()) as Record<string, unknown>;
      if (body.error) message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
    } catch {
      // ignore
    }
    // F162 — pass full body so caller can read .code (e.g.
    // 'duplicate_source') + .body (existingDocumentId, etc.).
    throw new ApiError(response.status, message, body);
  }
  return (await response.json()) as Document;
}

// ── F21 — Ingest Backpressure status ─────────────────────────────────────

export interface IngestStatus {
  globalCapacity: { running: number; max: number; available: number };
  kb: {
    runningJobId: string | null;
    queued: Array<{
      jobId: string;
      documentId: string;
      position: number;
      queuedAt: string;
    }>;
  };
  tenant: { last1hCount: number; rateCap: number; rateAvailable: number };
  config: { globalCap: number; perTenantRate: number; schedulerIntervalMs: number };
}

export function getIngestStatus(kbId: string): Promise<IngestStatus> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/ingest-status`);
}

// ── F151 — Cost & Quality Dashboard ──────────────────────────────────────

export interface CostSummary {
  windowDays: number;
  totalCents: number;
  totalEstimatedCents: number;
  jobCount: number;
  byDay: Array<{ date: string; cents: number; jobs: number; estimatedCents: number | null }>;
  bySource: Array<{
    documentId: string;
    filename: string;
    title: string | null;
    cents: number;
    jobCount: number;
  }>;
  avgCentsPerNeuron: number;
  includeShadow: boolean;
}

export function getCostSummary(kbId: string, windowDays = 30, includeShadow = false): Promise<CostSummary> {
  const shadowParam = includeShadow ? '&shadow=1' : '';
  return api<CostSummary>(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/cost?window=${windowDays}${shadowParam}`);
}

export function costCsvUrl(kbId: string, windowDays = 30): string {
  return `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/cost.csv?window=${windowDays}`;
}

// F190.5 — per-tenant discrete-LLM cost from upmetrics (the ai-sdk-routed calls:
// chat/vision/helpers), shown alongside the internal ingest cost. Server-side
// scoped to the authenticated tenant (leak-safe). `summary` is null when no
// upmetrics key is configured or the fetch failed → the panel omits the overlay.
export interface UpmetricsCostSummary {
  generatedAt: string;
  window: { from: string; to: string };
  totalMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  runCount: number;
  metered: { meteredMicroUsd: number; freeRunCount: number };
  byModel: Array<{ key: string; microUsd: number; runCount: number }>;
  byCapability: Array<{ key: string; microUsd: number; runCount: number }>;
}

export function getUpmetricsCost(
  kbId: string,
  window: 'day' | 'week' | 'month' = 'month',
): Promise<{ summary: UpmetricsCostSummary | null }> {
  return api<{ summary: UpmetricsCostSummary | null }>(
    `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/cost/upmetrics?window=${window}`,
  );
}

export type CostSourceSort = 'cost' | 'jobs' | 'filename' | 'title' | 'recent';
export type CostSortOrder = 'asc' | 'desc';

export interface CostSourcesPage {
  sources: Array<{
    documentId: string;
    filename: string;
    title: string | null;
    cents: number;
    jobCount: number;
    lastIngestedAt: string | null;
  }>;
  total: number;
  limit: number;
  offset: number;
  sort: CostSourceSort;
  order: CostSortOrder;
}

export function getCostSources(
  kbId: string,
  opts: {
    windowDays?: number;
    sort?: CostSourceSort;
    order?: CostSortOrder;
    limit?: number;
    offset?: number;
  } = {},
): Promise<CostSourcesPage> {
  const qs = new URLSearchParams();
  qs.set('window', String(opts.windowDays ?? 30));
  qs.set('sort', opts.sort ?? 'cost');
  qs.set('order', opts.order ?? 'desc');
  qs.set('limit', String(opts.limit ?? 25));
  qs.set('offset', String(opts.offset ?? 0));
  return api<CostSourcesPage>(
    `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/cost/sources?${qs.toString()}`,
  );
}

export interface QualityRun {
  jobId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  backend: string | null;
  primaryModel: string | null;
  finalModel: string | null;
  costCents: number;
  modelTrailLen: number;
  metrics: {
    neuronsCreated: number;
    conceptsCreated: number;
    entitiesCreated: number;
    wikiBacklinks: number;
    typedEdges: number;
    openBrokenLinks: number;
  };
}

export interface QualityComparison {
  source: { id: string; filename: string; title: string | null };
  runs: QualityRun[];
}

export function getQualityRuns(sourceId: string): Promise<QualityComparison> {
  return api<QualityComparison>(`/api/v1/sources/${encodeURIComponent(sourceId)}/ingests`);
}

// ── F151 — FX rate for locale-localised cost display ────────────────────

export interface FxRate {
  from: string;
  to: string;
  rate: number;
  fetchedAt: string;
  stale: boolean;
}

export function getFxRate(from: string, to: string): Promise<FxRate> {
  return api<FxRate>(`/api/v1/fx/rate?from=${from}&to=${to}`);
}

// ── F156 — Credits ──────────────────────────────────────────────────────

export interface CreditTransaction {
  id: string;
  kind: 'consume' | 'monthly_topup' | 'purchase' | 'adjustment' | 'refund';
  amount: number;
  balanceAfter: number;
  feature: 'ingest' | 'chat' | 'lint' | 'extract' | null;
  relatedIngestJobId: string | null;
  relatedChatTurnId: string | null;
  note: string | null;
  createdAt: string;
}

export interface CreditsResponse {
  balance: number;
  monthlyIncluded: number;
  lastTopupAt: string | null;
  updatedAt: string | null;
  recent: CreditTransaction[];
}

export function getCredits(): Promise<CreditsResponse> {
  return api<CreditsResponse>('/api/v1/credits');
}

// ── F150 — Link-Report panel ────────────────────────────────────────────

export type LinkFindingStatus = 'open' | 'auto_fixed' | 'dismissed';

export interface LinkFinding {
  id: string;
  fromDocumentId: string;
  fromFilename: string;
  fromTitle: string | null;
  linkText: string;
  suggestedFix: string | null;
  status: LinkFindingStatus;
  reportedAt: string;
}

export function getLinkCheckFindings(kbId: string): Promise<{ findings: LinkFinding[] }> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/link-check`);
}

export interface LinkRescanSummary {
  docsScanned: number;
  openRecorded: number;
  resolved: number;
}

export function rescanLinkCheck(kbId: string): Promise<LinkRescanSummary> {
  return api(
    `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/link-check/rescan`,
    { method: 'POST' },
  );
}

export function acceptLinkFix(
  id: string,
): Promise<{ accepted: true; newVersion: number; wikiEventId: string | null }> {
  return api(`/api/v1/link-check/${encodeURIComponent(id)}/accept`, { method: 'POST' });
}

export function dismissLinkFinding(id: string): Promise<{ dismissed: true }> {
  return api(`/api/v1/link-check/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
}

export function reopenLinkFinding(id: string): Promise<{ reopened: true }> {
  return api(`/api/v1/link-check/${encodeURIComponent(id)}/reopen`, { method: 'POST' });
}

// ── F176 Lint cadence ──────────────────────────────────────────────

export interface LintStatus {
  /** Effective cadence (per-KB override OR global fallback). */
  cadenceDays: number;
  /** True when the KB has its own lint_schedule_days set. */
  isExplicit: boolean;
  /** Global default reflecting current TRAIL_LINT_SCHEDULE_DAYS. */
  defaultDays: number;
  /** ISO timestamp of the most-recent lint.completed with trigger='scheduled'. */
  lastScheduledAt: string | null;
  /** Most-recent manual lint click. */
  lastManualAt: string | null;
  /** When the next scheduled pass is due. */
  nextDueAt: string;
  /** Findings from the last scheduled pass. */
  lastFindings: number | null;
  /** Wall-clock duration of the last scheduled pass. */
  lastElapsedMs: number | null;
}

export function getLintStatus(kbId: string): Promise<LintStatus> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/lint/status`);
}

// ── F97 Activity Log ───────────────────────────────────────────────

export interface ActivityRow {
  id: string;
  tenantId: string;
  knowledgeBaseId: string | null;
  actorId: string | null;
  actorKind: 'user' | 'llm' | 'system' | 'pipeline';
  kind: string;
  subjectType: 'document' | 'candidate' | 'knowledge_base' | 'user' | 'session' | 'none';
  subjectId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityListResponse {
  items: ActivityRow[];
  nextCursor: string | null;
}

export interface ActivityFilter {
  kbId?: string;
  kind?: string;
  actorId?: string;
  subjectType?: ActivityRow['subjectType'];
  subjectId?: string;
  since?: string;
  limit?: number;
  cursor?: string;
}

export function listActivity(f: ActivityFilter = {}): Promise<ActivityListResponse> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
  }
  const tail = qs.toString() ? `?${qs}` : '';
  return api(`/api/v1/activity${tail}`);
}

// ── F152 — Per-KB ingest backend settings ────────────────────────────────

export type IngestBackendId = 'claude-cli' | 'openrouter';

export interface ChainStep {
  backend: IngestBackendId;
  model: string;
  translationModel?: string;
}

export interface IngestSettingsResponse {
  overrides: {
    ingestBackend: IngestBackendId | null;
    ingestModel: string | null;
    ingestFallbackChain: ChainStep[] | null;
  };
  effectiveChain: ChainStep[];
}

export function getIngestSettings(kbId: string): Promise<IngestSettingsResponse> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/ingest-settings`);
}

export function updateIngestSettings(
  kbId: string,
  body: {
    ingestBackend?: IngestBackendId | null;
    ingestModel?: string | null;
    ingestFallbackChain?: ChainStep[] | null;
  },
): Promise<IngestSettingsResponse> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/ingest-settings`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// ── F159 — Per-KB Chat Backends settings ──────────────────────────

import type { ChatBackendId } from '@trail/shared';

export interface ChatChainStep {
  backend: ChatBackendId;
  model: string;
}

export interface ChatSettingsResponse {
  overrides: {
    chatBackend: ChatBackendId | null;
    chatModel: string | null;
    chatFallbackChain: ChatChainStep[] | null;
  };
  effectiveChain: ChatChainStep[];
}

export function getChatSettings(kbId: string): Promise<ChatSettingsResponse> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/chat-settings`);
}

export function updateChatSettings(
  kbId: string,
  body: {
    chatBackend?: ChatBackendId | null;
    chatModel?: string | null;
    chatFallbackChain?: ChatChainStep[] | null;
  },
): Promise<ChatSettingsResponse> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/chat-settings`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

// ── F153 Phase 4 — Read-only backup health ─────────────────────────

export interface BackupHealth {
  configured: boolean;
  providerType: string;
  lastSuccess: string | null;
  last30Days: number;
  /** null = not configured; bool reflects "fresh enough". */
  healthy: boolean | null;
}

export function getBackupHealth(): Promise<BackupHealth> {
  return api('/api/v1/backups/health');
}

// ── F31 — Reader feedback ─────────────────────────────────────────

export interface ReaderFeedbackBody {
  vote: 'up' | 'down' | 'flag';
  question: string;
  answer: string;
  citations?: Array<{ documentId: string; path: string; filename: string }>;
  sessionId?: string;
  turnId?: string;
  reason?: string;
  category?: 'wrong-info' | 'missing-info' | 'irrelevant' | 'tone' | 'other';
  pageUrl?: string;
}

export interface ReaderFeedbackResponse {
  candidateId: string;
  status: string;
  queueUrl: string;
}

export function submitReaderFeedback(
  kbId: string,
  body: ReaderFeedbackBody,
): Promise<ReaderFeedbackResponse> {
  return api(`/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/reader-feedback`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
