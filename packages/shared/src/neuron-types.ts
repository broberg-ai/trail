/**
 * F101 — Neuron type catalog + path-derived classifier.
 *
 * Every Neuron has a semantic type derived from its path prefix.
 * Source of truth = `documents.path`; type is computed (not stored)
 * so existing rows pick up the right type on next render with no
 * migration. Karpathy-parity + Balu's repo-skema + Shuyi Wang's
 * `queries/` convention.
 *
 * Adding a path-prefix mapping here:
 *   1. Extend the `NeuronType` union below.
 *   2. Add a branch in `deriveType()`.
 *   3. (Optional) Update the compile-prompt so the LLM creates new
 *      Neurons under the matching prefix.
 *
 * Adding a new prefix without extending the union: the prefix falls
 * through to `'note'`. That's the safe default — pre-existing rows
 * under unrecognised prefixes don't crash, they just get the
 * generic label.
 */

export type NeuronType =
  | 'source'
  | 'concept'
  | 'entity'
  | 'synthesis'
  | 'comparison'
  | 'query'
  | 'glossary'
  | 'session'
  | 'heuristic'
  | 'note';

/**
 * Derive the semantic type of a Neuron from its document path.
 *
 * Pure function — no I/O, no side effects. Safe to call from any
 * layer (server, admin UI, shared serializers).
 *
 * Path conventions:
 *   /neurons/sources/…       → source
 *   /neurons/concepts/…      → concept
 *   /neurons/entities/…      → entity
 *   /neurons/synthesis/…     → synthesis
 *   /neurons/comparisons/…   → comparison
 *   /neurons/queries/…       → query   (compounding chat-answers)
 *   /neurons/sessions/…      → session (verbatim chat logs, no compile)
 *   /neurons/heuristics/…    → heuristic (F139 — confidence decays over time)
 *   /neurons/glossary.md     → glossary
 *   anything else            → note
 */
export function deriveType(path: string): NeuronType {
  if (path.startsWith('/neurons/sources/')) return 'source';
  if (path.startsWith('/neurons/concepts/')) return 'concept';
  if (path.startsWith('/neurons/entities/')) return 'entity';
  if (path.startsWith('/neurons/synthesis/')) return 'synthesis';
  if (path.startsWith('/neurons/comparisons/')) return 'comparison';
  if (path.startsWith('/neurons/queries/')) return 'query';
  if (path.startsWith('/neurons/sessions/')) return 'session';
  if (path.startsWith('/neurons/heuristics/')) return 'heuristic';
  if (path === '/neurons/glossary.md') return 'glossary';
  return 'note';
}

/**
 * Render `type:` in YAML frontmatter format. Used by serializers
 * (F100 export, F130 llms.txt) once those features land.
 */
export function typeFrontmatterLine(path: string): string {
  return `type: ${deriveType(path)}`;
}
