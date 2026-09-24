/**
 * F200.1 — Per-KB lint settings.
 *
 * GET   /api/v1/knowledge-bases/:kbId/lint-settings — current toggles.
 * PATCH /api/v1/knowledge-bases/:kbId/lint-settings — set
 *   `contradictionLintEnabled` and/or `maintenanceLintEnabled` (F200.3). High-volume session KBs (e.g.
 *   buddy-sessions) flip this OFF so contradiction-lint stops emitting
 *   contradiction-alert candidates that flood the queue — the root-cause
 *   throttle (see docs/features/F200-tame-contradiction-lint-flood.md).
 *
 * Mirrors the F159 chat-settings / F149 ingest-settings per-KB pattern.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { knowledgeBases } from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { resolveKbId } from '@trail/core';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';
import type { AppBindings } from '../app.js';

export const lintSettingsRoutes = new Hono<AppBindings>();

lintSettingsRoutes.use('*', requireAuth);

// F200.3 — `maintenanceLintEnabled` switches the stale / orphan / faded-heuristic
// detectors in the scheduled pass. Either field may be sent alone; the other is
// left as it is.
const PatchBodySchema = z
  .object({ contradictionLintEnabled: z.boolean().optional(), maintenanceLintEnabled: z.boolean().optional() })
  .strict()
  .refine((b) => b.contradictionLintEnabled !== undefined || b.maintenanceLintEnabled !== undefined, {
    message: 'at least one of contradictionLintEnabled / maintenanceLintEnabled',
  });

const settingsColumns = {
  contradictionLintEnabled: knowledgeBases.contradictionLintEnabled,
  maintenanceLintEnabled: knowledgeBases.maintenanceLintEnabled,
};

lintSettingsRoutes.get('/knowledge-bases/:kbId/lint-settings', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  const kb = await trail.db
    .select(settingsColumns)
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenant.id)))
    .get();
  if (!kb) return c.json({ error: 'Knowledge base not found' }, 404);

  return c.json(kb);
});

lintSettingsRoutes.patch('/knowledge-bases/:kbId/lint-settings', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  const parsed = PatchBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }

  await trail.db
    .update(knowledgeBases)
    .set(parsed.data)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenant.id)))
    .run();

  // Read back from the DB, so the answer is what was stored — not an echo.
  const kb = await trail.db
    .select(settingsColumns)
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenant.id)))
    .get();
  return c.json(kb);
});
