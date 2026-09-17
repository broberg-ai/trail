/**
 * F275.1 — hvad ER en kilde, hen over sine udgaver?
 *
 * Christians regel: «hvis kilden — altså en URL på en hjemmeside — forbliver
 * den samme, så skal den seneste udgave være kanon.» Reglen kan først bygges
 * når vi kan sige HVILKEN kilde to udgaver er udgaver AF.
 *
 * ## Præfikset er ikke pynt
 *
 * `url:` · `path:` · `fp:` holder tre identitets-RUM adskilt. Uden dem kunne en
 * filsti og en URL kollidere, og kollisionen ville se ud som «samme kilde» —
 * altså den ene fejl hele featuren findes for at undgå, opstået af dens eget
 * felt.
 *
 * ## Hvorfor ikke bare filnavnet
 *
 * Fordi det tager fejl BEGGE veje, målt som argument frem for påstået:
 *
 *   samme fil, nyt navn      filnavn: ny kilde ✗     identitet: samme ✓
 *   to filer, samme navn     filnavn: samme ✗        identitet: forskellig ✓
 *
 * To sites kan begge levere `index.md`.
 *
 * ## Den tredje tilstand
 *
 * `null` betyder «vi ved det ikke» — ALDRIG «der er ingen kilde». Kalderen skal
 * kunne skelne, for en afløsnings-regel der læser «ved ikke» som «ny kilde»
 * ville tie om præcis de sager den findes for.
 */

/** Identitets-rum. Nye rum tilføjes her, aldrig ad hoc på et kaldested. */
export const IDENTITETS_RUM = ['url', 'path', 'fp'] as const;
export type IdentitetsRum = (typeof IDENTITETS_RUM)[number];

/**
 * Byg en kilde-identitet. Returnerer `null` når værdien er tom — en tom
 * identitet er ikke en identitet, og et præfiks foran ingenting ville se
 * gyldigt ud i hver eneste sammenligning.
 */
export function kildeIdentitet(rum: IdentitetsRum, vaerdi: string | null | undefined): string | null {
  const v = (vaerdi ?? '').trim();
  if (!v) return null;
  return `${rum}:${rum === 'url' ? normaliserUrl(v) : v}`;
}

/**
 * Bring en URL på ÉN form, så to skrivemåder af samme side er samme identitet.
 *
 * MÅLT 17/9 i broberg.ai, inde i featurens egen nøgle: den samme side stod med
 * TO identiteter —
 *
 *   url:https://broberg.ai/indsigter/design-i-højere-luftlag
 *   url:https://broberg.ai/indsigter/design-i-h%C3%B8jere-luftlag
 *
 * — én skrevet af kilde-siden, én af Neuron-siden. Som to strenge er de
 * forskellige, og afløsningen ville derfor behandle en rettelse af den side som
 * en fremmed kilde: nøjagtig den fejl hele F275 findes for at fjerne, opstået i
 * det felt der skulle fjerne den. 1 af 114 i dag — men netop den side var den
 * Christian bad om at få kompileret igen, så raten siger ikke noget om hvor
 * meget det betyder.
 *
 * VI BRUGER BROWSERENS EGEN REGEL (`new URL().href`) og ikke vores egen
 * afkodning. Den gør præcis det rigtige, og — vigtigere — den lader være med at
 * gøre det forkerte: `%2F` bliver IKKE til `/`, for det ville ændre stiens
 * betydning. Værtsnavnet småskrives (værter er ikke versalfølsomme), mens stien
 * bevarer sine store bogstaver (stier ER versalfølsomme). En håndskrevet
 * `unquote()` ville have ramt begge dele forkert.
 *
 * KASTER DEN, BEHOLDER VI STRENGEN SOM DEN ER. En værdi der ikke er en URL er
 * stadig en identitet — bare ikke en vi kan normalisere. At droppe den ville
 * gøre «kunne ikke normaliseres» til «har ingen kilde», og de to må aldrig
 * kunne forveksles.
 */
export function normaliserUrl(v: string): string {
  try {
    return new URL(v).href;
  } catch {
    return v;
  }
}

/** Del en identitet op igen. `null` når strengen ikke bærer et kendt rum. */
export function laesIdentitet(id: string | null | undefined): { rum: IdentitetsRum; vaerdi: string } | null {
  if (!id) return null;
  const i = id.indexOf(':');
  if (i <= 0) return null;
  const rum = id.slice(0, i) as IdentitetsRum;
  if (!IDENTITETS_RUM.includes(rum)) return null;
  const vaerdi = id.slice(i + 1);
  return vaerdi ? { rum, vaerdi } : null;
}

/**
 * Udled en kildes identitet af dens metadata.
 *
 * MÅLT 16/9: 66 af 70 råkilder i broberg.ai bærer allerede `metadata.sourceUrl`
 * — identiteten FANDTES, den havde bare intet felt at bo i. De sidste 4 er
 * uploads og hører til F275.6's fingeraftryk; indtil da får de `null`, hvilket
 * er sandt frem for gættet.
 */
export function identitetFraMetadata(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const p = JSON.parse(metadata) as { sourceUrl?: unknown };
    if (typeof p?.sourceUrl === 'string') return kildeIdentitet('url', p.sourceUrl);
  } catch { /* ikke JSON — så bærer den ingen identitet */ }
  return null;
}
