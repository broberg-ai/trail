/**
 * F97 — Activity Log read API.
 *
 * GET /api/v1/activity?kbId=&kind=&actorId=&subjectType=&subjectId=&since=&limit=&cursor=
 *
 * Cursor-based pagination on `created_at` (DESC). Cursor is the
 * `created_at` ISO string of the oldest row in the previous page;
 * the next call passes it as `?cursor=` to fetch the next page.
 *
 * No POST — clients never write to the log directly. Only the
 * subscriber + the 6 explicit call-sites are valid producers.
 */
import { Hono } from 'hono';
import { activityLog } from '@trail/db';
import { and, desc, eq, lt, gte } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';
import type { AppBindings } from '../app.js';

export const activityRoutes = new Hono<AppBindings>();

const ListQuery = z.object({
  kbId: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  subjectType: z
    .enum(['document', 'candidate', 'knowledge_base', 'user', 'session', 'none'])
    .optional(),
  subjectId: z.string().min(1).optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

activityRoutes.get('/activity', requireAuth, async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const parsed = ListQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    return c.json({ error: 'invalid query', details: parsed.error.flatten() }, 400);
  }
  const q = parsed.data;

  const conditions = [eq(activityLog.tenantId, tenant.id)];
  if (q.kbId) conditions.push(eq(activityLog.knowledgeBaseId, q.kbId));
  if (q.kind) conditions.push(eq(activityLog.kind, q.kind));
  if (q.actorId) conditions.push(eq(activityLog.actorId, q.actorId));
  if (q.subjectType) conditions.push(eq(activityLog.subjectType, q.subjectType));
  if (q.subjectId) conditions.push(eq(activityLog.subjectId, q.subjectId));
  if (q.since) conditions.push(gte(activityLog.createdAt, q.since));
  // Cursor = createdAt of the oldest row in the previous page. We want
  // strictly-less so we don't repeat a tied row across page boundaries.
  if (q.cursor) conditions.push(lt(activityLog.createdAt, q.cursor));

  const rows = await trail.db
    .select()
    .from(activityLog)
    .where(and(...conditions))
    .orderBy(desc(activityLog.createdAt))
    .limit(q.limit + 1)
    .all();

  // The +1 is the standard cursor-pagination probe: if we got more
  // than `limit`, there's another page; the last row's createdAt is
  // the next cursor. We trim it before returning.
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const lastRow = page.length > 0 ? page[page.length - 1] : null;
  const nextCursor = hasMore && lastRow ? lastRow.createdAt : null;

  return c.json({
    items: page.map((r) => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
    })),
    nextCursor,
  });
});
