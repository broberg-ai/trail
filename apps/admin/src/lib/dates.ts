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

/**
 * F253.4 — vis et SERVER-tidsstempel (med klokkeslæt) i dansk tid.
 *
 * De to funktioner ovenfor tager en DATO uden klokkeslæt og tolker den i
 * beskuerens zone — rigtigt for dét de gør, og ubrugeligt her: de kan slet ikke
 * læse serverens «2026-09-05 21:47:28» (uden T bliver den til Invalid Date).
 *
 * Denne i DANSK tid, med zonen navngivet.
 *
 * Serveren gemmer og svarer i UTC (`datetime('now')` i en Fly-container). En
 * tid uden zone bliver læst i læserens egen — lydløst — og mellem midnat og
 * 02:00 dansk tid er det en ANDEN DATO. Det er allerede nået ud til en kunde
 * én gang i flåden: et opkald oprettet 22:30Z den 21. er 00:30 den 22. i
 * København, og kunden fik at vide den 21.
 *
 * Zonen angives ved NAVN, aldrig som et fast +02:00: Danmark er UTC+1 om
 * vinteren, så et hardkodet offset er forkert et halvt år ad gangen.
 *
 * Ligger i sin egen fil, ikke inde i panelet, så prøven kan kalde PRÆCIS den
 * kode fladen bruger. En prøve der har sin egen kopi af reglen kan blive
 * stående grøn mens produktet driver væk fra den.
 */
export function dansk(ts: string): string {
  const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('da-DK', {
    timeZone: 'Europe/Copenhagen',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
