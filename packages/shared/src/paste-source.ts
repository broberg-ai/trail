/**
 * F149.7 — indsat tekst bliver en KILDEFIL, ikke en ny ingest-vej.
 *
 * Christians ordre: «et felt eller en knap på Sources, hvor den blot åbner et
 * txt felt hvor jeg kan paste nogle tanker og skriblerier ind der sendes
 * direkte til Active Ingest. Samme funktion skal virke i den lokale klient.»
 *
 * VALGET: teksten pakkes som en File i browseren og sendes gennem det
 * EKSISTERENDE upload-endepunkt. Ingen ny server-rute.
 *
 * Grunden er den samme som bag hybrid-søgningens design: en anden vej ind til
 * de samme data, med sine egne kopier af reglerne, er hvordan man mister en
 * regel. Upload-vejen bærer allerede dedup (F162), connector-stempling (F95),
 * awaitingLocalCompile (F191) og hele kompilerings-kæden. En «paste»-rute
 * ville skulle gentage alle fire, og den dag nogen tilføjer den femte, får den
 * kun den ene af vejene.
 *
 * Modulet ligger i @trail/shared fordi BEGGE flader bruger det — admin og
 * Ingest-Station. To kopier af navngivningen ville give to forskellige
 * filnavne-konventioner for den samme handling.
 */

/** Hvor lang en overskrift må blive i filnavnet. */
const MAX_SLUG = 60;

export function slugifyTitel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[æä]/g, 'ae').replace(/[øö]/g, 'oe').replace(/[åa]̊/g, 'aa').replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
}

/**
 * Udled et menneskeligt navn af teksten selv: en markdown-overskrift hvis der
 * er en, ellers den første linje med indhold.
 */
export function udledTitel(tekst: string): string {
  for (const linje of tekst.split('\n')) {
    const t = linje.trim();
    if (!t) continue;
    return t.replace(/^#+\s*/, '').trim() || 'note';
  }
  return 'note';
}

/**
 * TIDSSTEMPLET ER IKKE PYNT — det er det der gør hver indsættelse til sin egen
 * kilde. Et gen-upload af SAMME filnavn opdaterer det eksisterende dokument og
 * lægger det i kø igen (uploads.ts:357) — mekanismen bag F252's dublet-storm.
 * To noter med samme overskrift ville altså overskrive hinanden i stilhed, og
 * den første ville være væk uden at nogen fik besked.
 *
 * Sekunder er nok: to indsættelser inden for samme sekund kræver at et menneske
 * trykker gem to gange på under ét sekund, og skulle det ske, er svaret fra
 * upload-ruten en synlig dublet-advarsel (F162) — ikke en tavs overskrivning.
 */
export function noteFilnavn(tekst: string, nu = new Date()): string {
  const stempel = nu.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '').replace('T', '_').slice(0, 19);
  const slug = slugifyTitel(udledTitel(tekst)) || 'note';
  return `note-${stempel}-${slug}.md`;
}

/** Kan denne tekst overhovedet gemmes? */
export function kanGemmes(tekst: string): boolean {
  return tekst.trim().length > 0;
}
