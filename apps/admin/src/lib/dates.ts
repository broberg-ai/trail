/**
 * Datoer i Trail vises ALTID på dansk — også når sproget er engelsk.
 *
 * Ejerens regel, 15. september 2026: «datoer skal ALTID vises på dansk i mine
 * produkter også selv om sproget er Engelsk.»
 *
 * Det er ikke en oversættelses-beslutning, det er en LÆSBARHEDS-beslutning.
 * `04/09/2026` er 4. september for en dansker og 9. april for en amerikaner,
 * og ingen af dem kan se på tallet hvilken læsning der var ment. Det fejler
 * lydløst og i den grønne retning: datoen ser rigtig ud, den betyder bare
 * noget andet. Produktet har én ejer og ét sted, og hans dato er dansk.
 *
 * Derfor tager funktionerne herunder stadig et `locale`-argument — 4 kaldesteder
 * sender det — men de bruger det IKKE til datoformatet. Argumentet er bevaret så
 * kaldestederne ikke skal røres, og at det ignoreres står her frem for at blive
 * opdaget af den næste der undrer sig.
 *
 * SPROGET i et månedsnavn følger med: «29. apr. 2026», ikke «Apr 29, 2026».
 * Et halvt dansk format med engelske måneder ville være det værste af to.
 */

import type { Locale } from './i18n';

/** Zonen ved NAVN, aldrig et fast offset: Danmark er UTC+1 om vinteren. */
export const DANSK_ZONE = 'Europe/Copenhagen';

/** `29. apr. 2026`. Til tooltips, tabelceller — alt med vandret plads. */
export function formatLocaleDate(iso: string, _locale?: Locale): string {
  try {
    // Accept both "YYYY-MM-DD" (date-only) and full ISO timestamps.
    // Date-only strings need an explicit time component otherwise JS
    // parses them as UTC midnight, which can shift a day west of GMT.
    const d = iso.includes('T') ? new Date(iso) : new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('da-DK', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** `29/4`. Til trange steder — lister, mærkater. */
export function formatShortLocaleDate(iso: string, _locale?: Locale): string {
  try {
    const d = iso.includes('T') ? new Date(iso) : new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.getDate()}/${d.getMonth() + 1}`;
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
 * Serveren gemmer og svarer i UTC (`datetime('now')` i en Fly-container). En
 * tid uden zone bliver læst i læserens egen — lydløst — og mellem midnat og
 * 02:00 dansk tid er det en ANDEN DATO. Det er allerede nået ud til en kunde
 * én gang i flåden: et opkald oprettet 22:30Z den 21. er 00:30 den 22. i
 * København, og kunden fik at vide den 21.
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
    timeZone: DANSK_ZONE,
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Et server-tidsstempel som fuld dansk dato OG klokkeslæt, med år.
 *
 * `dansk()` udelader året fordi den bruges i lister hvor alt er fra i år.
 * Denne er til de steder hvor året faktisk kan være et andet.
 */
export function danskFuld(ts: string): string {
  const iso = ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('da-DK', {
    timeZone: DANSK_ZONE,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** `YYYY-MM-DD` for en dag i DANSK tid — formen motorens filter forventer. */
export function danskISODato(d: Date = new Date()): string {
  // sv-SE giver ISO-formen; timeZone gør at en sen aften i Danmark ikke
  // bliver til dagen før, sådan som en UTC-baseret udregning ville gøre.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: DANSK_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * Vis et tidspunkt der ALLEREDE er dansk vægur-tid, som dansk tekst.
 *
 * Motoren kvitterer for et valgt tidsrum med `2026-09-10 16:00:00` — det er
 * dansk lokaltid, ikke et UTC-stempel. Den må derfor IKKE gennem `dansk()`,
 * som ville lægge zonen til en gang til og flytte svaret to timer. De to
 * strenge ligner hinanden fuldstændigt, og det er hele grunden til at denne
 * funktion findes og hedder noget andet.
 */
export function danskVaegurVisning(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return s;
  const [, aar, maaned, dag, time, minut] = m;
  // Bygget som en LOKAL Date udelukkende for at få månedsnavnet ud af Intl.
  // Der sker ingen zone-omregning: felterne går ind og ud uændret.
  const d = new Date(Number(aar), Number(maaned) - 1, Number(dag));
  const dato = d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${dato} kl. ${time}.${minut}`;
}
