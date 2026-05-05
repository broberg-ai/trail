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

const PutBodySchema = z.object({
  // 2026-05-05: bumped from required-string to nullable+optional. A
  // share-only click from the wiki-reader can race with the textarea
  // value-binding and submit `{share: true}` without userNote — that
  // shouldn't be a 400. Server treats missing/null/empty as "leave
  // the column blank or whatever it already is" via the gate below.
  userNote: z.string().max(4000).nullish(),
  // F112.1 — opt-in share-flag. Optional; when omitted the current
  // value on the row is kept (idempotent on text-only edits). When
  // provided, flips per-Neuron share state.
  share: z.boolean().optional(),
});
// .strict() removed 2026-05-05 — forward-compat for future fields the
// admin might add before the engine is redeployed (avoids the
// admin/engine version-skew "invalid_body" surprise).

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

  // Whether the client sent a userNote field at all. Distinguishes
  // "share-only flip from the checkbox" from "save the textarea".
  const noteProvided = 'userNote' in parsed.data && parsed.data.userNote !== undefined;
  const value = noteProvided
    ? (parsed.data.userNote!.trim().length === 0 ? null : parsed.data.userNote!)
    : undefined;

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
  // Build the .set() payload with typed columns so Drizzle's
  // column-aware coercion runs (boolean → integer 0/1 for the SQLite
  // column declared with mode:'boolean'). 2026-05-05: a
  // `Record<string, unknown>` shape lost the coercion and the
  // share-flag silently never landed even though the row's updated_at
  // advanced. Explicit typed-set objects fix it.
  if (noteProvided && parsed.data.share !== undefined) {
    await trail.db
      .update(documents)
      .set({ userNote: value ?? null, userNoteShare: parsed.data.share, updatedAt: nowIso })
      .where(and(eq(documents.id, docId), eq(documents.tenantId, tenant.id)))
      .run();
  } else if (noteProvided) {
    await trail.db
      .update(documents)
      .set({ userNote: value ?? null, updatedAt: nowIso })
      .where(and(eq(documents.id, docId), eq(documents.tenantId, tenant.id)))
      .run();
  } else if (parsed.data.share !== undefined) {
    // Share-only flip — leave userNote untouched.
    await trail.db
      .update(documents)
      .set({ userNoteShare: parsed.data.share, updatedAt: nowIso })
      .where(and(eq(documents.id, docId), eq(documents.tenantId, tenant.id)))
      .run();
  } else {
    return c.json({ error: 'no_fields_to_update' }, 400);
  }

  // F97 — record the edit to activity_log so curator can see when
  // they last reflected on a Neuron. Non-blocking; same-pattern as
  // other write-paths. Summary distinguishes share-only flips from
  // text edits so the activity timeline is readable.
  const summary = !noteProvided
    ? parsed.data.share
      ? 'Shared user note with chat + integrations'
      : 'Made user note private again'
    : value === null
      ? 'Cleared user note'
      : 'Updated user note';
  await logActivity(trail, {
    tenantId: tenant.id,
    knowledgeBaseId: existing.knowledgeBaseId,
    actorId: user.id,
    actorKind: 'user',
    kind: 'neuron.edited',
    subjectType: 'document',
    subjectId: docId,
    summary,
    metadata: {
      field: noteProvided ? 'userNote' : 'userNoteShare',
      length: value === null || value === undefined ? 0 : value.length,
    },
  });

  return c.json({ documentId: docId, updatedAt: nowIso });
});
