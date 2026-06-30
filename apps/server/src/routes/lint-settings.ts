/**
 * F200.1 — Per-KB lint settings.
 *
 * GET   /api/v1/knowledge-bases/:kbId/lint-settings — current toggles.
 * PATCH /api/v1/knowledge-bases/:kbId/lint-settings — set
 *   `contradictionLintEnabled` (boolean). High-volume session KBs (e.g.
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

const PatchBodySchema = z.object({ contradictionLintEnabled: z.boolean() }).strict();

lintSettingsRoutes.get('/knowledge-bases/:kbId/lint-settings', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  const kb = await trail.db
    .select({ contradictionLintEnabled: knowledgeBases.contradictionLintEnabled })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenant.id)))
    .get();
  if (!kb) return c.json({ error: 'Knowledge base not found' }, 404);

  return c.json({ contradictionLintEnabled: kb.contradictionLintEnabled });
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
    .set({ contradictionLintEnabled: parsed.data.contradictionLintEnabled })
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenant.id)))
    .run();

  return c.json({ contradictionLintEnabled: parsed.data.contradictionLintEnabled });
});
