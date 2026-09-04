/**
 * F97 — Activity Log helper.
 *
 * Single-call API for writing an activity row. Used by:
 *   - the activity-logger subscriber (apps/server/src/services/activity-logger.ts)
 *     which translates broadcaster events to log rows
 *   - 6 explicit call-sites that cover events the broadcaster doesn't
 *     emit (auth login/logout, kb.create/update, source.uploaded,
 *     lint.scheduled/completed)
 *
 * Fire-and-forget: caller awaits the Promise, but errors only log,
 * they never throw — an audit-write failure must never block the
 * primary action that triggered it. The catch is in here, not at
 * call-sites.
 */
import { activityLog, type TrailDatabase } from '@trail/db';
import { randomUUID } from 'node:crypto';

/**
 * Catalog of activity kinds. Keep in lockstep with the broadcaster
 * event names where they overlap (`candidate_created` →
 * `candidate.created`) so a curator who reads source code can grep
 * one to find the other. Adding a kind here = no schema change
 * (see schema.ts comment).
 */
export type ActivityKind =
  | 'auth.login'
  | 'auth.logout'
  | 'kb.created'
  | 'kb.updated'
  | 'kb.archived'
  | 'source.uploaded'
  | 'source.archived'
  | 'source.restored'
  | 'ingest.started'
  | 'ingest.completed'
  | 'ingest.failed'
  | 'ingest.retried'
  | 'candidate.created'
  | 'candidate.approved'
  | 'candidate.rejected'
  | 'candidate.reopened'
  | 'candidate.acknowledged'
  | 'neuron.edited'
  | 'neuron.archived'
  | 'neuron.restored'
  | 'neuron.superseded'
  | 'lint.scheduled'
  | 'lint.completed'
  | 'connector.recommendation_generated';

export type ActivitySubjectType =
  | 'document'
  | 'candidate'
  | 'knowledge_base'
  | 'user'
  | 'session'
  | 'none';

export type ActivityActorKind = 'user' | 'llm' | 'system' | 'pipeline';

export interface LogActivityInput {
  tenantId: string;
  knowledgeBaseId?: string | null;
  actorId?: string | null;
  actorKind: ActivityActorKind;
  kind: ActivityKind;
  subjectType: ActivitySubjectType;
  subjectId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}

export async function logActivity(
  trail: TrailDatabase,
  input: LogActivityInput,
): Promise<void> {
  try {
    await trail.db.insert(activityLog).values({
      id: `act_${randomUUID()}`,
      tenantId: input.tenantId,
      knowledgeBaseId: input.knowledgeBaseId ?? null,
      actorId: input.actorId ?? null,
      actorKind: input.actorKind,
      kind: input.kind,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      summary: input.summary,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    }).run();
  } catch (err) {
    // F239 — LOG ÅRSAGEN, ikke kun forsøget.
    //
    // Den her linje sagde før kun `err.message`, og for en drizzle-fejl ER den
    // besked hele SQL-sætningen plus parametrene. Altså: en fejlrapport der
    // fortæller hvad vi PRØVEDE og aldrig hvorfor det gik galt.
    //
    // Målt 4. september: seks «write failed» i loggen, og ikke ét ord om
    // årsagen. Diagnosen krævede fire SSH-runder til en produktionsdatabase
    // hvor hver eneste manuelle gentagelse af den samme indsættelse LYKKEDES —
    // fordi den rigtige besked lå i `err.cause`, som ingen printede.
    //
    // Tenanten står med, ellers kan en fejl ikke henføres til en kunde.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : null;
    console.error(
      `[activity-log] write failed for tenant=${input.tenantId} kind=${input.kind}:`,
      cause ?? (err instanceof Error ? err.message : err),
    );
  }
}
