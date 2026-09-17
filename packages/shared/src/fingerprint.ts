/**
 * F275.6 — et fingerprint der kan sige «97 % samme dokument».
 *
 * ## Hvorfor en checksum ikke kan det her
 *
 * Christians eksempel: *«hvis der i PDF-filen kun er rettet på bytes … bortset fra
 * at der er et årstal eller en overskrift der er ændret.»* Ret ét årstal, og
 * SHA-256 er fuldstændig anderledes. Den exakte hash kan kun svare på ét
 * spørgsmål — «er de byte-identiske?» — og det er præcis det spørgsmål der ikke
 * hjælper her.
 *
 * Derfor MinHash: en lighedsmåling. Vi klipper teksten i overlappende stumper
 * («shingles»), tager den mindste hash i hver af K uafhængige familier, og
 * sammenligner de to signaturer. Andelen af pladser hvor de er ENS er et estimat
 * af Jaccard-ligheden mellem de to stump-mængder. Ret et årstal i et langt
 * dokument, og næsten alle stumper er uændret — signaturen flytter sig næsten
 * ikke.
 *
 * ## Hvad den ALDRIG må gøre: afgøre
 *
 * Christians eget eksempel er fælden, og den har ingen teknisk løsning: «kun
 * årstallet er ændret» er enten en RETTET TASTEFEJL eller NÆSTE ÅRS UDGAVE — og
 * de er 98 % ens i begge tilfælde. Enhver tærskel tager fejl af den ene, og den
 * fejl er TAVS: den ene bliver til en ny udgave der sletter forgængerens viden,
 * den anden til to konkurrerende værker.
 *
 * Så tærsklen herunder afgør ikke hvad der SKER. Den afgør kun om vi SPØRGER —
 * og vi spørger mennesket der lige har trukket filen ind, mens det stadig ved
 * svaret.
 */

/** Antal hash-familier i signaturen. 64 giver ±6 procentpoint på estimatet. */
export const MINHASH_K = 64;

/** Ord pr. stump. 5 er langt nok til at en enkelt ordændring kun rører 5 stumper. */
const SHINGLE = 5;

/**
 * Under dette er teksten for kort til at måle på. En signatur over tre ord siger
 * intet — og et estimat man ikke kan stole på er værre end ingen, fordi det ser
 * lige så meget ud som et man kan.
 */
const MIN_WORDS = 20;

/** 32-bit FNV-1a, seedet pr. familie. Ingen afhængigheder, samme svar overalt. */
function fnv1a(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Normalisér FØR vi klipper: småskriv, fjern tegnsætning, fold mellemrum.
 *
 * Det er med vilje aggressivt. To udgaver af samme PDF hvor den ene er
 * gen-eksporteret har ofte forskellig tegnsætning og linjeombrydning uden at ét
 * ord er ændret — og dét skal ikke tælle som en forskel.
 */
function ord(tekst: string): string[] {
  return tekst
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Byg fingeraftrykket. `null` når teksten er for kort til at måle på — «kunne
 * ikke måles» er en TREDJE tilstand og må aldrig degradere til «ny source».
 */
export function fingerprint(tekst: string | null | undefined): string | null {
  const o = ord(tekst ?? '');
  if (o.length < MIN_WORDS) return null;

  const stumper = new Set<string>();
  for (let i = 0; i + SHINGLE <= o.length; i++) {
    stumper.add(o.slice(i, i + SHINGLE).join(' '));
  }
  if (stumper.size === 0) return null;

  const sig = new Array<number>(MINHASH_K).fill(0xffffffff);
  for (const s of stumper) {
    for (let k = 0; k < MINHASH_K; k++) {
      const h = fnv1a(s, k);
      if (h < sig[k]!) sig[k] = h;
    }
  }
  // Fast bredde pr. plads, så to signaturer altid kan sammenlignes plads for
  // plads uden at parse. 8 hex-tegn × 64 = 512 tegn.
  return sig.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/**
 * Hvor ens er to fingerprint? `null` når mindst ét mangler.
 *
 * `null` betyder «vi kunne ikke måle», ALDRIG «de er forskellige». En scannet PDF
 * uden tekstlag har intet aftryk, og at læse det som «ny source» ville gøre netop
 * de filer vi ved mindst om til dem vi er mest sikre på.
 */
export function similarity(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  if (a.length !== MINHASH_K * 8 || b.length !== MINHASH_K * 8) return null;
  let ens = 0;
  for (let k = 0; k < MINHASH_K; k++) {
    if (a.slice(k * 8, k * 8 + 8) === b.slice(k * 8, k * 8 + 8)) ens++;
  }
  return ens / MINHASH_K;
}

/**
 * Over denne similarity SPØRGER vi. Den afgør ikke hvad der sker — se filens hoved.
 *
 * 0,85 er valgt så en rettet tastefejl, et nyt årstal eller en omskrevet
 * overskrift lander over, mens to selvstændige dokumenter om samme emne lander
 * under. Tallet må gerne justeres; det ændrer kun HVOR OFTE vi spørger, aldrig
 * hvad svaret bliver.
 */
export const ASK_ABOVE = 0.85;

/** De fire tilfælde, holdt fra hinanden fordi de kræver hver sin besked. */
export type NameVerdict =
  /** Høj similarity, samme navn — den almindelige «ny udgave». Spørg. */
  | 'new-edition'
  /** Høj similarity, ANDET navn — samme værk under nyt navn. Spørg. */
  | 'same-work-new-name'
  /** LAV similarity, SAMME navn — to værker slås om ét navn. Højeste alarm. */
  | 'name-collision'
  /** Lav similarity, andet navn — en ny source. Sig intet. */
  | 'new-source'
  /** Vi kunne ikke måle. Ikke det samme som «ny source». */
  | 'undecidable';

/**
 * Afgør hvilken af de fire sager vi står i.
 *
 * `sammeNavn` er en ADVARSELSLAMPE, ikke identiteten. Den vigtigste af de fire
 * er `name-collision`: to dokumenter der IKKE ligner hinanden men deler navn.
 * Med ejerens valg om at filnavn+Brain er identiteten, er det netop dér en
 * lydløs overskrivning ville ske — og den er usynlig bagefter.
 */
export function nameVerdict(
  lighedsgrad: number | null,
  sammeNavn: boolean,
  taerskel: number = ASK_ABOVE,
): NameVerdict {
  if (lighedsgrad === null) return 'undecidable';
  const ligner = lighedsgrad >= taerskel;
  if (ligner) return sammeNavn ? 'new-edition' : 'same-work-new-name';
  return sammeNavn ? 'name-collision' : 'new-source';
}
