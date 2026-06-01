/**
 * F182.4 — reinforcement-signal recorder (Memory Lifecycle Phase 1).
 *
 * Sibling to access-tracker.ts. Where the access-tracker logs raw reads into
 * `document_access`, this records lifecycle *reinforcement* events into
 * `confidence_signals` — the append-only log the F182.3 nightly decay job
 * reads to compute each Neuron's confidence. recordReinforcement NEVER mutates
 * `documents.confidence` itself; that stays the decay job's job (card
 * constraint: "no inline confidence mutation outside the decay job").
 *
 * Signal types wired in F182.4:
 *   - 'cite'      — a newly-ingested Neuron links to this one (backlink-extractor)
 *   - 'access'    — this Neuron was read (access-tracker)
 *   - 'chat-cite' — a delivered chat answer cited this Neuron (chat route)
 *   - 'curator-pin' — reserved; no pin action exists yet, so unwired for now
 *
 * ('contradiction' is also a valid confidence_signals.signal_type but is
 * emitted by the F182.5 supersession path, not here.)
 *
 * Fire-and-forget, mirroring recordAccess: void return, internal .catch().
 * Telemetry must never break a user-facing request.
 *
 * NOTE (scaling follow-up): 'access' fires once per tracked read, so a hot
 * Neuron mints many rows. The decay job only sums the last 90d and the boost
 * caps at 0.3, so confidence stays correct — but confidence_signals has no
 * pruner yet. A retention sweep (or sourcing the access dimension from the
 * F141 rollup) is a sensible later optimisation; out of scope for F182.4.
 */
import { confidenceSignals, type TrailDatabase } from '@trail/db';

export type ReinforcementSignalType = 'cite' | 'access' | 'curator-pin' | 'chat-cite';

/** Default per-type weights (plan-doc open question 6). */
export const REINFORCEMENT_WEIGHTS: Record<ReinforcementSignalType, number> = {
  cite: 0.1,
  access: 0.1,
  'curator-pin': 0.3,
  'chat-cite': 0.05,
};

export interface RecordReinforcementArgs {
  neuronId: string;
  signalType: ReinforcementSignalType;
  /** Defaults to REINFORCEMENT_WEIGHTS[signalType] when omitted. */
  weight?: number;
  /** The citing Neuron, for 'cite' / 'chat-cite' source-strength counting. */
  sourceNeuronId?: string | null;
  /** Free-form JSON (e.g. { connector, edgeType }). Stringified on write. */
  metadata?: Record<string, unknown> | null;
}

/**
 * Append a reinforcement signal. Fire-and-forget — caller does NOT await,
 * errors are logged but never thrown.
 */
export function recordReinforcement(trail: TrailDatabase, args: RecordReinforcementArgs): void {
  void (async () => {
    try {
      await trail.db
        .insert(confidenceSignals)
        .values({
          neuronId: args.neuronId,
          signalType: args.signalType,
          weight: args.weight ?? REINFORCEMENT_WEIGHTS[args.signalType],
          sourceNeuronId: args.sourceNeuronId ?? null,
          recordedAt: Date.now(),
          metadata: args.metadata ? JSON.stringify(args.metadata) : null,
        })
        .run();
    } catch (err) {
      console.warn(
        '[reinforcement] insert failed:',
        err instanceof Error ? err.message : err,
      );
    }
  })();
}
