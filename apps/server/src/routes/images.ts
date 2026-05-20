import { Hono } from 'hono';
import { documents, documentImages, visionQualityRatings } from '@trail/db';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { basename } from 'node:path';
import { resolveKbId } from '@trail/core';
import { requireAuth, getTenant, getUser, getTrail } from '../middleware/auth.js';
import { storage, imagePath } from '../lib/storage.js';
import { defaultAudienceForAuth, isVisibleToAudience } from '../services/audience.js';
import type { AppBindings } from '../app.js';

export const imageRoutes = new Hono<AppBindings>();

imageRoutes.use('*', requireAuth);

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

  const data = await storage.get(imagePath(tenant.id, doc.knowledgeBaseId, docId, filename));
  if (!data) return c.json({ error: 'Image not found' }, 404);

  const ext = filename.split('.').pop()?.toLowerCase();
  const contentType =
    ext === 'png' ? 'image/png' :
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
    ext === 'webp' ? 'image/webp' :
    ext === 'gif' ? 'image/gif' :
    'application/octet-stream';

  return new Response(data, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
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
