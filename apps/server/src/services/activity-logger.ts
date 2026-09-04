/**
 * F97 — Activity-log subscriber.
 *
 * Subscribes to the F87 broadcaster and translates each domain event
 * to an `activity_log` row. Covers the 7 events the broadcaster
 * already emits:
 *   - candidate_created → candidate.created
 *   - candidate_approved → candidate.approved
 *   - candidate_resolved → candidate.{approved|rejected|reopened|acknowledged}
 *     (effect picks the kind)
 *   - ingest_started → ingest.started
 *   - ingest_completed → ingest.completed
 *   - ingest_failed → ingest.failed
 *   - kb_created → kb.created
 *
 * The 6 broadcaster gaps (auth, kb.update, source.uploaded, lint
 * scheduled/completed) are filled by direct logActivity() calls at
 * the relevant routes/services per the F97 plan-doc.
 *
 * `actorId` is null for these subscribed events — the broadcaster
 * payloads don't carry actor information. Auth/upload/kb.update call-
 * sites supply actor explicitly. F87 evolution may add `createdBy`
 * to candidate-events later; logActivity is forward-compatible.
 */
import { logActivity } from '@trail/core';
import type { TrailDatabase } from '@trail/db';
import { tenants } from '@trail/db';
import { broadcaster, type BroadcastEvent } from './broadcast.js';
import type { ActivityKind } from '@trail/core';

/**
 * F240.1 — THE SUBSCRIBER IS PER-TENANT; THE BROADCASTER IS NOT.
 *
 * `startActivityLogger(db)` is called once per tenant in the pool
 * (index.ts iterates `tenantPool`), but every one of those subscribers
 * is attached to the SAME process-global broadcaster. So one tenant's
 * event was handed to all three subscribers, and each tried to insert
 * it into ITS OWN database.
 *
 * Two of those three writes were wrong, every time. They failed — but
 * only because `activity_log.tenant_id` has a foreign key into a
 * `tenants` table that holds just this tenant's own row. Measured
 * 4 September 2026: nine writes in one candidate flow, three landed,
 * six raised `FOREIGN KEY constraint failed`. Exactly one in three,
 * which is the number of tenants on the engine.
 *
 * Nothing leaked — zero foreign rows in all three production
 * databases — but a foreign key is a BACKSTOP, not a decision. It had
 * become the only thing keeping one customer's activity out of
 * another's log, and it only holds while every tenant DB happens to
 * contain exactly its own tenant row. Move a tenant between engines,
 * or clone a database, and that stops being true silently.
 *
 * So the scope is decided HERE, where a decision can be made, instead
 * of thrown four layers down. The foreign key stays exactly as it is.
 */
export function startActivityLogger(trail: TrailDatabase): () => void {
  // Resolved on the first event and cached: the activity log is on the
  // hot path (26,622 rows on broberg-ai alone), so re-reading `tenants`
  // per event would be three queries to avoid two writes.
  //
  // THE CACHE HOLDS A PROMISE, SO A REJECTION MUST CLEAR IT. `??=` will
  // not replace a settled-rejected promise (it is not null), so one
  // transient failure — a locked database, a blip of I/O — would hand
  // every later event that same rejection, and the activity log would
  // be off for the rest of the process. Actions would keep happening;
  // only the record of them would stop, behind a `drop:` line that
  // reads like noise. The audit trail must not be able to go dark
  // quietly, so the failure is made retryable instead of sticky.
  let ownTenantIds: Promise<Set<string>> | null = null;
  const resolveOwnTenantIds = (): Promise<Set<string>> => {
    ownTenantIds ??= trail.db
      .select({ id: tenants.id })
      .from(tenants)
      .all()
      .then((rows) => new Set(rows.map((r) => r.id)))
      .catch((err: unknown) => {
        ownTenantIds = null; // next event retries rather than inheriting this failure
        throw err;
      });
    return ownTenantIds;
  };

  return broadcaster.subscribe((event) => {
    void (async () => {
      // Compared on TENANT ID from this database's own `tenants` table,
      // never on the directory name: broberg-ai's id is `t-broberg-ai`,
      // but fd-aalborg's is `b4ce4f7c-fa2f-44a0-92ca-509145c2f4ce`. A
      // slug comparison would work for two tenants out of three, and a
      // guard that works for most looks right.
      //
      // FAILS CLOSED. The test is only that the field is PRESENT — an
      // empty or malformed id then falls out because it is not in the
      // set, rather than skipping the guard entirely. A scope whose job
      // is to distrust the sender must not be waved through by a value
      // the sender controls. Control frames (`hello`/`ping`) carry no
      // tenantId at all and are unaffected; logFromBroadcast already
      // returns on them.
      if ('tenantId' in event) {
        const own = await resolveOwnTenantIds();
        if (!own.has(event.tenantId)) return;
      }
      await logFromBroadcast(trail, event);
    })().catch((err) => {
      console.error('[activity-logger] drop:', err instanceof Error ? err.message : err);
    });
  });
}

async function logFromBroadcast(trail: TrailDatabase, event: BroadcastEvent): Promise<void> {
  switch (event.type) {
    case 'candidate_created':
      await logActivity(trail, {
        tenantId: event.tenantId,
        knowledgeBaseId: event.kbId,
        actorId: event.createdBy,
        actorKind: event.createdBy ? 'user' : 'system',
        kind: 'candidate.created',
        subjectType: 'candidate',
        subjectId: event.candidateId,
        summary: event.title,
        metadata: {
          candidateKind: event.kind,
          status: event.status,
          autoApproved: event.autoApproved,
          confidence: event.confidence,
        },
      });
      return;

    case 'candidate_approved':
      await logActivity(trail, {
        tenantId: event.tenantId,
        knowledgeBaseId: event.kbId,
        actorKind: event.autoApproved ? 'system' : 'user',
        kind: 'candidate.approved',
        subjectType: 'candidate',
        subjectId: event.candidateId,
        summary: `Candidate approved → document ${event.documentId.slice(0, 8)}`,
        metadata: {
          documentId: event.documentId,
          autoApproved: event.autoApproved,
        },
      });
      return;

    case 'candidate_resolved': {
      const kind = mapResolvedEffectToKind(event.effect);
      await logActivity(trail, {
        tenantId: event.tenantId,
        knowledgeBaseId: event.kbId,
        actorKind: event.autoApproved ? 'system' : 'user',
        kind,
        subjectType: 'candidate',
        subjectId: event.candidateId,
        summary: `Candidate ${kind.split('.')[1]} (effect: ${event.effect})`,
        metadata: {
          actionId: event.actionId,
          effect: event.effect,
          documentId: event.documentId,
          autoApproved: event.autoApproved,
        },
      });
      return;
    }

    case 'ingest_started':
      await logActivity(trail, {
        tenantId: event.tenantId,
        knowledgeBaseId: event.kbId,
        actorKind: 'pipeline',
        kind: 'ingest.started',
        subjectType: 'document',
        subjectId: event.docId,
        summary: `Ingest started: ${event.filename}`,
      });
      return;

    case 'ingest_completed':
      await logActivity(trail, {
        tenantId: event.tenantId,
        knowledgeBaseId: event.kbId,
        actorKind: 'pipeline',
        kind: 'ingest.completed',
        subjectType: 'document',
        subjectId: event.docId,
        summary: `Ingest completed: ${event.filename}`,
      });
      return;

    case 'ingest_failed':
      await logActivity(trail, {
        tenantId: event.tenantId,
        knowledgeBaseId: event.kbId,
        actorKind: 'pipeline',
        kind: 'ingest.failed',
        subjectType: 'document',
        subjectId: event.docId,
        summary: `Ingest failed: ${event.filename}`,
        metadata: { error: event.error },
      });
      return;

    case 'kb_created':
      // Handled by explicit logActivity() in routes/knowledge-bases.ts
      // POST handler — that path knows the actor user, this subscriber
      // only sees the broadcaster payload. Skipping here avoids a
      // dual-write where the explicit row has actor='user' and the
      // implicit one has actor='system'.
      return;

    case 'hello':
    case 'ping':
      // Control frames — not domain events.
      return;
  }
}

function mapResolvedEffectToKind(effect: string): ActivityKind {
  // F90's effect catalog projects onto the activity-log enum.
  // approve/refresh-from-source → approved (the "yes, commit" effects)
  // retire-neuron / archive / dismiss → rejected
  // mark-still-relevant / acknowledge → acknowledged
  // reopen → reopened
  if (effect === 'approve' || effect === 'refresh-from-source') return 'candidate.approved';
  if (effect === 'reopen') return 'candidate.reopened';
  if (effect === 'mark-still-relevant' || effect === 'acknowledge') return 'candidate.acknowledged';
  return 'candidate.rejected';
}
