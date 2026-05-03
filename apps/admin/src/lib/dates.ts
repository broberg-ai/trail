/**
 * Locale-aware date helpers.
 *
 * Every date the admin renders should pass through here so the
 * curator's Trail-locale (DA vs EN, set via the language switcher
 * in the header) wins over `navigator.language`. ISO YYYY-MM-DD
 * displayed raw reads as year-first to ISO-8601 nerds and wrong
 * to everyone else.
 *
 * Two formats:
 *   - formatLocaleDate(iso, locale): "29. apr. 2026" (DA) or
 *     "Apr 29, 2026" (EN). For tooltips, table cells, anywhere
 *     with horizontal room.
 *   - formatShortLocaleDate(iso, locale): "29/4" (DA) or "Apr 29"
 *     (EN). For tight spaces — recent-transactions lists, badges.
 */

import type { Locale } from './i18n';

export function formatLocaleDate(iso: string, locale: Locale): string {
  try {
    // Accept both "YYYY-MM-DD" (date-only) and full ISO timestamps.
    // Date-only strings need an explicit time component otherwise JS
    // parses them as UTC midnight, which can shift a day west of GMT.
    const d = iso.includes('T') ? new Date(iso) : new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(locale === 'da' ? 'da-DK' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function formatShortLocaleDate(iso: string, locale: Locale): string {
  try {
    const d = iso.includes('T') ? new Date(iso) : new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    if (locale === 'da') {
      return `${d.getDate()}/${d.getMonth() + 1}`;
    }
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}
