/**
 * F262.3 — den ENE rangering søgefeltet og Aidan deler.
 *
 * Trail har to steder et menneske stiller et spørgsmål: søgefeltet
 * (`routes/search.ts`) og chatten med Aidan (`routes/chat.ts`). De hentede
 * kandidater ens og rangerede dem FORSKELLIGT — søgeruten fletter på plads
 * (RRF), chatten sorterede på tillid alene. Så det samme spørgsmål gav to
 * forskellige svar, og ingen af dem kunne bruges til at kontrollere den anden.
 *
 * Rækkefølgen er bærende, og de tre trin er ikke ligeværdige:
 *
 *   1. PRÆCIST NAVN — hardt først, aldrig som point.
 *   2. FLETNINGEN   — de to halvdeles enighed, på plads.
 *   3. Reserven     — kun for kandidater ingen af halvdelene rangerede.
 *
 * HVORFOR TRIN 1 ER HARDT OG IKKE EN BONUS. Ejeren foreslog selv en
 * point-bonus til den rene titel og forkastede den derefter selv. Grunden står
 * her, fordi det er den slags der ellers bliver genopfundet: et navn der
 * optræder i hundredvis af Neuroner (broberg, cardmem, trail) kan altid samle
 * nok point denne uge til at løbe fra bonussen næste uge, når korpusset er
 * vokset — og INTET siger fra. Et hardt første-opslag kan ikke skride.
 *
 * HVORFOR TRIN 3 IKKE ER EN SORTERING PÅ TILLID FOR ALLE. Tillid siger noget
 * om hvor meget vi stoler på en Neuron, ikke om den svarer på spørgsmålet. Som
 * primær rangering lod den en Neuron med høj tillid og intet med sagen at gøre
 * overhale den betydnings-søgningen fandt som nr. 1.
 */
import { reciprocalRankFusion } from './fusion.js';

export interface RangerArgs<T> {
  /** Id'er hvis TITEL er præcis det der blev søgt efter. Ligger altid først. */
  præcise: ReadonlySet<string>;
  /** Ordmatchningens rangering, i dens egen rækkefølge. */
  ord: readonly { id: string }[];
  /** Betydnings-søgningens rangering, i dens egen rækkefølge. Tom = slukket. */
  vektor: readonly { id: string }[];
  /** Reserve for kandidater ingen af halvdelene rangerede. Uden den: uændret orden. */
  reserve?: (a: T, b: T) => number;
}

/**
 * Ranger kandidaterne. Muterer ikke input.
 *
 * `Array.prototype.sort` er stabil i alle vores kørselsmiljøer, så to
 * kandidater der er lige på alle tre trin beholder den rækkefølge de kom i.
 */
export function rangerKandidater<T extends { id: string }>(
  kandidater: readonly T[],
  args: RangerArgs<T>,
): T[] {
  const fusion = reciprocalRankFusion({
    ord: args.ord.map((o) => ({ id: o.id })),
    vektor: args.vektor.map((v) => ({ id: v.id })),
  });
  const orden = new Map(fusion.map((f, i) => [f.id, i]));

  return [...kandidater].sort((a, b) => {
    const A = args.præcise.has(a.id) ? 0 : 1;
    const B = args.præcise.has(b.id) ? 0 : 1;
    if (A !== B) return A - B;

    const fa = orden.get(a.id);
    const fb = orden.get(b.id);
    // BEGGE ukendte → videre til reserven. Kun ÉN ukendt → den kendte vinder.
    if (fa !== undefined || fb !== undefined) {
      if (fa !== fb) return (fa ?? Number.MAX_SAFE_INTEGER) - (fb ?? Number.MAX_SAFE_INTEGER);
    }
    return args.reserve ? args.reserve(a, b) : 0;
  });
}
