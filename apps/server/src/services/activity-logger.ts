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
import { broadcaster, type BroadcastEvent } from './broadcast.js';
import type { ActivityKind } from '@trail/core';

export function startActivityLogger(trail: TrailDatabase): () => void {
  return broadcaster.subscribe((event) => {
    void logFromBroadcast(trail, event).catch((err) => {
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
      await logActivity(trail, {
        tenantId: event.tenantId,
        knowledgeBaseId: event.kbId,
        actorKind: 'system',
        kind: 'kb.created',
        subjectType: 'knowledge_base',
        subjectId: event.kbId,
        summary: `Trail "${event.name}" created`,
        metadata: { slug: event.slug },
      });
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
