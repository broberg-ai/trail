/**
 * F182.5 repair — clear BACKWARDS supersessions.
 *
 * A "backwards" supersession is a Neuron marked superseded by an OLDER Neuron —
 * the exact signature of the pre-guard auto-supersession bug, where a freshly
 * saved Neuron (default 0.7 confidence) was killed by an older, established one
 * (~1.0) on a false-positive contradiction match. Superseded Neurons are hidden
 * from chat (isChatVisible), so the fresh canonical Neuron vanished.
 *
 * Audit by default; POST {"apply": true} to clear. Idempotent + safe — it only
 * NULLs the bad supersededByNeuronId; the Neurons themselves are untouched, and
 * legitimate (newer-replaces-older) supersessions are left intact. Tenant-scoped
 * (the engine DB handle is the requested tenant's).
 */
import { Hono } from 'hono';
import { documents, queueCandidates } from '@trail/db';
import { and, eq, isNotNull, inArray, like, lt, sql } from 'drizzle-orm';
import { resolveKbId } from '@trail/core';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';
import type { AppBindings } from '../app.js';

export const maintenanceRoutes = new Hono<AppBindings>();
maintenanceRoutes.use('*', requireAuth);

maintenanceRoutes.post('/maintenance/repair-backwards-supersessions', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  let apply = false;
  try {
    apply = ((await c.req.json()) as { apply?: boolean })?.apply === true;
  } catch {
    /* no body → audit only */
  }

  // Every currently-superseded Neuron in this tenant.
  const superseded = await trail.db
    .select({
      id: documents.id,
      title: documents.title,
      createdAt: documents.createdAt,
      replId: documents.supersededByNeuronId,
    })
    .from(documents)
    .where(and(eq(documents.tenantId, tenant.id), isNotNull(documents.supersededByNeuronId)))
    .all();

  // Resolve each replacement's createdAt in one query.
  const replIds = Array.from(new Set(superseded.map((s) => s.replId).filter((x): x is string => !!x)));
  const repls = replIds.length
    ? await trail.db
        .select({ id: documents.id, createdAt: documents.createdAt, title: documents.title })
        .from(documents)
        .where(and(eq(documents.tenantId, tenant.id), inArray(documents.id, replIds)))
        .all()
    : [];
  const replMap = new Map(repls.map((r) => [r.id, r]));

  // Backwards = the replacement (winner) is OLDER than the superseded Neuron.
  const backwards = superseded.filter((s) => {
    const r = s.replId ? replMap.get(s.replId) : undefined;
    return r ? r.createdAt < s.createdAt : false;
  });

  let cleared = 0;
  if (apply && backwards.length > 0) {
    await trail.db
      .update(documents)
      .set({ supersededByNeuronId: null })
      .where(
        and(
          eq(documents.tenantId, tenant.id),
          inArray(
            documents.id,
            backwards.map((b) => b.id),
          ),
        ),
      )
      .run();
    cleared = backwards.length;
    console.log(
      `[maintenance] cleared ${cleared} backwards supersession(s) for tenant ${tenant.id}: ${backwards
        .map((b) => b.id)
        .join(', ')}`,
    );
  }

  return c.json({
    tenant: tenant.id,
    supersededTotal: superseded.length,
    backwards: backwards.length,
    cleared,
    applied: apply,
    items: backwards.map((b) => ({
      id: b.id,
      title: b.title,
      createdAt: b.createdAt,
      supersededBy: b.replId,
      supersededByTitle: b.replId ? (replMap.get(b.replId)?.title ?? null) : null,
      supersededByCreatedAt: b.replId ? (replMap.get(b.replId)?.createdAt ?? null) : null,
    })),
  });
});

/**
 * F200.2 — non-LLM auto-cleanup of lint-noise candidates.
 *
 * Bulk-rejects PENDING candidates emitted by the lint detectors (connector
 * `lint` — contradiction-alert / orphan-alert / stale-alert / faded-heuristic).
 * Pure SQL, NO LLM, NO per-item reasoning. Targets `metadata.connector="lint"`
 * so it can NEVER touch knowledge candidates (external-feed / chat / buddy /
 * upload / mcp:* keep their own connectors and are left untouched).
 *
 * Safe to run on a schedule (cronjobs.webhouse.net daily). Audit by default;
 * POST {"apply": true} to actually reject. Optional `kbId` (slug or uuid)
 * scopes to one KB; optional `olderThanDays` only rejects stale backlog.
 * Tenant-scoped (the engine DB handle is the requested tenant's).
 */
maintenanceRoutes.post('/maintenance/drain-lint-candidates', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const body = (await c.req.json().catch(() => ({}))) as {
    apply?: boolean;
    kbId?: string;
    olderThanDays?: number;
  };
  const apply = body.apply === true;

  let kbId: string | null = null;
  if (body.kbId) {
    kbId = await resolveKbId(trail, tenant.id, body.kbId);
    if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);
  }

  // connector lives inside the metadata JSON blob — match it by substring,
  // the same cheap LIKE the queue's connector filter uses.
  const filters = [
    eq(queueCandidates.tenantId, tenant.id),
    eq(queueCandidates.status, 'pending'),
    like(queueCandidates.metadata, '%"connector":"lint"%'),
  ];
  if (kbId) filters.push(eq(queueCandidates.knowledgeBaseId, kbId));
  if (typeof body.olderThanDays === 'number' && body.olderThanDays > 0) {
    filters.push(lt(queueCandidates.createdAt, sql`datetime('now', ${`-${body.olderThanDays} days`})`));
  }

  const matching = await trail.db
    .select({ id: queueCandidates.id })
    .from(queueCandidates)
    .where(and(...filters))
    .all();

  let rejected = 0;
  if (apply && matching.length > 0) {
    await trail.db
      .update(queueCandidates)
      .set({
        status: 'rejected',
        rejectionReason: 'F200.2 auto-drain: lint-noise (non-LLM routine)',
        reviewedAt: sql`datetime('now')`,
      })
      .where(and(...filters))
      .run();
    rejected = matching.length;
    console.log(
      `[maintenance] F200.2 drained ${rejected} lint candidate(s) for tenant ${tenant.id}${kbId ? ` kb ${kbId}` : ''}`,
    );
  }

  return c.json({
    tenant: tenant.id,
    kbId,
    olderThanDays: body.olderThanDays ?? null,
    scanned: matching.length,
    rejected,
    applied: apply,
  });
});
