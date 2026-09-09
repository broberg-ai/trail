/**
 * F265.9 — VEKTORERNE BOR I MOTORENS HUKOMMELSE.
 *
 * Målt 9/9 på prod, samme Trail (1.266 stykker), samme spørgsmål, 5 kørsler:
 *
 *   /retrieve  (kun ordmatch)        median 0,36 s
 *   /search    (ordmatch + vektorer) median 2,28 s
 *
 * De ~2 sekunder er `loadVectors`, som henter ALLE videnbasens vektorer ved
 * hver eneste forespørgsel — i sider af 200 (F265.4), over netværket til
 * DB-maskinen (F222.3). 1.266 vektorer = 7 rundture; 11.017 = 56, målt til op
 * mod 98 s under belastning.
 *
 * Vektorerne ændrer sig kun når noget bliver indekseret. At hente dem forfra
 * ved hver søgning er at betale for et opslag der har samme svar hver gang.
 *
 * HVORFOR ET LOFT OG IKKE BARE «HOLD DEM ALLE». Én vektor er 1.024 tal à 4
 * bytes = 4 KB. Målt på prod i dag: 14.158 vektorer i alt ≈ 58 MB, og motoren
 * har 1.024 MB. Det passer NU. Ved 30 kunder som Sanne (409 vektorer) er det
 * ~50 MB og stadig ingenting — men ved 30 som broberg-ai (13.749) er det
 * ~1,7 GB, og så er maskinen død. En cache uden loft er en cache der virker
 * indtil den kunde der vælter den melder sig.
 *
 * En forespørgsel bruger kun ÉN Trails vektorer. Derfor pr. Trail, med et
 * loft, og den Trail der længst ikke er brugt ryger først. 200 MB (ejerens
 * tal) = ~50.000 vektorer = alle nuværende kunder samtidig med god margin.
 *
 * HVORDAN DEN VED AT DEN ER FORÆLDET — og det er den farlige del, fordi en
 * forældet cache serverer et gammelt indeks I TAVSHED. Anden-dør-tjekket er
 * kørt FØRST: der er præcis TO skrivesteder til chunk_embeddings —
 * `storeEmbedding` her i filen og fejerens DELETE i indexer.ts — og
 * indekseringen kører i SAMME proces som søgningen (startIndexScheduler i
 * index.ts). Derfor ryddes cachen præcist ved skrivningen frem for at blive
 * gættet forældet med et ekstra opslag. Begge døre rydder, og hver dør har sin
 * egen prøve; rettes kun den ene, serverer vi et forældet indeks usynligt.
 *
 * GRÆNSEN, skrevet ned frem for opdaget: DEN HER ER KORREKT FORDI DER ER ÉN
 * MOTOR (trail-engine-001, count 1 — målt). Får vi to, invaliderer en
 * skrivning på motor A ikke motor B's cache. F222.6 handler netop om at få
 * flere maskiner — den dag skal cachen have et udløb eller en delt
 * invalidering. Det er ikke et problem i dag; det er en forudsætning.
 */

/** Én vektor-række som `loadVectors` leverer den. */
export interface CachetVektor {
  chunkId: string;
  documentId: string;
  vector: Float32Array;
}

/**
 * Loftet. ÉN kilde til tallet — prøverne og /health læser denne konstant, så
 * en ændring ikke kan komme til at gælde det ene sted og ikke det andet.
 * 200 MB er ejerens beslutning 9/9 2026.
 */
export const CACHE_LOFT_BYTES = 200 * 1024 * 1024;

interface Post {
  vektorer: CachetVektor[];
  bytes: number;
  /** Monotont løbenummer, ikke et ur: to opslag i samme millisekund skal
   *  kunne skelnes, ellers er «længst ikke brugt» tilfældig blandt dem. */
  sidstBrugt: number;
}

const cache = new Map<string, Post>();
let bytesIAlt = 0;
let ur = 0;

/** Tal til /health. Uden dem er «virker cachen?» et gæt. */
export const cacheTal = {
  traef: 0,
  forbier: 0,
  udsmidt: 0,
  ryddet: 0,
  // F265.12 — hvor mange skrivninger der blev holdt friske UDEN at koste en
  // fuld genindlæsning. Står ved siden af `ryddet`, fordi forholdet mellem de
  // to ER svaret på om rettelsen virker i drift: stiger `ryddet` igen, er en
  // skrivevej gået tilbage til at smide hele Trail'en væk.
  opdateret: 0,
  opvarmet: 0,
};

/**
 * Nøglen bærer MODELLEN.
 *
 * `loadVectors` filtrerer på `e.model = ?`, så to modeller giver to
 * forskellige svar for samme Trail. Uden modellen i nøglen ville et
 * modelskifte servere den gamle models vektorer under den nyes navn — og
 * cosinus mellem to modellers vektorer er meningsløs uden at være forkert på
 * nogen målbar måde (skemaets egen formulering, 0051).
 */
function noegle(tenantId: string, knowledgeBaseId: string, model: string): string {
  return `${tenantId}\u0000${knowledgeBaseId}\u0000${model}`;
}

/** Ægte bytes, ikke antal rækker: det er vektorerne der fylder. */
function maalBytes(vektorer: CachetVektor[]): number {
  let n = 0;
  for (const v of vektorer) {
    n += v.vector.byteLength + v.chunkId.length * 2 + v.documentId.length * 2;
  }
  return n;
}

export function hentFraCache(
  tenantId: string,
  knowledgeBaseId: string,
  model: string,
): CachetVektor[] | null {
  const p = cache.get(noegle(tenantId, knowledgeBaseId, model));
  if (!p) {
    cacheTal.forbier += 1;
    return null;
  }
  p.sidstBrugt = ++ur;
  cacheTal.traef += 1;
  return p.vektorer;
}

export function laegICache(
  tenantId: string,
  knowledgeBaseId: string,
  model: string,
  vektorer: CachetVektor[],
): void {
  const bytes = maalBytes(vektorer);
  // En enkelt Trail der er større end hele loftet cacher vi IKKE. Alternativet
  // — smide alt andet ud for at gøre plads til noget der stadig ikke passer —
  // ville tømme cachen ved hver forespørgsel og gøre alting langsommere end
  // uden cache overhovedet.
  if (bytes > CACHE_LOFT_BYTES) return;

  const k = noegle(tenantId, knowledgeBaseId, model);
  const gammel = cache.get(k);
  if (gammel) bytesIAlt -= gammel.bytes;

  cache.set(k, { vektorer, bytes, sidstBrugt: ++ur });
  bytesIAlt += bytes;

  // Smid den KOLDESTE Trail ud, ikke en tilfældig, og ikke enkelte vektorer:
  // en halv Trail i cachen ville give et halvt søgeresultat.
  while (bytesIAlt > CACHE_LOFT_BYTES) {
    let koldest: string | null = null;
    let koldestTid = Infinity;
    for (const [nk, np] of cache) {
      if (np.sidstBrugt < koldestTid) {
        koldestTid = np.sidstBrugt;
        koldest = nk;
      }
    }
    // Kan ikke ske — bytesIAlt > 0 kræver mindst én post — men en uendelig
    // løkke her ville fryse motoren, så den lukkes eksplicit frem for at
    // afhænge af at regnestykket altid holder.
    if (koldest === null) break;
    const p = cache.get(koldest)!;
    cache.delete(koldest);
    bytesIAlt -= p.bytes;
    cacheTal.udsmidt += 1;
  }
}

/**
 * F265.12 — EN NEURON DER SKRIVES MÅ IKKE KOSTE HELE TRAIL'EN.
 *
 * rydCache er KORREKT for friskhed og FOR GROV som pris: én ændret Neuron
 * smed 11.016 uændrede vektorer væk, og næste søgning betalte 16 sekunder på
 * at hente dem hjem fra databasemaskinen igen. Målt i drift, hvor auto-ingest
 * kører hvert 120. sekund — altså midt i brug, ikke kun efter et deploy.
 *
 * Her opdateres den ENE plads: erstat på chunkId hvis den findes, ellers
 * tilføj. Bytetællingen justeres, så loftet stadig håndhæves.
 *
 * TO TING DER GØR DEN SIKKER:
 *
 * 1. ER TRAIL'EN IKKE I CACHEN, GØR VI INTET. Vi bygger ALDRIG en delvis
 *    liste — en halv Trail i cachen ville give et halvt søgeresultat der
 *    ligner et helt. Næste opslag henter hele listen fra databasen, som i dag,
 *    og den indeholder så også den nye vektor.
 * 2. ANDRE MODELLERS lister for samme Trail ryddes. Vi bruger kun én model i
 *    dag, så det er i praksis en no-op — men det holder opførslen mindst lige
 *    så konservativ som rydCache var, frem for at antage at der kun findes én.
 *
 * SLETNING hører IKKE til her og bruger stadig rydCache: en fjernet vektor kan
 * ikke udtrykkes som en opdatering af én plads, og en cache der beholder en
 * slettet Neuron svarer selvsikkert med noget der ikke findes mere.
 */
export function opdaterICache(
  tenantId: string,
  knowledgeBaseId: string,
  model: string,
  vektor: CachetVektor,
): void {
  const praefix = `${tenantId}\u0000${knowledgeBaseId}\u0000`;
  const maal = noegle(tenantId, knowledgeBaseId, model);

  // Andre modeller for samme Trail: ryd, som før.
  for (const [k, p] of cache) {
    if (k.startsWith(praefix) && k !== maal) {
      cache.delete(k);
      bytesIAlt -= p.bytes;
      cacheTal.ryddet += 1;
    }
  }

  const post = cache.get(maal);
  if (!post) return; // ikke cachet — intet at holde frisk, og vi bygger ikke en halv liste

  const i = post.vektorer.findIndex((v) => v.chunkId === vektor.chunkId);
  if (i >= 0) post.vektorer[i] = vektor;
  else post.vektorer.push(vektor);

  const nyeBytes = maalBytes(post.vektorer);
  bytesIAlt += nyeBytes - post.bytes;
  post.bytes = nyeBytes;
  post.sidstBrugt = ++ur;
  cacheTal.opdateret += 1;

  // Voksede Trail'en ud over loftet, ryger den helt ud frem for at stå som en
  // delvis liste. Samme regel som laegICache: aldrig en halv Trail.
  if (post.bytes > CACHE_LOFT_BYTES) {
    cache.delete(maal);
    bytesIAlt -= post.bytes;
    cacheTal.udsmidt += 1;
    return;
  }

  while (bytesIAlt > CACHE_LOFT_BYTES) {
    let koldest: string | null = null;
    let koldestTid = Infinity;
    for (const [nk, np] of cache) {
      if (np.sidstBrugt < koldestTid) {
        koldestTid = np.sidstBrugt;
        koldest = nk;
      }
    }
    if (koldest === null) break;
    const p = cache.get(koldest)!;
    cache.delete(koldest);
    bytesIAlt -= p.bytes;
    cacheTal.udsmidt += 1;
  }
}

/**
 * Ryd en Trail. Kaldes ved BEGGE skrivesteder.
 *
 * Modellen er ikke med: en skrivning skal ramme Trailen uanset hvilken model
 * cachen tilfældigvis holder. At rydde for meget er en langsom søgning; at
 * rydde for lidt er et forkert svar.
 */
export function rydCache(tenantId: string, knowledgeBaseId: string): void {
  const praefix = `${tenantId}\u0000${knowledgeBaseId}\u0000`;
  for (const [k, p] of cache) {
    if (k.startsWith(praefix)) {
      cache.delete(k);
      bytesIAlt -= p.bytes;
      cacheTal.ryddet += 1;
    }
  }
}

/** Til /health — så vi kan SE om den virker frem for at tro det. */
export function cacheStatus(): {
  trails: number;
  bytes: number;
  loftBytes: number;
  traef: number;
  forbier: number;
  udsmidt: number;
  ryddet: number;
  opdateret: number;
  opvarmet: number;
} {
  return {
    trails: cache.size,
    bytes: bytesIAlt,
    loftBytes: CACHE_LOFT_BYTES,
    ...cacheTal,
  };
}

/** Kun til prøver — produktionen rydder pr. Trail, aldrig alt. */
export function nulstilCache(): void {
  cache.clear();
  bytesIAlt = 0;
  ur = 0;
  cacheTal.traef = 0;
  cacheTal.forbier = 0;
  cacheTal.udsmidt = 0;
  cacheTal.ryddet = 0;
}
