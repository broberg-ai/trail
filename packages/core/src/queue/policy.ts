import type { QueueCandidate, QueueCandidateKind } from '@trail/shared';
import { AMBIENT_CONNECTOR } from '@trail/shared';

/**
 * F19 — Auto-approval policy.
 *
 * The Curation Queue (F17) is the sole write path into the wiki. Every
 * candidate goes through it; auto-approval is a queue *policy*, not a
 * parallel path. A candidate enters pending, `shouldAutoApprove` evaluates
 * it, and if it passes, the approval handler fires immediately — same code
 * path a human click would take, same audit trail.
 *
 * Three axes, strictest bypass first:
 *
 *   Axis 1 — Trusted pipeline (kind + non-human actor)          [live]
 *   Axis 2 — Confidence ≥ threshold for anything else           [live]
 *   Axis 3 — No contradictions against existing claims          [live, reactive]
 *
 * Axis 3 is implemented as a *post-approval* subscriber rather than a
 * blocking pre-approval check:
 *
 *   - Pre-approval would add 1-3s LLM latency to every auto-approve path.
 *     Human curators wouldn't notice; bulk buddy F39 ingest would.
 *   - Post-approval emission (`contradiction-alert` candidates) matches
 *     the spec's "no-contradictions" semantic because the alert lands in
 *     the queue pending human adjudication. The Neuron is live, but the
 *     dispute is live too — and the curator, not the policy, picks which
 *     side is right.
 *
 * The contradiction subscriber lives at
 * `apps/server/src/services/contradiction-lint.ts` and listens on the F87
 * broadcaster for `candidate_approved` events.
 *
 * A human-originated candidate (createdBy set) NEVER auto-approves. That's
 * by design — people click "submit"; machines emit confidences. Mixing the
 * two corrupts the audit trail.
 */

/** Pipelines whose own writes we trust unconditionally. */
const TRUSTED_KINDS: QueueCandidateKind[] = [
  'ingest-summary',
  'ingest-page-update',
  'source-retraction',
  'scheduled-recompile',
];

const DEFAULT_THRESHOLD = 0.8;

/** F201.8 — per-KB auto-approval config passed in at the call site. */
export interface AutoApproveKbPolicy {
  /** null/undefined = OFF (ship-dark). A number in [0,1] arms ambient auto-approve. */
  autoApproveThreshold?: number | null;
}

/** Read the F182.5 `autoSupersede` flag out of a candidate's metadata JSON. */
function autoSupersedeFlag(candidate: QueueCandidate): boolean {
  if (!candidate.metadata) return false;
  try {
    const m = JSON.parse(candidate.metadata) as { autoSupersede?: boolean };
    return m?.autoSupersede === true;
  } catch {
    return false;
  }
}

/** F201.8 — is this an ambient-capture candidate? (metadata.connector) */
function isAmbientCandidate(candidate: QueueCandidate): boolean {
  if (!candidate.metadata) return false;
  try {
    return (JSON.parse(candidate.metadata) as { connector?: string }).connector === AMBIENT_CONNECTOR;
  } catch {
    return false;
  }
}

function threshold(): number {
  const raw = process.env.TRAIL_AUTO_APPROVE_THRESHOLD;
  if (!raw) return DEFAULT_THRESHOLD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_THRESHOLD;
  return n;
}

export function shouldAutoApprove(candidate: QueueCandidate, kb?: AutoApproveKbPolicy): boolean {
  // F201.8 — per-KB ambient auto-approval, evaluated FIRST because it's the
  // only path that bypasses the createdBy block below. An ambient capture is a
  // MACHINE capture (the agent + F201.11 distill decided what's knowledge), so
  // the "humans never auto-approve" rule — which guards a curator's own
  // submit-click — does not apply. When the KB opts in (threshold set), an
  // ambient candidate at/above the threshold auto-approves unattended;
  // distilled knowledge (conf 0.8) becomes a Neuron, noise (conf 0) stays
  // pending. When the threshold is null (default), this is skipped entirely —
  // ship-dark, ambient falls through to the createdBy block and stays pending.
  const kbThreshold = kb?.autoApproveThreshold ?? null;
  if (kbThreshold !== null && isAmbientCandidate(candidate)) {
    return candidate.confidence != null && candidate.confidence >= kbThreshold;
  }

  // Humans never auto-approve. If a curator wants a page in, they click it.
  if (candidate.createdBy) return false;

  // F182.5 — a supersede candidate is high-impact (it retires an existing
  // claim), so it auto-approves ONLY when the supersession formula already
  // decided both conditions hold (|Δconfidence| > 0.25 AND newer source-count
  // ≥ older), recorded as metadata.autoSupersede. Otherwise it's a
  // pending-supersession the curator must adjudicate. Not added to
  // TRUSTED_KINDS — we never blanket-trust a destructive effect.
  if (candidate.kind === 'supersede') {
    return autoSupersedeFlag(candidate) === true;
  }

  // Axis 1: trusted pipelines skip the threshold entirely.
  if (TRUSTED_KINDS.includes(candidate.kind)) return true;

  // Axis 2: confidence threshold for everything else. A candidate without a
  // confidence score is treated as "below threshold" — we'd rather queue it
  // for review than silently commit something the source didn't vouch for.
  if (candidate.confidence === null || candidate.confidence === undefined) return false;
  return candidate.confidence >= threshold();

  // Axis 3 (no contradictions) lives in F32. Once the lint emits a signal
  // on candidate creation (either a field or a blocking event), this
  // function will AND that signal in above the return.
}
