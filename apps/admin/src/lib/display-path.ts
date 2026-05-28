import { t } from './i18n';

/**
 * Storage is canonical `/neurons/...` now. This helper remains as a safety
 * shim for two edge cases:
 *  - legacy data that slipped in before the bootstrap rewrite ran
 *  - external ingest clients (buddy, CMS adapters) that haven't caught up to
 *    the namespace change yet
 *
 * For any `/neurons/...` input it's a no-op. For a stale `/wiki/...` it
 * rewrites to `/neurons/...` so the curator never sees the old prefix.
 *
 * F186 — additionally localizes well-known segment names (neurons, queries,
 * sources, images, attachments, wiki) so the path breadcrumb reads in the
 * curator's active locale (`/NEURONS/QUERIES/` → `/NEURONER/FORESPØRGSLER/`
 * when DA is on). The canonical storage path stays unchanged — this is a
 * display-only transform.
 */
export function displayPath(p: string | null | undefined): string {
  if (!p) return '';
  const normalized = p.replace(/^\/wiki(\/|$)/, '/neurons$1');
  // Localize each segment when a translation key exists.
  return normalized
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      const translated = t(`pathLabel.${seg}`);
      return translated === `pathLabel.${seg}` ? seg : translated;
    })
    .join('/');
}
