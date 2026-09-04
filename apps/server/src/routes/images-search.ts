/**
 * F161 — image-search endpoint.
 *
 * `GET /api/v1/knowledge-bases/:kbId/images?q=&limit=&audience=`
 *
 * FTS5 over `document_images.vision_description` via the contentless
 * `document_images_fts` virtual table. Returns image rows with
 * absolute URLs + parent-doc audience-filter applied.
 *
 * Use cases:
 *   - "Find images about søvn" → curator browse / Eir-chat-tool
 *   - Image-galleri view (when admin UI gets it)
 *   - Site-LLM orchestrator that wants to surface specific images
 *     beyond what /retrieve already returns
 *
 * Audience-filter: Bearer-keys default to `tool` so heuristic +
 * internal-tagged Neuron images never leak. Done by joining
 * documents and applying isVisibleToAudience.
 */

import { Hono } from 'hono';
import { documents, documentImages, knowledgeBases } from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';
import { needsDerivative } from '../services/vision-derivative.js';
import { resolveKbId } from '@trail/core';
import {
  parseAudienceParam,
  defaultAudienceForAuth,
  isVisibleToAudience,
  type Audience,
} from '../services/audience.js';
import type { AppBindings } from '../app.js';
import { buildFtsQuery } from '@trail/shared';

export const imagesSearchRoutes = new Hono<AppBindings>();
imagesSearchRoutes.use('*', requireAuth);

const HARD_LIMIT_CAP = 50;

imagesSearchRoutes.get('/knowledge-bases/:kbId/images', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Not found' }, 404);

  const query = (c.req.query('q') ?? '').trim();
  const limit = Math.min(Number(c.req.query('limit') ?? 20), HARD_LIMIT_CAP);
  const audience: Audience =
    parseAudienceParam(c.req.query('audience')) ??
    defaultAudienceForAuth(c.get('authType'));
  // F163 — optional per-source filter for the image-gallery panel.
  const docIdFilter = c.req.query('docId') ?? null;
  // F163.2 — flag-status filter. 'any' = auto OR curator-flagged,
  // 'auto' = auto only, 'user' = curator-down only, 'none' = neither.
  // Empty / unrecognised → no filter (all images).
  const flagFilter = parseFlagFilter(c.req.query('flag'));
  // F163.2.x — "missing description" filter for the gallery's per-row
  // "Kør vision"-flow. true = only rows where vision_description IS NULL.
  const missingDescription = c.req.query('missingDescription') === 'true';
  // F163 — cursor pagination so the gallery can load-more on scroll.
  // Browse mode: cursor = base64(`${created_at}|${id}`); we paginate
  // with WHERE (created_at, id) < (cursor.created_at, cursor.id) so
  // pages are stable even if a new image lands during scroll.
  // FTS mode: cursor = decimal offset (FTS-rank pages aren't
  // tuple-comparable; rank-stability across requests is the FTS5
  // contract).
  const cursorRaw = c.req.query('cursor') ?? null;

  // Empty query: return latest N images for this KB so admin browse
  // works without a search term. We sort by created_at DESC (newest
  // first) — same convention as the rest of the admin browse views.
  const ftsQuery = query ? buildFtsQuery(query) : '';
  const overFetch = limit * 3; // audience-filter eats some, hence over-fetch

  // F163.2 — flag-WHERE clause shared between FTS + browse paths.
  // Reuses an EXISTS-subquery against vision_quality_ratings so we
  // don't have to JOIN the table when no flag-filter is requested.
  const flagClause = buildFlagClause(flagFilter);
  const missingDescClause = missingDescription
    ? `AND di.vision_description IS NULL`
    : '';

  // Build args + WHERE additions for filters (docId + cursor + flag).
  let result;
  if (ftsQuery) {
    const offset = decodeFtsCursor(cursorRaw);
    const docClause = docIdFilter ? 'AND di.document_id = ?' : '';
    // F229.2 — search the DESCRIPTION index and the OCR index together.
    //
    // Two contentless FTS tables rather than one wider one: fts5 cannot ALTER,
    // so widening the existing index would mean DROP + CREATE on a production
    // deploy. The cost is this UNION.
    //
    // MIN(rk) so a row that matches in BOTH indexes ranks by its better hit
    // instead of appearing twice — an image whose caption AND printed text
    // both mention the term is a better result, not two results.
    const sql = `
      SELECT di.id, di.document_id, di.filename, di.page, di.width, di.height,
             di.size_bytes, di.vision_description, di.vision_model, di.created_at,
             di.ocr_text, di.auto_flag_signal, di.auto_flag_reason,
             d.path AS doc_path, d.tags AS doc_tags,
             MIN(m.rk) AS rk
        FROM (
          SELECT rowid, rank AS rk FROM document_images_fts
           WHERE vision_description MATCH ?
          UNION ALL
          SELECT rowid, rank AS rk FROM document_images_ocr_fts
           WHERE ocr_text MATCH ?
        ) m
        JOIN document_images di ON di.rowid = m.rowid
        JOIN documents d ON d.id = di.document_id
       WHERE di.tenant_id = ?
         AND di.knowledge_base_id = ?
         -- F232.1 — an image waiting in the pending store is not in the Trail
         -- yet. Excluded here rather than filtered in the caller, so a new
         -- reader cannot forget it.
         AND di.triage = 'kept'
         ${docClause}
         ${flagClause}
         ${missingDescClause}
       GROUP BY di.id
       ORDER BY rk
       LIMIT ? OFFSET ?
    `;
    const args: Array<string | number> = [ftsQuery, ftsQuery, tenant.id, kbId];
    if (docIdFilter) args.push(docIdFilter);
    args.push(overFetch, offset);
    result = await trail.execute(sql, args);
  } else {
    const cursor = decodeBrowseCursor(cursorRaw);
    const cursorClause = cursor
      ? 'AND (di.created_at < ? OR (di.created_at = ? AND di.id < ?))'
      : '';
    const docClause = docIdFilter ? 'AND di.document_id = ?' : '';
    const sql = `
      SELECT di.id, di.document_id, di.filename, di.page, di.width, di.height,
             di.size_bytes, di.vision_description, di.vision_model, di.created_at,
             di.ocr_text, di.auto_flag_signal, di.auto_flag_reason,
             d.path AS doc_path, d.tags AS doc_tags
        FROM document_images di
        JOIN documents d ON d.id = di.document_id
       WHERE di.tenant_id = ?
         AND di.knowledge_base_id = ?
         AND di.triage = 'kept'   -- F232.1, same reason as the FTS branch above
         ${cursorClause}
         ${docClause}
         ${flagClause}
         ${missingDescClause}
       ORDER BY di.created_at DESC, di.id DESC
       LIMIT ?
    `;
    const args: Array<string | number> = [tenant.id, kbId];
    if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    if (docIdFilter) args.push(docIdFilter);
    args.push(overFetch);
    result = await trail.execute(sql, args);
  }

  const visibleRows = (result.rows as Array<Record<string, unknown>>).filter((row) =>
    isVisibleToAudience(audience, String(row.doc_path), row.doc_tags as string | null),
  );
  const pageRows = visibleRows.slice(0, limit);

  // F163.2 — surface auto-flag info to the gallery so the UI can
  // render badges + the curator-flag union (curator side comes via a
  // separate `userFlagged` lookup below — kept light-weight for the
  // common no-flag case).
  const flaggedIds = await fetchCuratorFlaggedSet(
    trail,
    pageRows.map((r) => String(r.id)),
  );

  const hits = pageRows.map((row) => ({
    id: String(row.id),
    documentId: String(row.document_id),
    filename: String(row.filename),
    // Relative URL — same-origin from the admin SPA's POV. Admin-server
    // proxies /api/v1/* to engine and injects the tenant bearer, so
    // <img src="/api/v1/documents/…"> works with the session cookie.
    // Building this with the engine's OWN origin (the previous
    // `${baseUrl}/...` form) produced cross-origin URLs like
    // engine-001.trailmem.com/... which the browser couldn't auth
    // against from app.trailmem.com — every image rendered as a
    // broken icon. Relative URL keeps the same-origin contract
    // documented on the ImageHit type.
    url: `/api/v1/documents/${row.document_id}/images/${String(row.filename).replace(/^\//, '')}`,
    // F161.5 — relative thumbnail URL (≤1568px WebP via the serve route's
    // ?variant=thumb branch) only for images heavy enough to warrant a
    // derivative; null otherwise so a consumer's `thumbnailUrl ?? url`
    // falls back to the (already small) original.
    thumbnailUrl: needsDerivative(
      Number(row.width),
      Number(row.height),
      Number(row.size_bytes ?? 0),
    )
      ? `/api/v1/documents/${row.document_id}/images/${String(row.filename).replace(/^\//, '')}?variant=thumb`
      : null,
    alt: (row.vision_description as string | null) ?? '',
    page: row.page as number | null,
    width: row.width as number,
    height: row.height as number,
    visionModel: (row.vision_model as string | null) ?? null,
    // F229.2 — the text READ OUT of the image, separate from `alt` (which is
    // the model's description of it). null means either "no readable text" or
    // "OCR has not run"; the row's ocr_at is what tells those apart.
    ocrText: (row.ocr_text as string | null) ?? null,
    createdAt: String(row.created_at),
    autoFlagSignal: Number(row.auto_flag_signal ?? 0) === 1,
    autoFlagReason: (row.auto_flag_reason as string | null) ?? null,
    userFlagged: flaggedIds.has(String(row.id)),
  }));

  // Compute nextCursor only when there's more — i.e. the over-fetch
  // saw at least `limit + 1` audience-visible rows OR we hit the raw
  // SQL limit (suggesting a full page even before audience-filter).
  let nextCursor: string | null = null;
  const sawMore =
    visibleRows.length > limit ||
    (visibleRows.length === limit && (result.rows.length as number) >= overFetch);
  if (sawMore && hits.length > 0) {
    const last = hits[hits.length - 1]!;
    if (ftsQuery) {
      const prevOffset = decodeFtsCursor(cursorRaw);
      nextCursor = encodeFtsCursor(prevOffset + hits.length);
    } else {
      nextCursor = encodeBrowseCursor(last.createdAt, last.id);
    }
  }

  return c.json({ hits, nextCursor });
});

function decodeBrowseCursor(raw: string | null): { createdAt: string; id: string } | null {
  if (!raw) return null;
  try {
    const decoded = atob(raw);
    const sep = decoded.indexOf('|');
    if (sep < 0) return null;
    return { createdAt: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

function encodeBrowseCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`);
}

function decodeFtsCursor(raw: string | null): number {
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function encodeFtsCursor(offset: number): string {
  return String(offset);
}

type FlagFilter = 'any' | 'auto' | 'user' | 'none' | null;

function parseFlagFilter(raw: string | undefined): FlagFilter {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'any' || v === 'auto' || v === 'user' || v === 'none') return v;
  return null;
}

/**
 * F163.2 — translate flag-filter to a SQL WHERE clause. Curator-flag
 * is "EXISTS row in vqr with rating='down'" — we don't filter by user_id
 * on purpose, so a flag from any curator on the team counts. v2 might
 * expose ?ratedBy=me for personal-only filtering.
 */
function buildFlagClause(filter: FlagFilter): string {
  if (filter === null) return '';
  const vqrDownExists = `EXISTS (
    SELECT 1 FROM vision_quality_ratings vqr
     WHERE vqr.image_id = di.id AND vqr.rating = 'down'
  )`;
  switch (filter) {
    case 'any':
      return `AND (di.auto_flag_signal = 1 OR ${vqrDownExists})`;
    case 'auto':
      return `AND di.auto_flag_signal = 1`;
    case 'user':
      return `AND ${vqrDownExists}`;
    case 'none':
      return `AND di.auto_flag_signal = 0 AND NOT ${vqrDownExists}`;
  }
}

/**
 * F163.2 — for the visible page of hits, return the set of image-ids
 * that have at least one curator-down rating. One bulk SELECT instead
 * of a JOIN in the main query keeps the no-flag case fast.
 */
async function fetchCuratorFlaggedSet(
  trail: ReturnType<typeof getTrail>,
  imageIds: string[],
): Promise<Set<string>> {
  if (imageIds.length === 0) return new Set();
  const placeholders = imageIds.map(() => '?').join(',');
  const result = await trail.execute(
    `
    SELECT DISTINCT image_id
      FROM vision_quality_ratings
     WHERE image_id IN (${placeholders})
       AND rating = 'down'
    `,
    imageIds,
  );
  return new Set(
    (result.rows as Array<{ image_id: unknown }>).map((r) => String(r.image_id)),
  );
}

/**
 * F163.2.x — list of source-docs in this KB that have at least one
 * image-row. Used by the gallery's source-filter dropdown so we don't
 * surface text-only docs that would always return 0 hits.
 *
 * Includes per-doc image-count so the UI can render "Filename (12)"
 * if it ever wants the visibility — v1 just uses filename + title.
 */
imagesSearchRoutes.get('/knowledge-bases/:kbId/images/sources', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Not found' }, 404);

  const result = await trail.execute(
    `
    SELECT d.id AS doc_id, d.filename, d.title, d.path, d.tags,
           COUNT(di.id) AS image_count
      FROM documents d
      JOIN document_images di ON di.document_id = d.id AND di.triage = 'kept'
     WHERE d.tenant_id = ?
       AND d.knowledge_base_id = ?
       AND d.kind = 'source'
       AND d.archived = 0
     GROUP BY d.id
     ORDER BY d.filename ASC
    `,
    [tenant.id, kbId],
  );

  // Audience-filter parent doc — heuristic / internal Neuron images are
  // hidden from non-curator audiences. (Curator default for the gallery.)
  const audience: Audience =
    parseAudienceParam(c.req.query('audience')) ??
    defaultAudienceForAuth(c.get('authType'));

  const sources = (result.rows as Array<Record<string, unknown>>)
    .filter((row) =>
      isVisibleToAudience(audience, String(row.path), row.tags as string | null),
    )
    .map((row) => ({
      id: String(row.doc_id),
      filename: String(row.filename),
      title: (row.title as string | null) ?? null,
      imageCount: Number(row.image_count ?? 0),
    }));

  return c.json({ sources });
});
