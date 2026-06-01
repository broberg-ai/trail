/**
 * F182.2 — Memory Lifecycle confidence formula.
 *
 * Pure, dependency-injected scoring: no DB access, no clock read inside.
 * The F182.3 decay job loads a Neuron's signals + contradiction count and
 * calls computeConfidence; the result is clamped to [0, 1].
 *
 *   confidence = recency × sourceStrength × (1 − contradictionFactor) + reinforcementBoost
 *
 *   recency           = exp(−ageDays / τ)         τ per Neuron type (Ebbinghaus, F139)
 *   sourceStrength    = log2(1 + n) / log2(11)    n = distinct citing sources (floored at 1)
 *   contradictionFactor = min(0.9, 0.3 × count)
 *   reinforcementBoost  = Σ weightᵢ·exp(−sigAgeDays/30) over the last 90d, capped at 0.3
 *
 * This is the documented STARTING formula (F182 plan-doc) — τ values and the
 * boost cap are tunables, kept in one place, to be calibrated against a
 * ground-truth query set (Sanne's KB) before they're treated as final.
 */
import type { NeuronType } from '@trail/shared';

export type ConfidenceSignalType = 'cite' | 'access' | 'curator-pin' | 'chat-cite' | 'contradiction';

export interface ConfidenceSignalInput {
  signalType: ConfidenceSignalType;
  weight: number;
  /** The source/citing Neuron, when the signal is a citation. */
  sourceNeuronId?: string | null;
  /** Epoch ms. */
  recordedAt: number;
}

export interface ComputeConfidenceInput {
  type: NeuronType;
  /** Epoch ms the Neuron was created. */
  createdAt: number;
  signals: ConfidenceSignalInput[];
  contradictionCount: number;
  /** Per-type τ in days; merged over DEFAULT_DECAY_RATES. Sourced from tenants.settings_json. */
  decayRates?: Partial<Record<NeuronType, number>>;
  /** Epoch ms — injected so the function stays pure/testable. */
  now: number;
}

/** Per-Neuron-type retention τ (days). Slower-decaying knowledge → larger τ. */
export const DEFAULT_DECAY_RATES: Record<NeuronType, number> = {
  concept: 365,
  glossary: 365,
  comparison: 365,
  heuristic: 365,
  entity: 180,
  source: 180,
  note: 180,
  synthesis: 90,
  query: 90,
  session: 30,
};

const DAY_MS = 24 * 3600 * 1000;
const REINFORCEMENT_WINDOW_DAYS = 90;
const REINFORCEMENT_RECENCY_TAU_DAYS = 30; // a read last week counts more than one 3 months ago
const MAX_REINFORCEMENT_BOOST = 0.3;

/** Distinct sources backing this Neuron, inferred from citation signals. */
export function countDistinctSources(signals: ConfidenceSignalInput[]): number {
  const ids = new Set<string>();
  for (const s of signals) {
    if ((s.signalType === 'cite' || s.signalType === 'chat-cite') && s.sourceNeuronId) {
      ids.add(s.sourceNeuronId);
    }
  }
  return ids.size;
}

/** Recency-weighted sum of reinforcement signals (cite/access/chat-cite) in
 *  the last 90 days, capped. Contradictions are excluded here — they enter via
 *  contradictionFactor, not as a positive boost. F182.8: 'curator-pin' is also
 *  excluded — it's an audit-only record of a pin/unpin action (the exemption is
 *  driven by documents.confidence_pinned in the decay job), so a lingering pin
 *  signal must not leak a boost into a Neuron's score after it's unpinned. */
export function computeReinforcementBoost(signals: ConfidenceSignalInput[], now: number): number {
  let boost = 0;
  for (const s of signals) {
    if (s.signalType === 'contradiction' || s.signalType === 'curator-pin') continue;
    const ageDays = (now - s.recordedAt) / DAY_MS;
    if (ageDays < 0 || ageDays > REINFORCEMENT_WINDOW_DAYS) continue;
    boost += s.weight * Math.exp(-ageDays / REINFORCEMENT_RECENCY_TAU_DAYS);
  }
  return Math.min(MAX_REINFORCEMENT_BOOST, Math.max(0, boost));
}

export function computeConfidence(input: ComputeConfidenceInput): number {
  const tau = input.decayRates?.[input.type] ?? DEFAULT_DECAY_RATES[input.type] ?? 180;
  const ageDays = Math.max(0, (input.now - input.createdAt) / DAY_MS);
  const recency = Math.exp(-ageDays / tau);

  // Floor source count at 1: every resident Neuron is backed by at least its
  // own ingest source, so one with no *additional* citations still scores from
  // a non-zero baseline rather than collapsing the whole product to 0.
  const sourceCount = Math.max(1, countDistinctSources(input.signals));
  const sourceStrength = Math.log2(1 + sourceCount) / Math.log2(11); // normalized so n=10 → 1.0

  const contradictionFactor = Math.min(0.9, 0.3 * Math.max(0, input.contradictionCount));
  const reinforcementBoost = computeReinforcementBoost(input.signals, input.now);

  const raw = recency * sourceStrength * (1 - contradictionFactor) + reinforcementBoost;
  return Math.max(0, Math.min(1, raw));
}
