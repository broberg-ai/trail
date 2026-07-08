/**
 * F202.1 — grep-based fact recall.
 *
 * The hard, non-subjective quality metric from F199.10: given a ledger of
 * known source facts (needle strings), count how many survived verbatim into
 * the compiled Neuron text. A high recall means the model extracted the
 * source's specifics; a low recall means it paraphrased them away or never
 * reached that part of the document within the turn budget.
 *
 * Deliberately a plain substring match (not fuzzy) — the ledger author picks
 * needles that SHOULD appear verbatim (e.g. "MP9", "Blære 60", "Pigepunktet").
 */
export interface Fact {
  id: string;
  needle: string;
}

export interface RecallResult {
  total: number;
  found: number;
  foundIds: string[];
  missingIds: string[];
}

export function scoreRecall(neuronContent: string, facts: Fact[]): RecallResult {
  const found = facts.filter((f) => neuronContent.includes(f.needle));
  const missing = facts.filter((f) => !neuronContent.includes(f.needle));
  return {
    total: facts.length,
    found: found.length,
    foundIds: found.map((f) => f.id),
    missingIds: missing.map((f) => f.id),
  };
}
