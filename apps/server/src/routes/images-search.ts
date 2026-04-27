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
import { resolveKbId } from '@trail/core';
import {
  parseAudienceParam,
  defaultAudienceForAuth,
  isVisibleToAudience,
  type Audience,
} from '../services/audience.js';
import type { AppBindings } from '../app.js';

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
  const ftsQuery = query ? sanitizeFtsQuery(query) : '';
  const overFetch = limit * 3; // audience-filter eats some, hence over-fetch

  // Build args + WHERE additions for filters (docId + cursor).
  let result;
  if (ftsQuery) {
    const offset = decodeFtsCursor(cursorRaw);
    const filterClause = docIdFilter ? 'AND di.document_id = ?' : '';
    const sql = `
      SELECT di.id, di.document_id, di.filename, di.page, di.width, di.height,
             di.vision_description, di.vision_model, di.created_at,
             d.path AS doc_path, d.tags AS doc_tags
        FROM document_images_fts fts
        JOIN document_images di ON di.rowid = fts.rowid
        JOIN documents d ON d.id = di.document_id
       WHERE fts.vision_description MATCH ?
         AND di.tenant_id = ?
         AND di.knowledge_base_id = ?
         ${filterClause}
       ORDER BY rank
       LIMIT ? OFFSET ?
    `;
    const args: Array<string | number> = [ftsQuery, tenant.id, kbId];
    if (docIdFilter) args.push(docIdFilter);
    args.push(overFetch, offset);
    result = await trail.execute(sql, args);
  } else {
    const cursor = decodeBrowseCursor(cursorRaw);
    const cursorClause = cursor
      ? 'AND (di.created_at < ? OR (di.created_at = ? AND di.id < ?))'
      : '';
    const filterClause = docIdFilter ? 'AND di.document_id = ?' : '';
    const sql = `
      SELECT di.id, di.document_id, di.filename, di.page, di.width, di.height,
             di.vision_description, di.vision_model, di.created_at,
             d.path AS doc_path, d.tags AS doc_tags
        FROM document_images di
        JOIN documents d ON d.id = di.document_id
       WHERE di.tenant_id = ?
         AND di.knowledge_base_id = ?
         ${cursorClause}
         ${filterClause}
       ORDER BY di.created_at DESC, di.id DESC
       LIMIT ?
    `;
    const args: Array<string | number> = [tenant.id, kbId];
    if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    if (docIdFilter) args.push(docIdFilter);
    args.push(overFetch);
    result = await trail.execute(sql, args);
  }

  const baseUrl = new URL(c.req.url).origin;
  const visibleRows = (result.rows as Array<Record<string, unknown>>).filter((row) =>
    isVisibleToAudience(audience, String(row.doc_path), row.doc_tags as string | null),
  );
  const pageRows = visibleRows.slice(0, limit);

  const hits = pageRows.map((row) => ({
    id: String(row.id),
    documentId: String(row.document_id),
    filename: String(row.filename),
    url: `${baseUrl}/api/v1/documents/${row.document_id}/images/${String(row.filename).replace(/^\//, '')}`,
    alt: (row.vision_description as string | null) ?? '',
    page: row.page as number | null,
    width: row.width as number,
    height: row.height as number,
    visionModel: (row.vision_model as string | null) ?? null,
    createdAt: String(row.created_at),
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

/**
 * FTS5 sanitiser identical to the one in /search and /retrieve. See
 * those for rationale; pulled into a shared module would be the right
 * cleanup but is out of scope here.
 */
function sanitizeFtsQuery(raw: string): string {
  const terms = raw
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`);
  return terms.join(' OR ');
}
