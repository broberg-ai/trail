/**
 * F160 Phase 1 — `POST /api/v1/knowledge-bases/:kbId/retrieve`.
 *
 * Lag 1 retrieval — det primære integrations-endpoint for site-LLM-
 * orchestratorer. Forskellen fra `/search`: body i stedet for query-
 * string (større queries OK), returnerer chunks med fuld content +
 * en pre-formatteret `formattedContext`-blok klar til at stuffe ind
 * i en site-LLM's prompt uden second-pass `read`-kald.
 *
 * Designed til at site-LLM kan ringe ind med brugerens spørgsmål,
 * få relevant KB-baggrund tilbage, og selv formulere svaret i sin
 * egen tone uden et ekstra Trail-LLM-kald i mellem.
 *
 * Audience-filtering: Bearer-callers defaulter til `tool` så
 * heuristics + internal-tagged Neurons aldrig leaker. Caller kan
 * eksplicit overskrive til `curator` eller `public` via body-felt.
 *
 * Token-budget: `maxChars` (default 2000) er en HARD upper-bound på
 * sum(chunks.content) i `formattedContext`. Vi bygger fra højest
 * rank ned indtil næste chunk ville sprænge budgettet, så site-LLM
 * får de mest relevante chunks selv når mange kunne matche.
 */

import { Hono } from 'hono';
import { documents, documentImages, knowledgeBases } from '@trail/db';
import { and, eq, inArray } from 'drizzle-orm';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';
import { canonicaliseTag, parseTags, kbPrefix, buildFtsQuery } from '@trail/shared';
import { resolveKbId, stripClaimAnchors } from '@trail/core';
import {
  parseAudienceParam,
  defaultAudienceForAuth,
  isVisibleToAudience,
  type Audience,
} from '../services/audience.js';
import type { AppBindings } from '../app.js';

export const retrieveRoutes = new Hono<AppBindings>();
retrieveRoutes.use('*', requireAuth);

/**
 * F213.1 — normalise `documents.updated_at` to ISO-8601 UTC.
 *
 * The column holds two formats, written by two different code paths, in the
 * same table. Measured on prod 2026-08-27:
 *
 *   schema default `datetime('now')`  ->  '2026-06-22 12:07:09'      5760 rows
 *   app code `new Date().toISOString()` -> '2026-04-16T16:31:49.278Z' 589 rows
 *
 * BOTH are UTC. Only one says so. A consumer doing the obvious
 * `new Date(value)` parses the space-separated form as LOCAL time per the
 * ECMAScript spec, so 93 % of rows would silently land two hours off in
 * Copenhagen summer while the rest are exact — two wrong answers that look
 * identical from the caller's side.
 *
 * So the space-separated form is LABELLED, not converted: we append the `T`
 * and the `Z` that the stored value already means. `new Date(v).toISOString()`
 * would shift it by the local offset and is the bug this function exists to
 * avoid — see the test that asserts the exact string.
 *
 * Anything unparseable yields null. For a freshness field a wrong date is
 * worse than no date, so we never guess.
 */
export function normaliseUpdatedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  // Already ISO-8601 with an explicit UTC marker — hand it back untouched.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v)) return v;
  // SQLite `datetime('now')`: 'YYYY-MM-DD HH:MM:SS', already UTC, unlabelled.
  const sqlite = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(v);
  if (sqlite) return `${sqlite[1]}T${sqlite[2]}.000Z`;
  return null;
}

const DEFAULT_TOP_K = 5;
const DEFAULT_MAX_CHARS = 2000;
const HARD_TOP_K_CAP = 25;
const HARD_MAX_CHARS = 8000;
// F161 — image-budget. Default keeps prompt-stuffing manageable; cap
// stops a malicious caller from forcing a huge images[] array on a
// document with many extracted images.
const DEFAULT_MAX_IMAGES = 10;
const HARD_MAX_IMAGES_CAP = 50;

interface RetrieveBody {
  query?: unknown;
  audience?: unknown;
  maxChars?: unknown;
  topK?: unknown;
  tagFilter?: unknown;
  maxImages?: unknown;
}

retrieveRoutes.post('/knowledge-bases/:kbId/retrieve', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Not found' }, 404);

  let body: RetrieveBody;
  try {
    body = (await c.req.json()) as RetrieveBody;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return c.json({ error: 'query is required' }, 400);
  }

  const authType = c.get('authType');
  const audience: Audience =
    parseAudienceParam(typeof body.audience === 'string' ? body.audience : null) ??
    defaultAudienceForAuth(authType);

  // Clamp numeric inputs into safe ranges. We don't 400 on out-of-band
  // values — better to silently honour the cap than make an integration
  // fragile to "I sent 1000 instead of the max 25" goofs.
  const topK = clampInt(body.topK, DEFAULT_TOP_K, 1, HARD_TOP_K_CAP);
  const maxChars = clampInt(body.maxChars, DEFAULT_MAX_CHARS, 1, HARD_MAX_CHARS);
  const maxImages = clampInt(body.maxImages, DEFAULT_MAX_IMAGES, 0, HARD_MAX_IMAGES_CAP);

  const tagFilter = parseTagFilter(body.tagFilter);

  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) {
    // Empty / un-FTS-able query (e.g. all stopwords) — return zero hits
    // rather than 500. Site-LLM can decide whether to retry or fall back
    // to "I couldn't find anything specific".
    return c.json({
      chunks: [],
      formattedContext: '',
      totalChars: 0,
      hitCount: 0,
    });
  }

  // Pull more chunks than topK so audience + tag filtering still leaves
  // a useful list when many chunks come from filtered-out documents.
  // 3x is a safe over-fetch — the FTS5 cost is dominated by the query
  // parse + match, not the extra 10 rows back.
  const rawChunks = await trail.searchChunks(ftsQuery, kbId, tenant.id, topK * 3);

  if (rawChunks.length === 0) {
    return c.json({
      chunks: [],
      formattedContext: '',
      totalChars: 0,
      hitCount: 0,
    });
  }

  // Hydrate parent-document metadata in one IN-query.
  const docIds = Array.from(new Set(rawChunks.map((c) => c.documentId)));
  const parentDocs = await trail.db
    .select({
      id: documents.id,
      title: documents.title,
      path: documents.path,
      tags: documents.tags,
      seq: documents.seq,
      knowledgeBaseId: documents.knowledgeBaseId,
      // F112.1 — only surface user_note when curator explicitly opted
      // this Neuron in to share. Default-private rows return null
      // here even when the column is set.
      userNote: documents.userNote,
      userNoteShare: documents.userNoteShare,
      // F213.1 — source freshness, so a consumer can say "as of 13/8"
      // instead of restating a decision that has since moved.
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenant.id),
        inArray(documents.id, docIds),
      ),
    )
    .all();

  const docMap = new Map(parentDocs.map((d) => [d.id, d]));

  // Resolve KB prefix once for seqId rendering. All chunks come from the
  // same caller-specified KB so we only need one lookup.
  const kbRow = await trail.db
    .select({ name: knowledgeBases.name })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, kbId))
    .get();
  const prefix = kbRow ? kbPrefix(kbRow.name) : null;

  // Apply audience + tag filtering, then build the budgeted result list.
  const filtered: Array<{
    documentId: string;
    seqId: string | null;
    title: string;
    neuronPath: string;
    content: string;
    headerBreadcrumb: string | null;
    rank: number;
    /**
     * F112.1 — curator's own reflection, only present when
     * userNoteShare is opted-in on the parent document. NULL when
     * private (default) or absent. Already stripped of claim-anchor
     * markers if those ever leak into a note.
     */
    userNote: string | null;
    /** F213.1 — parent document's last edit, ISO-8601 UTC, null if unparseable. */
    updatedAt: string | null;
  }> = [];

  for (const chunk of rawChunks) {
    const doc = docMap.get(chunk.documentId);
    if (!doc) continue;
    if (!isVisibleToAudience(audience, doc.path, doc.tags)) continue;
    if (tagFilter.length > 0) {
      const docTags = parseTags(doc.tags ?? null).map((t) => t.toLowerCase());
      if (!tagFilter.every((t) => docTags.includes(t))) continue;
    }
    // F112.1 — only expose user_note when curator opted this Neuron
    // in to sharing. Default-private rows yield null even when the
    // column is set on disk.
    const sharedUserNote =
      doc.userNoteShare && doc.userNote
        ? stripClaimAnchors(doc.userNote)
        : null;
    filtered.push({
      documentId: doc.id,
      seqId: prefix && doc.seq != null ? `${prefix}_${String(doc.seq).padStart(8, '0')}` : null,
      title: doc.title ?? doc.path.split('/').pop() ?? doc.path,
      neuronPath: doc.path,
      // F22 leak-prevention: strip claim-anchor markers before any
      // external orchestrator (Sanne's site, third-party integrators)
      // sees the content. The markers are an internal cross-reference
      // primitive — they leaking into a downstream LLM prompt is the
      // failure-mode Christian flagged 2026-05-03.
      content: stripClaimAnchors(chunk.content),
      headerBreadcrumb: chunk.headerBreadcrumb,
      rank: chunk.rank,
      userNote: sharedUserNote,
      updatedAt: normaliseUpdatedAt(doc.updatedAt),
    });
    if (filtered.length >= topK) break;
  }

  // Build formattedContext within maxChars budget. Higher rank wins;
  // we keep adding chunks in order until the next one would exceed.
  // This prefers fewer high-rank chunks over many low-rank ones — site-
  // LLM benefits more from focused context than scattered crumbs.
  //
  // Edge case: if the highest-rank chunk alone exceeds maxChars,
  // include it truncated rather than returning empty. Truncation
  // preserves the start of the chunk (PDF-pipeline writes section
  // headers + intro sentences first), so a partial result is still
  // useful for site-LLM stuffing. Returning nothing on every too-big
  // chunk would be worse — caller has no way to recover from that.
  const sections: string[] = [];
  const includedChunks: typeof filtered = [];
  let totalChars = 0;
  // F112.1 — track which docs we've already appended user-note for so
  // we don't repeat it on every chunk from the same parent. The note
  // is per-document, not per-chunk.
  const userNoteAppendedFor = new Set<string>();
  for (const c of filtered) {
    const header = c.headerBreadcrumb
      ? `## ${c.title} — ${c.headerBreadcrumb}`
      : `## ${c.title}`;
    let section = `${header}\n\n${c.content}`;
    if (c.userNote && !userNoteAppendedFor.has(c.documentId)) {
      section += `\n\n### Curator's reflection (their own words, opt-in shared)\n${c.userNote}`;
      userNoteAppendedFor.add(c.documentId);
    }
    const sep = sections.length > 0 ? 2 : 0;
    const projected = totalChars + section.length + sep;
    if (projected <= maxChars) {
      sections.push(section);
      includedChunks.push(c);
      totalChars = projected;
      continue;
    }
    // Doesn't fit. If we already have at least one chunk, stop —
    // higher-rank chunks already in. If we have NOTHING yet, include
    // the head of this chunk truncated to maxChars so the caller
    // gets the most-relevant content, not an empty response.
    if (sections.length === 0) {
      const truncated = section.slice(0, maxChars - 1) + '…';
      sections.push(truncated);
      includedChunks.push(c);
      totalChars = truncated.length;
    }
    break;
  }
  const formattedContext = sections.join('\n\n');

  // F161 — query document_images for the documents represented in
  // includedChunks. Returns images-per-document with absolute URLs
  // ready to drop into a site-LLM context (or proxy through the
  // consumer's own /api/trail-image/[...] route — see
  // INTEGRATION-API.md). maxImages caps the array size; we sort by
  // (documentId, filename) so the same query returns deterministic
  // ordering across calls. Skipped entirely when maxImages=0.
  let images: Array<{
    documentId: string;
    filename: string;
    url: string;
    alt: string;
    page: number | null;
    width: number;
    height: number;
  }> = [];
  if (maxImages > 0 && includedChunks.length > 0) {
    const docIdsForImages = Array.from(
      new Set(includedChunks.map((c) => c.documentId)),
    );
    const imageRows = await trail.db
      .select({
        documentId: documentImages.documentId,
        filename: documentImages.filename,
        page: documentImages.page,
        width: documentImages.width,
        height: documentImages.height,
        visionDescription: documentImages.visionDescription,
      })
      .from(documentImages)
      .where(
        and(
          eq(documentImages.tenantId, tenant.id),
          inArray(documentImages.documentId, docIdsForImages),
          // F232.1 — never hand out an image that is still waiting to be judged.
          eq(documentImages.triage, 'kept'),
        ),
      )
      .all();
    // Relative URL — same-origin contract with the caller. Admin uses
    // app.trailmem.com → admin-server proxy injects bearer when the
    // <img> request loops back to /api/v1/documents/.../images/...
    // External embedders (widget chat-proxy etc.) need to proxy
    // images through their own host the same way they proxy /chat,
    // because the engine's image route is bearer-gated and browser
    // <img> tags can't carry bearer headers. The previous absolute
    // form `${engineOrigin}/...` looked correct but broke admin
    // browsers (cross-origin cookies blocked).
    images = imageRows.slice(0, maxImages).map((row) => ({
      documentId: row.documentId,
      filename: row.filename,
      url: `/api/v1/documents/${row.documentId}/images/${row.filename.replace(/^\//, '')}`,
      alt: row.visionDescription ?? '',
      page: row.page,
      width: row.width,
      height: row.height,
    }));
  }

  return c.json({
    chunks: includedChunks,
    formattedContext,
    totalChars,
    hitCount: includedChunks.length,
    images,
  });
});

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function parseTagFilter(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => canonicaliseTag(t))
    .filter((t): t is string => !!t);
}
