/**
 * F112 — User-note PUT endpoint.
 *
 * Bypasses the curation queue entirely. The whole point of "Din tanke"
 * is that it's the curator's own words; queue + LLM-validation would
 * be ceremony that defeats the friction the field exists to create.
 *
 * Empty/whitespace-only string clears the note (column → NULL). Max
 * 4000 chars to keep one note from blocking the documents row's
 * page-cache footprint disproportionately.
 *
 * NEVER passed to chat as context (see retrieveContext in chat.ts).
 * The privacy invariant is enforced at the read site, not here — this
 * endpoint just persists the column.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { documents } from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';
import { logActivity } from '@trail/core';
import { getUser } from '../middleware/auth.js';

export const userNoteRoutes = new Hono();

userNoteRoutes.use('*', requireAuth);

const PutBodySchema = z
  .object({
    userNote: z.string().max(4000),
  })
  .strict();

userNoteRoutes.put('/documents/:docId/user-note', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const user = getUser(c);
  const docId = c.req.param('docId');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = PutBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }

  const trimmed = parsed.data.userNote.trim();
  const value = trimmed.length === 0 ? null : parsed.data.userNote;

  const existing = await trail.db
    .select({
      id: documents.id,
      knowledgeBaseId: documents.knowledgeBaseId,
      kind: documents.kind,
    })
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.tenantId, tenant.id)))
    .get();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const nowIso = new Date().toISOString();
  await trail.db
    .update(documents)
    .set({ userNote: value, updatedAt: nowIso })
    .where(and(eq(documents.id, docId), eq(documents.tenantId, tenant.id)))
    .run();

  // F97 — record the edit to activity_log so curator can see when
  // they last reflected on a Neuron. Non-blocking; same-pattern as
  // other write-paths.
  await logActivity(trail, {
    tenantId: tenant.id,
    knowledgeBaseId: existing.knowledgeBaseId,
    actorId: user.id,
    actorKind: 'user',
    kind: 'neuron.edited',
    subjectType: 'document',
    subjectId: docId,
    summary: value === null ? 'Cleared user note' : 'Updated user note',
    metadata: {
      field: 'userNote',
      length: value === null ? 0 : value.length,
    },
  });

  return c.json({ documentId: docId, updatedAt: nowIso });
});
