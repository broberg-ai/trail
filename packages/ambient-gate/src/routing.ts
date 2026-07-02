/**
 * F201.1 — KB routing stub (full heuristics land in F201.7).
 *
 * Classifies a gated chunk as deal-knowledge vs personal knowledge and
 * resolves the target KB slug from config. Invariant (F201.7 AC, enforced
 * from day one): an unclassifiable chunk routes to the DEFAULT KB — a
 * candidate is NEVER dropped silently by routing.
 */

export type RouteClass = 'deal' | 'personal';

export interface RoutingConfig {
  /** KB slug for B2B/deal knowledge. */
  dealKb: string;
  /** KB slug for personal knowledge. */
  personalKb: string;
  /** Fallback when classification is ambiguous. */
  defaultKb: string;
}

const DEAL_TERMS = [
  'kunde', 'kunden', 'tilbud', 'kontrakt', 'faktura', 'pris', 'rabat', 'ordre',
  'pipeline', 'deal', 'client', 'customer', 'proposal', 'invoice', 'quote',
  'pricing', 'contract', 'renewal', 'churn',
];

export function classifyChunk(text: string): RouteClass | null {
  const lower = text.toLowerCase();
  const dealHits = DEAL_TERMS.filter((t) => lower.includes(t)).length;
  if (dealHits >= 2) return 'deal';
  if (dealHits === 1) return null; // ambiguous — one stray word is not a deal
  return 'personal';
}

/** Resolve the KB slug for a chunk. Never returns undefined/null. */
export function routeKb(text: string, config: RoutingConfig): { kb: string; routeClass: RouteClass | null } {
  const routeClass = classifyChunk(text);
  if (routeClass === 'deal') return { kb: config.dealKb, routeClass };
  if (routeClass === 'personal') return { kb: config.personalKb, routeClass };
  return { kb: config.defaultKb, routeClass };
}
