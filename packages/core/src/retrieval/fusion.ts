/**
 * F254.2 — flet to rangeringer sammen. Reciprocal-rank fusion.
 *
 * HVORFOR PÅ PLADS OG IKKE PÅ SCORE, og det er hele valget:
 *
 *   bm25 (FTS5)   negativ, ubegrænset nedad, skalaen afhænger af korpus
 *   cosinus       [-1, 1], skalaen er absolut
 *
 * De to tal betyder ikke det samme og kan ikke lægges sammen. En vægtet sum
 * kræver en kalibrering ingen kan efterprøve — og som skrider stille når
 * korpusset vokser, fordi bm25's skala flytter sig med det. Fusion på PLADS
 * kræver ingen kalibrering: den spørger kun «hvor højt rangerede hver halvdel
 * dette?», og det spørgsmål har samme betydning i begge lister.
 *
 * Formlen: score = Σ 1/(k + plads). k=60 er standardværdien fra Cormack m.fl.
 * (2009) og gør at forskellen mellem plads 1 og 2 ikke overdøver alt andet —
 * et dokument der ligger nummer 3 i BEGGE lister slår et der ligger nummer 1 i
 * én og mangler i den anden. Det er præcis den opførsel vi vil have: enighed
 * mellem to uafhængige metoder er stærkere end en enkelt metodes overbevisning.
 */
export interface Ranked {
  id: string;
  /** Metodens egen score. Bæres kun videre til visning — indgår IKKE i fusionen. */
  score?: number;
}

export interface FusedHit {
  id: string;
  fusedScore: number;
  /** Hvilke metoder fandt den, og på hvilken plads (1-indekseret). */
  ranks: Record<string, number>;
}

export const RRF_K = 60;

export function reciprocalRankFusion(
  lists: Record<string, readonly Ranked[]>,
  k = RRF_K,
): FusedHit[] {
  const acc = new Map<string, FusedHit>();

  for (const [metode, liste] of Object.entries(lists)) {
    liste.forEach((item, i) => {
      const plads = i + 1;
      const cur = acc.get(item.id) ?? { id: item.id, fusedScore: 0, ranks: {} };
      // FØRSTE FOREKOMST VINDER, OG DEN GIVER OGSÅ DEN ENESTE SCORE.
      //
      // Første udgave beskyttede kun `ranks` og lagde stadig point til for hver
      // gentagelse — så en liste med samme id tre gange kunne rykke sig selv
      // forbi et dokument begge metoder var enige om. Prøven fandt det.
      // Dubletter i en resultatliste er ikke teoretisk: FTS5 kan returnere
      // samme dokument via flere chunks.
      if (cur.ranks[metode] === undefined) {
        cur.ranks[metode] = plads;
        cur.fusedScore += 1 / (k + plads);
      }
      acc.set(item.id, cur);
    });
  }

  return [...acc.values()].sort((a, b) => {
    if (b.fusedScore !== a.fusedScore) return b.fusedScore - a.fusedScore;
    // Uafgjort brydes på ANTAL metoder der fandt den, derefter på id, så
    // rækkefølgen er deterministisk. En ustabil sortering gør en
    // regressions-måling umulig at læse.
    const na = Object.keys(a.ranks).length, nb = Object.keys(b.ranks).length;
    if (nb !== na) return nb - na;
    return a.id < b.id ? -1 : 1;
  });
}
