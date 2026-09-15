/**
 * F274 — et dansk CPR-nummer må aldrig lande i en Brain.
 *
 * ## Hvorfor det er et ægte problem og ikke en teoretisk risiko
 *
 * Ambient opsamler fra SKÆRMEN, og ejeren arbejder dagligt i fd-sundhed med
 * rigtige patientforløb. Målt 15. september 2026 stod hans EGET CPR i klartekst
 * i en Neuron i CB-M1. Hans eget er hans at bestemme over — han afviste en
 * oprydning. **En PATIENTS CPR i en søgbar base er en anden sag:** det er ikke
 * hans data at have liggende, og den fejl bliver ikke opdaget ved at kigge.
 *
 * ## FØR persistering, ikke ved compile
 *
 * Maskeringen sker i indtaget, hvor `redactSecrets` allerede kører på titel og
 * indhold (candidates.ts). Det rå nummer rammer derfor aldrig disken.
 *
 * Alternativet — at maskere ved compile — ville efterlade det rå i præcis den
 * base søgningen læser fra, plus i hver backup og hvert snapshot. Et CPR der
 * aldrig nåede disken kan ikke lække fra noget af det.
 *
 * ## DE TRE TING DER GØR MØNSTERET RIGTIGT
 *
 * **1. INGEN modulus-11.** Siden 2007 er kontrolcifferet opgivet for en del
 * numre, så ÆGTE CPR-numre dumper den test. Validerer man på modulus-11,
 * smider man ægte numre væk som falske positive — altså fejler man i den
 * FARLIGE retning: de slipper umaskerede igennem. Vi matcher på FORM og
 * accepterer hellere en falsk positiv. Et maskeret ordrenummer er en kosmetisk
 * fejl; et umaskeret CPR er anmeldelsespligtigt.
 *
 * **2. Datodelen er det der gør mønsteret brugbart.** Ti vilkårlige cifre er
 * også ordrenumre, telefonnumre og commit-ting. Kravet om en gyldig dag/måned
 * er forskellen på en maskering man beholder og en man slår fra efter en uge.
 *
 * **3. Ordgrænser i begge ender.** Uden dem ville de sidste ti cifre af et
 * langt tal blive læst som et CPR.
 *
 * (Alle tre er components' advarsel, givet via cardmem 15/9 2026.)
 *
 * ## Hvor det HØRER hjemme
 *
 * I `@broberg/secret-scan`, som components ejer — så hver eneste session i
 * flåden får det, ikke kun vores indtag. Det ligger her fordi pakken har et
 * `extraPatterns`-hul netop til dette, og fordi Trails indtag ikke skal stå
 * ubeskyttet mens en npm-udgivelse ruller. Lander mønsteret i pakken, slettes
 * denne fil og `extraPatterns` fjernes fra kaldestedet.
 */
import type { SecretPattern } from '@broberg/secret-scan';

/**
 * DDMMYY + 4 cifre, med eller uden bindestreg.
 *
 * Datodelen er opdelt i grupper så `erGyldigDato` kan bedømme den — en regex
 * kan kende formen, men ikke at 31. februar ikke findes.
 */
const CPR_FORM = /\b(\d{2})(\d{2})(\d{2})-?(\d{4})\b/g;

/** Findes dagen? Februar 30 og måned 13 er ordrenumre, ikke fødselsdage. */
export function erGyldigDato(dd: string, mm: string, aa: string): boolean {
  const d = Number(dd), m = Number(mm);
  if (m < 1 || m > 12 || d < 1) return false;
  // Århundredet er ikke entydigt i et CPR (det afhænger af løbenummeret, som
  // vi med vilje ikke fortolker), så skudår kan ikke afgøres. 29. februar
  // accepteres derfor altid — at afvise den ville smide ægte numre væk, og
  // det er netop den farlige retning.
  const dageIMaaned = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
  void aa;
  return d <= dageIMaaned[m - 1]!;
}

/** Ligner teksten et CPR-nummer? Bruges af prøver og af mønsteret nedenfor. */
export function seromCpr(tekst: string): boolean {
  CPR_FORM.lastIndex = 0;
  for (const m of tekst.matchAll(CPR_FORM)) {
    if (erGyldigDato(m[1]!, m[2]!, m[3]!)) return true;
  }
  return false;
}

/**
 * Mønsteret som `redactSecrets` kan bruge.
 *
 * Regexen kan ikke selv afvise 31. februar, så den matcher formen bredt og
 * `erstat` lader en ugyldig dato stå uændret. Nettoresultatet er det samme som
 * en datovalideret regex, men logikken er læselig for et menneske.
 */
export const CPR_MOENSTER: SecretPattern = {
  label: 'dk-cpr',
  description: 'Dansk CPR-nummer (DDMMYY-XXXX). Matchet på FORM + gyldig dato — aldrig modulus-11, som ægte numre dumper.',
  regex: CPR_FORM,
};

/**
 * Maskér CPR-numre med gyldig datodel. Lader alt andet stå.
 *
 * Markøren siger HVAD der blev fjernet. Et lydløst indgreb kan ikke skelnes
 * fra at der aldrig stod noget — og en curator der ser «[CPR fjernet]» ved at
 * Neuronen mangler noget med vilje.
 */
export function maskerCpr(tekst: string): { maskeret: string; antal: number } {
  let antal = 0;
  const maskeret = tekst.replace(CPR_FORM, (hel, dd: string, mm: string, aa: string) => {
    if (!erGyldigDato(dd, mm, aa)) return hel;
    antal += 1;
    return '[CPR fjernet]';
  });
  return { maskeret, antal };
}
