/**
 * F227 — sorting for the image list.
 *
 * A pure function so the ordering rules can be tested without a DOM. Three of
 * them are decisions rather than details:
 *
 *  - SIZE sorts on AREA (w x h), not on width alone. A 2000x10 divider rule and
 *    a 200x200 figure are not comparable on one dimension, and width-only would
 *    put the rule first in a list meant to surface the big images.
 *  - A row with NO value always sorts LAST, in BOTH directions. Treating a
 *    missing page as 0 would park every page-less image at the top of an
 *    ascending sort and look like a result.
 *  - The sort is STABLE, so sorting a second column keeps the first one's order
 *    for equal values instead of reshuffling.
 */
import type { ImageHit } from '../api.js';

export type SortKey = 'description' | 'page' | 'size';

export function sortHits(
  hits: ImageHit[],
  sort: { key: SortKey; dir: 'asc' | 'desc' } | null,
): ImageHit[] {
  if (!sort) return hits;
  const value = (h: ImageHit): string | number | null => {
    if (sort.key === 'description') return h.alt && h.alt.trim() ? h.alt.trim().toLowerCase() : null;
    if (sort.key === 'page') return typeof h.page === 'number' ? h.page : null;
    const w = h.width ?? 0;
    const ht = h.height ?? 0;
    return w > 0 && ht > 0 ? w * ht : null;
  };
  const sign = sort.dir === 'asc' ? 1 : -1;
  return hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => {
      const va = value(a.h);
      const vb = value(b.h);
      if (va === null && vb === null) return a.i - b.i;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va === vb) return a.i - b.i;
      return (va < vb ? -1 : 1) * sign;
    })
    .map((x) => x.h);
}

