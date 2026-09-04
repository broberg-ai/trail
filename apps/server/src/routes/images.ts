import { Hono } from 'hono';
import { documents, documentImages, visionQualityRatings } from '@trail/db';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { basename } from 'node:path';
import { resolveKbId } from '@trail/core';
import { requireAuth, getTenant, getUser, getTrail } from '../middleware/auth.js';
import { storage, imagePath, sourcePath } from '../lib/storage.js';
import { ensureDisplayThumb } from '../services/vision-derivative.js';

/** F241.1 — one place that maps a filename to a content type. It was written
 *  inline at the serve site; the thumb branch needs the same answer, and two
 *  copies of a mapping is how they drift. */
function contentTypeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext === 'png' ? 'image/png'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : 'application/octet-stream';
}
import { defaultAudienceForAuth, isVisibleToAudience } from '../services/audience.js';
import type { AppBindings } from '../app.js';

export const imageRoutes = new Hono<AppBindings>();

imageRoutes.use('*', requireAuth);

/**
 * F232.2 — a stored path is only usable if it stays inside this tenant.
 *
 * `storage_path` is a column, and a column is data. Trusting it verbatim would
 * turn any write that reaches that column into a read of any file the process
 * can see. So the row decides WHERE INSIDE THE TENANT the bytes are, never
 * whether they are inside it.
 *
 * Returns the computed path when the stored one is absent, empty, escaping, or
 * outside the tenant prefix — never an error, because a bad column value must
 * degrade to the old behaviour rather than break a working image.
 */
export function safeStoragePath(
  stored: string | null | undefined,
  tenantId: string,
  computed: string,
): string {
  if (!stored) return computed;
  const p = stored.replace(/\/{2,}/g, '/').replace(/^\/+/, '');
  if (p.includes('..')) return computed;
  if (!p.startsWith(`${tenantId}/`)) return computed;
  return p;
}

imageRoutes.get('/documents/:docId/images/:filename', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const docId = c.req.param('docId');
  const filename = basename(c.req.param('filename'));

  if (!/^[\w.-]+$/.test(filename) || filename.includes('..')) {
    return c.json({ error: 'Invalid filename' }, 400);
  }

  const doc = await trail.db
    .select({
      id: documents.id,
      knowledgeBaseId: documents.knowledgeBaseId,
      path: documents.path,
      tags: documents.tags,
    })
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.tenantId, tenant.id)))
    .get();
  if (!doc) return c.json({ error: 'Not found' }, 404);

  // F161 — audience-aware visibility check. Bearer-keys default to
  // `tool` audience; heuristic + internal-tagged Neuron's images
  // become 404 instead of 200, preventing URL-guess bypass of the
  // F160 audience-filter on /search and /retrieve.
  const audience = defaultAudienceForAuth(c.get('authType'));
  if (!isVisibleToAudience(audience, doc.path, doc.tags)) {
    return c.json({ error: 'Not found' }, 404);
  }

  // F241.1 — `?variant=thumb` serves a display thumbnail for EVERY image.
  //
  // It used to hand back the VISION derivative, and only when
  // `needsDerivative` said yes — i.e. above 3 MB or 4 MP, which is the
  // model's limit, not a screen's. Below that it fell through and served
  // the full original, with a 200 and the right content-type, so nothing
  // looked wrong anywhere. Measured on Sanne's Trail: 0 of 1385 images had
  // a derivative, one screenful of the image list pulled 24.4 MB, and the
  // Sources request queued behind those fetches for minutes.
  //
  // Now the size question is answered for the display, and the vision
  // derivative is left alone to answer the model's.
  if (c.req.query('variant') === 'thumb') {
    const img = await trail.db
      .select({ storagePath: documentImages.storagePath })
      .from(documentImages)
      .where(
        and(
          eq(documentImages.documentId, docId),
          eq(documentImages.filename, filename),
          eq(documentImages.tenantId, tenant.id),
        ),
      )
      .get();
    // F232.2 — prefer the path ON THE ROW; recomputing it is what produced
    // F230's 212 unreachable images. Fall back only when there is no row.
    const source =
      img?.storagePath ?? imagePath(tenant.id, doc.knowledgeBaseId, docId, filename);
    try {
      const thumb = await ensureDisplayThumb(source);
      return new Response(thumb.bytes, {
        headers: {
          // Not always webp: an image that is already smaller than its own
          // thumbnail is served as-is, and saying "webp" then would be a lie
          // the browser acts on.
          'Content-Type': thumb.isThumb ? 'image/webp' : contentTypeFor(filename),
          'Cache-Control': 'private, max-age=86400',
        },
      });
    } catch (err) {
      // A thumbnail that cannot be produced (unreadable bytes, a format
      // sharp refuses) must not turn a working image into an error — fall
      // through and serve the original below.
      console.error(
        `[images] thumb failed for ${source}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // F232.2 — READ THE PATH OFF THE ROW, do not recompute it.
  //
  // This used to derive the path from tenant/kb/doc/filename and ignore
  // `storage_path` entirely — two sources for one value, which is the exact
  // shape that produced F230's 212 unreachable images. It also makes it
  // impossible for the bytes to live anywhere but the computed place, so an
  // image waiting in the pending store could never be served after promotion.
  //
  // The fallback is deliberate: a row with no storage_path (or none at all,
  // e.g. a legacy file on disk with no row) still resolves the old way. A
  // missing row must not turn a working image into a 404.
  const stored = await trail.db
    .select({ storagePath: documentImages.storagePath })
    .from(documentImages)
    .where(
      and(
        eq(documentImages.documentId, docId),
        eq(documentImages.filename, filename),
        eq(documentImages.tenantId, tenant.id),
      ),
    )
    .get();
  const computed = imagePath(tenant.id, doc.knowledgeBaseId, docId, filename);
  const resolved = safeStoragePath(stored?.storagePath, tenant.id, computed);

  const data = await storage.get(resolved);
  if (!data) return c.json({ error: 'Image not found' }, 404);

  return new Response(data, {
    headers: {
      'Content-Type': contentTypeFor(filename),
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// ── F191.7 — local vision ($0 cc session does image description) ──────────────

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
};

/**
 * F191.7 — raw SOURCE file bytes. The /local-ingest skill fetches this for a
 * standalone image source, views it (Read tool), and writes the description
 * back via PUT /documents/:docId/content. Tenant-scoped (the caller is draining
 * its own parked source).
 */
imageRoutes.get('/documents/:docId/raw', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const docId = c.req.param('docId');
  const doc = await trail.db
    .select({ id: documents.id, knowledgeBaseId: documents.knowledgeBaseId, fileType: documents.fileType })
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.tenantId, tenant.id)))
    .get();
  if (!doc) return c.json({ error: 'Not found' }, 404);

  const ext = (doc.fileType ?? '').toLowerCase();
  const data = await storage.get(sourcePath(tenant.id, doc.knowledgeBaseId, docId, ext));
  if (!data) return c.json({ error: 'Source file not found' }, 404);

  return new Response(data, {
    headers: {
      'Content-Type': IMAGE_CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

/**
 * F191.7 — list a document's embedded images. `?pending=1` filters to those
 * still needing a description (vision_description IS NULL), i.e. the work the
 * /local-ingest skill must do for this source ($0, in-session).
 */
imageRoutes.get('/documents/:docId/images', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const docId = c.req.param('docId');
  const pendingOnly = c.req.query('pending') === '1' || c.req.query('pending') === 'true';

  const conds = [eq(documentImages.documentId, docId), eq(documentImages.tenantId, tenant.id)];
  if (pendingOnly) conds.push(sql`${documentImages.visionDescription} IS NULL`);

  const rows = await trail.db
    .select({
      id: documentImages.id,
      filename: documentImages.filename,
      page: documentImages.page,
      width: documentImages.width,
      height: documentImages.height,
      hasDescription: sql<number>`(${documentImages.visionDescription} IS NOT NULL)`,
    })
    .from(documentImages)
    .where(and(...conds))
    .all();

  return c.json({ images: rows.map((r) => ({ ...r, hasDescription: !!r.hasDescription })) });
});

/**
 * F191.7 — write a cc-produced image description ($0). Mirrors the exact write
 * the paid vision-rerun handler does, but stamps vision_model='claude-code' and
 * cost 0. Keyed by (docId, filename) — the same handle the bytes endpoint uses.
 */
imageRoutes.post('/documents/:docId/images/:filename/local-vision', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const docId = c.req.param('docId');
  const filename = basename(c.req.param('filename'));
  const body = (await c.req.json().catch(() => ({}))) as { description?: string };
  const description = body.description?.trim();
  if (!description) return c.json({ error: 'description is required' }, 400);

  const img = await trail.db
    .select({ id: documentImages.id })
    .from(documentImages)
    .where(
      and(
        eq(documentImages.documentId, docId),
        eq(documentImages.filename, filename),
        eq(documentImages.tenantId, tenant.id),
      ),
    )
    .get();
  if (!img) return c.json({ error: 'Image not found' }, 404);

  await trail.db
    .update(documentImages)
    .set({
      visionDescription: description,
      visionModel: 'claude-code',
      visionAt: new Date().toISOString(),
      visionCostCents: 0,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(documentImages.id, img.id))
    .run();

  return c.json({ id: img.id, filename, visionModel: 'claude-code', costCents: 0 }, 200);
});

/**
 * F164 Phase 5 — vision quality rating (👍 / 👎).
 *
 * POST /documents/:docId/images/:filename/rating
 *   body: { rating: 'up' | 'down' | null }
 *
 * Upsert on (user_id, image_id). null = delete the user's existing
 * vote (curator un-rates after second look).
 *
 * Tenant-scoped: image must belong to a doc in the calling tenant.
 * Cross-tenant probe returns 404 (same shape as missing).
 *
 * v1 = collect-only. v2 will use 👎-rated images as input for prompt-
 * tuning loops; nothing acts on the data automatically yet.
 */
imageRoutes.post('/documents/:docId/images/:filename/rating', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const user = getUser(c);
  const docId = c.req.param('docId');
  const filename = basename(c.req.param('filename'));

  if (!/^[\w.-]+$/.test(filename) || filename.includes('..')) {
    return c.json({ error: 'Invalid filename' }, 400);
  }

  const body = (await c.req.json().catch(() => null)) as { rating?: unknown } | null;
  const rating = body?.rating;
  if (rating !== 'up' && rating !== 'down' && rating !== null) {
    return c.json({ error: 'rating must be "up", "down", or null' }, 400);
  }

  // Lookup image scoped to tenant via parent doc. Filename comparison
  // is leading-slash-tolerant: F161 backfill stamped some rows with
  // "/page-1-img-1.png" while uploads write "page-1-img-1.png" — match
  // the route param against either form.
  const slashed = `/${filename}`;
  const row = await trail.db
    .select({
      id: documentImages.id,
      visionModel: documentImages.visionModel,
    })
    .from(documentImages)
    .innerJoin(documents, eq(documents.id, documentImages.documentId))
    .where(
      and(
        eq(documentImages.documentId, docId),
        sql`(${documentImages.filename} = ${filename} OR ${documentImages.filename} = ${slashed})`,
        eq(documents.tenantId, tenant.id),
      ),
    )
    .get();

  if (!row) return c.json({ error: 'Not found' }, 404);

  if (rating === null) {
    await trail.db
      .delete(visionQualityRatings)
      .where(
        and(
          eq(visionQualityRatings.imageId, row.id),
          eq(visionQualityRatings.userId, user.id),
        ),
      )
      .run();
    return c.json({ ok: true, rating: null });
  }

  // UPSERT — flip an existing vote or create a fresh one. SQLite's
  // ON CONFLICT(...) is keyed by the unique index on (user_id, image_id).
  const id = `vqr_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  await trail.execute(
    `
    INSERT INTO vision_quality_ratings (id, image_id, user_id, tenant_id, rating, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, image_id) DO UPDATE SET
      rating = excluded.rating,
      model = excluded.model,
      updated_at = excluded.updated_at
    `,
    [id, row.id, user.id, tenant.id, rating, row.visionModel ?? null, now, now],
  );

  // F163.2 — curator override: 'up' rating clears any auto-flag-signal
  // ("I've seen this and it's good enough"). 'down' leaves auto-signal
  // alone (orthogonal stack — both signals can co-exist).
  if (rating === 'up') {
    await trail.db
      .update(documentImages)
      .set({ autoFlagSignal: 0, autoFlagReason: null })
      .where(eq(documentImages.id, row.id))
      .run();
  }

  return c.json({ ok: true, rating });
});

/**
 * GET /documents/:docId/images/:filename/rating — fetch the calling
 * user's existing rating (if any) so the modal can pre-fill the
 * up/down state when the curator reopens an old completion view.
 */
imageRoutes.get('/documents/:docId/images/:filename/rating', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const user = getUser(c);
  const docId = c.req.param('docId');
  const filename = basename(c.req.param('filename'));

  if (!/^[\w.-]+$/.test(filename) || filename.includes('..')) {
    return c.json({ error: 'Invalid filename' }, 400);
  }

  const slashed = `/${filename}`;
  const row = await trail.db
    .select({
      rating: visionQualityRatings.rating,
    })
    .from(visionQualityRatings)
    .innerJoin(documentImages, eq(documentImages.id, visionQualityRatings.imageId))
    .innerJoin(documents, eq(documents.id, documentImages.documentId))
    .where(
      and(
        eq(documentImages.documentId, docId),
        sql`(${documentImages.filename} = ${filename} OR ${documentImages.filename} = ${slashed})`,
        eq(documents.tenantId, tenant.id),
        eq(visionQualityRatings.userId, user.id),
      ),
    )
    .get();

  return c.json({ rating: row?.rating ?? null });
});

// ── F163.1 — bulk endpoints (multi-select on Image Gallery) ─────────────

/**
 * Hard-delete a batch of images. DROPs document_images rows + best-effort
 * purges storage blobs. Cascades:
 *   - vision_quality_ratings rows (FK ON DELETE CASCADE)
 *   - document_images_fts rows (DELETE trigger from migration 0025)
 *
 * Tenant-scope: a probe with image-ids from another tenant returns 0
 * deleted; we never DELETE rows we couldn't first SELECT scoped.
 *
 * Permission: gated on user.role — owner + curator can bulk-delete,
 * reader cannot. Previously this gated on auth-type (session-only)
 * which broke in prod when admin-server proxies requests as Bearer
 * to the engine — operator clicks "Slet permanent" in the admin UI,
 * proxy strips cookie + injects tenant Bearer, engine sees
 * authType='bearer' and 403'd legitimate operator actions.
 *
 * Storage purge is best-effort: if the blob is missing or unlink fails,
 * we log and surface in storageWarnings but the DB delete still
 * commits. Orphan blobs can be GC'd later by a sweep.
 */
imageRoutes.post('/knowledge-bases/:kbId/images/bulk-delete', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const user = getUser(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Not found' }, 404);

  // Permission guard — readers can't delete. Anyone with a write-tier
  // role (owner, curator, admin) can. Deny-list rather than whitelist
  // because the schema accepts roles outside the TS type union
  // ("admin" exists in the DB for cb@webhouse.dk's user-row); a
  // strict whitelist would lock out a legitimate operator.
  if (user.role === 'reader') {
    return c.json({ error: 'Bulk-delete requires write-tier role' }, 403);
  }

  const body = (await c.req.json().catch(() => null)) as { imageIds?: unknown } | null;
  const imageIds = Array.isArray(body?.imageIds) ? body!.imageIds.filter((x): x is string => typeof x === 'string') : [];
  if (imageIds.length === 0) return c.json({ error: 'imageIds[] required' }, 400);

  // Hard cap to keep one query under SQLite's parameter limit and
  // bound the latency. Larger batches chunk client-side.
  if (imageIds.length > 500) {
    return c.json({ error: 'Max 500 images per request' }, 400);
  }

  // Scoped SELECT first — fail-closed on cross-tenant.
  const scoped = await trail.db
    .select({
      id: documentImages.id,
      storagePath: documentImages.storagePath,
    })
    .from(documentImages)
    .innerJoin(documents, eq(documents.id, documentImages.documentId))
    .where(
      and(
        inArray(documentImages.id, imageIds),
        eq(documents.tenantId, tenant.id),
        eq(documentImages.knowledgeBaseId, kbId),
      ),
    )
    .all();

  if (scoped.length === 0) {
    return c.json({ deleted: 0, storageWarnings: [] });
  }

  const scopedIds = scoped.map((r) => r.id);
  const storagePaths = scoped.map((r) => r.storagePath);

  // DELETE — cascades fire automatically.
  await trail.db
    .delete(documentImages)
    .where(inArray(documentImages.id, scopedIds))
    .run();

  // Best-effort blob purge.
  const storageWarnings: string[] = [];
  for (const path of storagePaths) {
    try {
      await storage.delete(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[bulk-delete] storage.delete failed for ${path}: ${msg}`);
      storageWarnings.push(`${path}: ${msg}`);
    }
  }

  return c.json({ deleted: scopedIds.length, storageWarnings });
});

/**
 * Bulk-rate a set of images with the same rating (typically 'down'
 * for "flag these as low quality"). Reuses F164 Phase 5 schema —
 * UPSERTs into vision_quality_ratings keyed by (user_id, image_id).
 *
 * Tenant-scope: same JOIN-then-loop pattern as bulk-delete. rating=null
 * deletes existing ratings.
 *
 * Curator + Bearer both allowed; rating is information-only and
 * already curator-scoped via user_id (a Bearer-key has its own user
 * stamped at auth time).
 */
imageRoutes.post('/knowledge-bases/:kbId/images/bulk-rate', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const user = getUser(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Not found' }, 404);

  const body = (await c.req.json().catch(() => null)) as
    | { imageIds?: unknown; rating?: unknown }
    | null;
  const imageIds = Array.isArray(body?.imageIds) ? body!.imageIds.filter((x): x is string => typeof x === 'string') : [];
  const rating = body?.rating;
  if (imageIds.length === 0) return c.json({ error: 'imageIds[] required' }, 400);
  if (rating !== 'up' && rating !== 'down' && rating !== null) {
    return c.json({ error: 'rating must be "up", "down", or null' }, 400);
  }
  if (imageIds.length > 500) {
    return c.json({ error: 'Max 500 images per request' }, 400);
  }

  // Scoped SELECT — also pulls vision_model so we can stamp it on the rating row.
  const scoped = await trail.db
    .select({
      id: documentImages.id,
      visionModel: documentImages.visionModel,
    })
    .from(documentImages)
    .innerJoin(documents, eq(documents.id, documentImages.documentId))
    .where(
      and(
        inArray(documentImages.id, imageIds),
        eq(documents.tenantId, tenant.id),
        eq(documentImages.knowledgeBaseId, kbId),
      ),
    )
    .all();

  if (scoped.length === 0) {
    return c.json({ rated: 0 });
  }

  if (rating === null) {
    await trail.db
      .delete(visionQualityRatings)
      .where(
        and(
          inArray(visionQualityRatings.imageId, scoped.map((r) => r.id)),
          eq(visionQualityRatings.userId, user.id),
        ),
      )
      .run();
    return c.json({ rated: scoped.length });
  }

  // UPSERT each row — single batched VALUES with ON CONFLICT keyed by
  // the (user_id, image_id) unique index (F164 Phase 5).
  const now = new Date().toISOString();
  for (const row of scoped) {
    const id = `vqr_${crypto.randomUUID().slice(0, 12)}`;
    await trail.execute(
      `
      INSERT INTO vision_quality_ratings (id, image_id, user_id, tenant_id, rating, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, image_id) DO UPDATE SET
        rating = excluded.rating,
        model = excluded.model,
        updated_at = excluded.updated_at
      `,
      [id, row.id, user.id, tenant.id, rating, row.visionModel ?? null, now, now],
    );
  }

  return c.json({ rated: scoped.length });
});
