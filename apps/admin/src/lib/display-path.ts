import { t } from './i18n';

/**
 * Display-only path formatter. Storage is canonical `/neurons/...`;
 * this helper:
 *   1. rewrites legacy `/wiki/...` → `/neurons/...` (safety shim for
 *      pre-bootstrap data and adapters that haven't caught up yet)
 *   2. localizes well-known segment names (neurons, queries, sources,
 *      images, attachments, wiki) for the active locale.
 *
 * Return value is for HUMAN display only — text nodes, tooltips,
 * aria-labels. NEVER pass the return value into a navigation href, an
 * API request URL, a localStorage key, or any other identifier that
 * survives outside the render — the localized form ("/neuroner/…")
 * doesn't exist on the server.
 */
export function formatPathDisplay(p: string | null | undefined): string {
  if (!p) return '';
  const normalized = p.replace(/^\/wiki(\/|$)/, '/neurons$1');
  return normalized
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      const translated = t(`pathLabel.${seg}`);
      return translated === `pathLabel.${seg}` ? seg : translated;
    })
    .join('/');
}

/**
 * @deprecated — renamed to formatPathDisplay() to make it obvious the
 * return value is display-only. The old name implied path-normalisation
 * which is misleading now that segments get localized. Use the new
 * name; this alias stays for one release for backward-compat.
 */
export const displayPath = formatPathDisplay;
