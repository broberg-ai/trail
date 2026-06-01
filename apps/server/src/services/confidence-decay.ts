/**
 * F182.3 — nightly per-tenant confidence-decay job.
 *
 * Mirrors the lint-scheduler shape (per-tenant scheduler, env-controlled
 * cadence, returns a stop fn, registered once per tenant in index.ts). On a
 * schedule it walks every non-archived wiki Neuron in every KB and recomputes
 * `documents.confidence` from the F182.2 formula:
 *
 *   1. Load the Neuron's confidence_signals from the last 90d.
 *   2. contradictionCount = count of `contradiction` signals in that window
 *      (the F158 supersession path records contradictions as signals — F182.5
 *      wires the writer; until then this is 0 and the formula handles it).
 *   3. recompute via computeConfidence (pure math — NO LLM, per F156 Phase-1
 *      cost rule), then write confidence + confidence_last_recomputed_at.
 *
 * On signature-skip — a deliberate divergence from F158's pattern, documented
 * because the card asks for "F158-style signature-skip":
 *
 *   F158 skips re-running when a Neuron + its inputs are unchanged because the
 *   skipped work is an *LLM contradiction scan* — expensive, and its output
 *   only changes when content changes. Confidence decay is different: recency =
 *   exp(−age/τ) drops a little EVERY day even when nothing about the Neuron
 *   changed. A true "skip if unchanged since last run" would FREEZE decay — the
 *   exact opposite of the job's purpose. And the recompute itself is microsecond
 *   pure math, so there's no expensive work to skip.
 *
 *   So the skip here is on the WRITE, not the compute: we always recompute, and
 *   only issue the UPDATE when the new value moves by ≥ EPSILON. That keeps the
 *   job idempotent (a second pass in the same minute is a no-op) and avoids WAL
 *   churn on a large KB, while still letting age-decay flow through over days.
 *
 * Controls via env:
 *   - TRAIL_DECAY_SCHEDULE_HOURS (default 24; 0 disables)
 *   - TRAIL_DECAY_INITIAL_DELAY_SECONDS (default 600 = 10min after boot)
 */
import { confidenceSignals, documents, knowledgeBases, type TrailDatabase } from '@trail/db';
import { and, eq, gte } from 'drizzle-orm';
import { deriveType } from '@trail/shared';
import {
  computeConfidence,
  type ConfidenceSignalInput,
} from './confidence.js';
import { loadDecayRates } from './tenant-settings.js';

const SCHEDULE_HOURS = Number(process.env.TRAIL_DECAY_SCHEDULE_HOURS ?? 24);
const INITIAL_DELAY_MS =
  Number(process.env.TRAIL_DECAY_INITIAL_DELAY_SECONDS ?? 600) * 1000;

const DAY_MS = 24 * 3600 * 1000;
const WINDOW_DAYS = 90;
// Smallest confidence delta worth a write. Below this the value is visually
// and functionally identical; skipping the UPDATE keeps the pass idempotent
// and avoids WAL churn on large KBs.
const EPSILON = 1e-4;

/** Combine a Neuron's directory path + filename into the full path deriveType expects. */
function neuronPath(path: string, filename: string): string {
  const dir = path.endsWith('/') ? path : `${path}/`;
  return `${dir}${filename}`;
}

/** SQLite stores created_at as "YYYY-MM-DD HH:MM:SS" in UTC — parse as UTC. */
function parseCreatedAt(s: string): number {
  const t = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(t) ? Date.now() : t;
}

/**
 * Recompute confidence for every non-archived wiki Neuron in this tenant.
 * Pure SQL + math; no LLM. Returns counts for logging/verification.
 */
export async function runDecayPass(
  trail: TrailDatabase,
  now: number = Date.now(),
): Promise<{ recomputed: number; updated: number }> {
  const windowStart = now - WINDOW_DAYS * DAY_MS;
  let recomputed = 0;
  let updated = 0;

  // F182.7 — per-tenant τ overrides from tenants.settings_json (Memory Health
  // sliders), merged over DEFAULT_DECAY_RATES. Loaded once per pass.
  const decayRates = await loadDecayRates(trail);

  const kbs = await trail.db.select({ id: knowledgeBases.id }).from(knowledgeBases).all();

  for (const kb of kbs) {
    const neurons = await trail.db
      .select({
        id: documents.id,
        path: documents.path,
        filename: documents.filename,
        createdAt: documents.createdAt,
        confidence: documents.confidence,
        lastRecomputedAt: documents.confidenceLastRecomputedAt,
        pinned: documents.confidencePinned,
      })
      .from(documents)
      .where(
        and(
          eq(documents.knowledgeBaseId, kb.id),
          eq(documents.kind, 'wiki'),
          eq(documents.archived, false),
        ),
      )
      .all();

    for (const n of neurons) {
      const sigs = await trail.db
        .select({
          signalType: confidenceSignals.signalType,
          weight: confidenceSignals.weight,
          sourceNeuronId: confidenceSignals.sourceNeuronId,
          recordedAt: confidenceSignals.recordedAt,
        })
        .from(confidenceSignals)
        .where(
          and(
            eq(confidenceSignals.neuronId, n.id),
            gte(confidenceSignals.recordedAt, windowStart),
          ),
        )
        .all();

      const signals: ConfidenceSignalInput[] = sigs.map((s) => ({
        signalType: s.signalType,
        weight: s.weight,
        sourceNeuronId: s.sourceNeuronId,
        recordedAt: s.recordedAt,
      }));
      const contradictionCount = signals.filter((s) => s.signalType === 'contradiction').length;

      // F182.8 — a curator-pinned Neuron is decay-EXEMPT: human judgment
      // overrides the formula entirely and holds confidence at 1.0, so a
      // timeless fact (Newton's laws) never decays out of visibility with age.
      const confidence = n.pinned
        ? 1
        : computeConfidence({
            type: deriveType(neuronPath(n.path, n.filename)),
            createdAt: parseCreatedAt(n.createdAt),
            signals,
            contradictionCount,
            // F182.7 — per-tenant τ overrides (Memory Health sliders), merged
            // over DEFAULT_DECAY_RATES in loadDecayRates above.
            decayRates,
            now,
          });
      recomputed++;

      // Write only when the value actually moved (or never recomputed) — see
      // the signature-skip note in the file header.
      if (n.lastRecomputedAt == null || Math.abs(confidence - n.confidence) >= EPSILON) {
        await trail.db
          .update(documents)
          .set({ confidence, confidenceLastRecomputedAt: now })
          .where(eq(documents.id, n.id))
          .run();
        updated++;
      }
    }
  }

  return { recomputed, updated };
}

/**
 * Start the nightly decay scheduler for one tenant DB. Returns a stop fn.
 * Registered per-tenant in index.ts alongside startLintScheduler.
 */
export function startConfidenceDecay(trail: TrailDatabase): () => void {
  if (SCHEDULE_HOURS <= 0) {
    console.log('  confidence-decay: disabled (TRAIL_DECAY_SCHEDULE_HOURS=0)');
    return () => {};
  }

  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const r = await runDecayPass(trail);
      console.log(`  confidence-decay: recomputed ${r.recomputed}, updated ${r.updated}`);
    } catch (err) {
      console.error('  confidence-decay: pass failed:', err);
    }
  };

  const first = setTimeout(() => void tick(), INITIAL_DELAY_MS);
  const interval = setInterval(() => void tick(), SCHEDULE_HOURS * 3600 * 1000);

  console.log(
    `  confidence-decay: every ${SCHEDULE_HOURS}h, first pass in ${Math.round(INITIAL_DELAY_MS / 1000)}s`,
  );

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(interval);
  };
}
