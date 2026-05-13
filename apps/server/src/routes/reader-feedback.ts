/**
 * F31 — Reader Feedback → curator queue
 *
 * Endpoint that turns a 👍/👎/🚩 click on a chat answer (admin or
 * embed-widget) into a `reader-feedback` candidate in the curator's
 * queue. The candidate body bundles the original question + answer +
 * citations so the curator can see the full chat context without
 * jumping back to the session log.
 *
 * Auth: same `requireAuth` middleware as the rest of /api/v1 — accepts
 * either an admin session cookie (internal admin chat) or a Bearer
 * token (external widget). Tenant scope comes from the auth context.
 *
 * Why a dedicated route instead of asking the client to POST
 * /queue/candidates directly:
 *   - The composition (vote → title + content shape) belongs server-
 *     side so admin + widget + future integrators share one canonical
 *     reader-feedback shape, not three drift-prone variants.
 *   - Lets us version the feedback schema separately from the queue
 *     contract.
 *   - Returns the candidate id + a stable queue-url for the client to
 *     show "submitted, opened in queue" toasts.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { knowledgeBases } from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { resolveKbId } from '@trail/core';
import { createCandidate } from '@trail/core';
import { requireAuth, getTenant, getUser, getTrail } from '../middleware/auth.js';
import type { AppBindings } from '../app.js';
import type { Actor } from '@trail/core';

export const readerFeedbackRoutes = new Hono<AppBindings>();
readerFeedbackRoutes.use('*', requireAuth);

const CitationSchema = z.object({
  documentId: z.string(),
  path: z.string(),
  filename: z.string(),
});

const BodySchema = z.object({
  vote: z.enum(['up', 'down', 'flag']),
  question: z.string().min(1).max(2000),
  answer: z.string().min(1).max(50_000),
  citations: z.array(CitationSchema).optional(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  /** Free-text reason from the reader (required for `down` + `flag`). */
  reason: z.string().max(2000).optional(),
  /**
   * Optional category to help the curator sort feedback. Free-form so
   * embedders can use their own taxonomy; the admin queue UI offers
   * the canonical set as quick-click chips.
   */
  category: z
    .enum(['wrong-info', 'missing-info', 'irrelevant', 'tone', 'other'])
    .optional(),
  /** Where the feedback originated — admin chat URL or external embedder. */
  pageUrl: z.string().max(500).optional(),
});

function actorFromContext(c: Parameters<typeof getUser>[0]): Actor {
  // F95 — every candidate needs an actor for audit. Admin sessions yield
  // a user; Bearer tokens yield a synthetic "external-integration"
  // actor whose id is the api-key id (auth middleware sets userId to
  // `api:<keyId>` for Bearer-authed requests).
  const user = getUser(c);
  return { kind: 'user', id: user.id };
}

readerFeedbackRoutes.post('/knowledge-bases/:kbId/reader-feedback', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }

  const fb = parsed.data;
  // `down` and `flag` require a reason — without it the curator has
  // nothing to act on. `up` is OK with no reason (it's a vote, not
  // a complaint).
  if ((fb.vote === 'down' || fb.vote === 'flag') && !fb.reason?.trim()) {
    return c.json({ error: 'reason_required_for_negative_vote' }, 400);
  }

  // Verify KB really belongs to this tenant. resolveKbId already does
  // that for slugs, but double-check for UUIDs sent directly.
  const kb = await trail.db
    .select({ id: knowledgeBases.id, name: knowledgeBases.name })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.id, kbId), eq(knowledgeBases.tenantId, tenant.id)))
    .get();
  if (!kb) return c.json({ error: 'Knowledge base not found' }, 404);

  // Compose the candidate. Title is short + emoji-tagged so the queue
  // panel reads at a glance; content is a markdown rendering of Q+A+
  // citations + the reader's reason so the curator sees full context.
  const emoji = fb.vote === 'up' ? '👍' : fb.vote === 'down' ? '👎' : '🚩';
  const verb = fb.vote === 'up' ? 'Positive' : fb.vote === 'down' ? 'Negative' : 'Flagged';
  const shortQuestion = fb.question.length > 80 ? fb.question.slice(0, 80) + '…' : fb.question;
  const title = `${emoji} ${verb} feedback: ${shortQuestion}`;

  const sections: string[] = [];
  sections.push(`## Reader question\n\n${fb.question}`);
  sections.push(`## AI answer\n\n${fb.answer}`);
  if (fb.citations && fb.citations.length > 0) {
    const cites = fb.citations
      .map((c) => `- \`${c.filename}\` — ${c.path}`)
      .join('\n');
    sections.push(`## Citations\n\n${cites}`);
  }
  if (fb.reason?.trim()) {
    sections.push(`## Reader's feedback\n\n${fb.reason.trim()}`);
  }
  if (fb.category) {
    sections.push(`**Category**: ${fb.category}`);
  }
  if (fb.pageUrl) {
    sections.push(`**Submitted from**: ${fb.pageUrl}`);
  }
  const content = sections.join('\n\n');

  const metadata = JSON.stringify({
    connector: 'reader-feedback',
    vote: fb.vote,
    category: fb.category ?? null,
    pageUrl: fb.pageUrl ?? null,
    sessionId: fb.sessionId ?? null,
    turnId: fb.turnId ?? null,
    submittedAt: new Date().toISOString(),
    citationCount: fb.citations?.length ?? 0,
  });

  const result = await createCandidate(
    trail,
    tenant.id,
    {
      knowledgeBaseId: kbId,
      kind: 'reader-feedback',
      title,
      content,
      metadata,
      // Negative feedback gets implicit medium-low confidence so the
      // auto-approval policy doesn't auto-approve a feedback row as if
      // it were a curated Q&A pair. Positive feedback stays at default.
      confidence: fb.vote === 'up' ? null : 0.3,
    },
    actorFromContext(c),
  );

  return c.json({
    candidateId: result.candidate.id,
    status: result.candidate.status,
    queueUrl: `/kb/${kb.id}/queue#${result.candidate.id}`,
  }, 201);
});
