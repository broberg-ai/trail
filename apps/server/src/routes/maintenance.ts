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
import { documents, queueCandidates, knowledgeBases } from '@trail/db';
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
 * POST {"apply": true} to actually reject. `scanned` and `rejected` mean the
 * same thing in both modes — how many match, and how many would be / were
 * rejected — so the audit run is a real preview of the apply run (F212.4).
 * Optional `kbId` (slug or uuid) scopes to one KB; optional `olderThanDays`
 * only rejects stale backlog.
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

  // Scope rule (SAFETY): an explicit kbId drains that one KB's lint backlog
  // (operator chose it). WITHOUT a kbId (the daily-cron path), restrict to KBs
  // where contradiction-lint is DISABLED — never auto-reject legitimate
  // contradiction findings in a curated, lint-ON KB (e.g. a customer's).
  let kbId: string | null = null;
  let disabledKbScope: string[] | null = null;
  if (body.kbId) {
    kbId = await resolveKbId(trail, tenant.id, body.kbId);
    if (!kbId) return c.json({ error: 'Knowledge base not found' }, 404);
  } else {
    const disabled = await trail.db
      .select({ id: knowledgeBases.id })
      .from(knowledgeBases)
      .where(and(eq(knowledgeBases.tenantId, tenant.id), eq(knowledgeBases.contradictionLintEnabled, false)))
      .all();
    disabledKbScope = disabled.map((r) => r.id);
    if (disabledKbScope.length === 0) {
      return c.json({
        tenant: tenant.id, kbId: null, scope: 'lint-disabled-kbs', disabledKbs: 0,
        olderThanDays: body.olderThanDays ?? null, scanned: 0, rejected: 0, applied: apply,
      });
    }
  }

  // connector lives inside the metadata JSON blob — match it by substring,
  // the same cheap LIKE the queue's connector filter uses.
  const filters = [
    eq(queueCandidates.tenantId, tenant.id),
    eq(queueCandidates.status, 'pending'),
    like(queueCandidates.metadata, '%"connector":"lint"%'),
  ];
  if (kbId) filters.push(eq(queueCandidates.knowledgeBaseId, kbId));
  else if (disabledKbScope) filters.push(inArray(queueCandidates.knowledgeBaseId, disabledKbScope));
  if (typeof body.olderThanDays === 'number' && body.olderThanDays > 0) {
    filters.push(lt(queueCandidates.createdAt, sql`datetime('now', ${`-${body.olderThanDays} days`})`));
  }

  const matching = await trail.db
    .select({ id: queueCandidates.id })
    .from(queueCandidates)
    .where(and(...filters))
    .all();

  // F212.4 — `rejected` reports the SAME number in both modes: with apply=false
  // it is how many WOULD be rejected, with apply=true how many were. It used to
  // be hard-zero unless applying, and that made the preview unreadable: a reader
  // takes `rejected` as "how many are going", so "nothing matched" and "I am not
  // allowed to tell you" arrived as the identical answer. Measured 2026-08-29 on
  // a fixture with three matching candidates — the dry run still said 0.
  //
  // `scanned` was never gated (matching is computed above, before this branch),
  // which is worth stating because the card that produced this fix claimed it
  // was: two production runs both answered {scanned: 0, rejected: 0} and I read
  // a blind instrument into what was simply an empty queue. The fixture is what
  // told the two apart, and it is why the check below exists rather than a
  // second reading of prod.
  const rejected = matching.length;
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
    console.log(
      `[maintenance] F200.2 drained ${rejected} lint candidate(s) for tenant ${tenant.id}${kbId ? ` kb ${kbId}` : ''}`,
    );
  }

  return c.json({
    tenant: tenant.id,
    kbId,
    scope: kbId ? 'single-kb' : 'lint-disabled-kbs',
    disabledKbs: disabledKbScope ? disabledKbScope.length : undefined,
    olderThanDays: body.olderThanDays ?? null,
    scanned: matching.length,
    rejected,
    applied: apply,
  });
});
