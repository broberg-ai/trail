/**
 * F275.2 — de TO kontakter: «en ny udgave af samme source bliver automatisk kanon».
 *
 * Christian, 16. september 2026, ordret: *«Det lyder virkelig klogt at der både er
 * en på en brain og en på en connector. Vi sætter dem begge to default on så samme
 * source med ny indmad bliver ny kanon.»*
 *
 * ## Hvorfor to og ikke én
 *
 * En Brain som CB-M1 modtager BÅDE hjemmeside-sync OG manuelle uploads. Ét valg for
 * hele hjernen ville nødvendigvis være forkert for den ene af dem: en rettet side er
 * altid en ny udgave, mens en upload lige så godt kan være et TILLÆG. Derfor er
 * Brain-kontakten hovedafbryderen og konnektor-kontakten den præcise.
 *
 * ## Hierarkiet er entydigt, og det går kun én vej
 *
 *   Brain FRA  ⇒  ingen konnektor afløser, uanset sin egen kontakt.
 *   Brain TIL  ⇒  konnektorens egen kontakt afgør.
 *
 * Derfor returnerer resolveren en GRUND og ikke bare et ja/nej: en konnektor-kontakt
 * der står på TIL men er sat ud af kraft af Brain-kontakten SKAL kunne ses som netop
 * det i produktet. En kontakt der ser aktiv ud uden at virke er værre end ingen
 * kontakt — brugeren tror han har slået noget til.
 *
 * ## Fraværet betyder TIL, ikke «ved ikke»
 *
 * Vi gemmer de SLUKKEDE konnektorer, ikke de tændte. Det er den eneste måde hvorpå en
 * konnektor der aldrig er set før automatisk står TIL — som ejeren har bestemt — uden
 * at nogen skal huske at oprette en række for den. Gemte vi de tændte, ville en frisk
 * konnektor være FRA indtil nogen rørte den, og ingen ville kunne se hvorfor.
 *
 * Bemærk at dette er en ANDEN tredje-tilstand end `source-identity.ts`'s: dér betyder
 * `null` «vi ved ikke hvilken source det er», og tvivlen falder ud til MODSIGELSE.
 * Her er der ingen tvivl — ejeren har afgjort standarden, og fraværet ER standarden.
 */

/** Hvorfor en ny udgave afløser — eller ikke. */
export type CanonReason = 'til' | 'brain-off' | 'connector-off';

export interface CanonSwitches {
  /** Hovedafbryderen på Brain'en. Default `true`. */
  brain: boolean;
  /** Konnektor-id'er der er slået FRA i netop denne Brain. Alle andre er TIL. */
  disabledConnectors: string[];
}

export interface CanonVerdict {
  kanon: boolean;
  grund: CanonReason;
}

/**
 * Læs kolonnen `canon_off_connectors` (JSON-liste) tilbage til et array.
 *
 * Fejler parsingen, eller er indholdet ikke en liste af strenge, returnerer vi en
 * TOM liste — altså «ingen er slukket», som er default-tilstanden. Det er med vilje:
 * en ødelagt værdi må ikke kunne SLUKKE noget lydløst. Den forkerte retning at fejle
 * i ville være at behandle vrøvl som «alt er slukket».
 */
export function readDisabledConnectors(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

/** Skriv listen tilbage. Tom liste gemmes som `null` så en urørt Brain står ren. */
export function writeDisabledConnectors(ids: string[]): string | null {
  const rene = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.trim().length > 0))).sort();
  return rene.length === 0 ? null : JSON.stringify(rene);
}

/**
 * Afgør om en ny udgave fra `konnektor` skal afløse den forrige i denne Brain.
 *
 * `konnektor` må være `null` — 4 af broberg.ai's 70 råkilder bærer ingen. Så afgør
 * Brain-kontakten alene. Det er det sikre valg: en ukendt konnektor får aldrig sin
 * egen skjulte undtagelse, den følger hovedafbryderen.
 */
export function newEditionIsCanon(
  kontakter: CanonSwitches,
  konnektor: string | null | undefined,
): CanonVerdict {
  if (!kontakter.brain) return { kanon: false, grund: 'brain-off' };
  const id = (konnektor ?? '').trim();
  if (id && kontakter.disabledConnectors.includes(id)) {
    return { kanon: false, grund: 'connector-off' };
  }
  return { kanon: true, grund: 'til' };
}

/**
 * Hvad UI'et skal vise for ÉN konnektor-række.
 *
 * `overriddenByBrain` er hele grunden til at denne funktion findes frem for at UI'et
 * regner det ud selv: kontakten står på TIL, og effective alligevel ikke. Regnede
 * panelet det ud på egen hånd, ville de to sites kunne komme til at være uenige —
 * og uenigheden ville vise sig som en kontakt der lyver.
 */
export function connectorState(
  kontakter: CanonSwitches,
  konnektor: string,
): { ownSwitch: boolean; overriddenByBrain: boolean; effective: boolean } {
  const ownSwitch = !kontakter.disabledConnectors.includes(konnektor);
  return {
    ownSwitch,
    overriddenByBrain: ownSwitch && !kontakter.brain,
    effective: newEditionIsCanon(kontakter, konnektor).kanon,
  };
}

/**
 * F275.5 — forbeholdet der følger en side hvis source har fået en ny udgave.
 *
 * Teksten står ÉT sted fordi den skal ind i to sammenhænge — svar-konteksten
 * til chatten og hentnings-API'et til tredjepart — og fordi den er en PÅSTAND
 * om hvor pålidelig siden er lige nu. To formuleringer ville før eller siden
 * blive uenige om hvor stærkt forbeholdet var.
 *
 * Den siger hvad der er sket og hvad det betyder, ikke at siden er forkert:
 * en side hvis source er rettet ER som regel stadig mest real. Den er bare
 * ikke set after.
 */
export function sourceChangedCaveat(naar: number | null | undefined): string | null {
  if (!naar) return null;
  const dato = new Date(naar).toLocaleDateString('da-DK', {
    day: 'numeric',
    month: 'long',
    // Serveren kører UTC. Uden zone-NAVNET ville en ændring kl. 00:30 dansk tid
    // blive skrevet som dagen før — og kun i det vindue hvor ingen kigger.
    timeZone: 'Europe/Copenhagen',
  });
  return (
    `⚠️ Kilden bag denne side fik en ny udgave den ${dato}, og siden er ikke skrevet om siden. ` +
    `Behandl indholdet som muligvis forældet og sig det videre — svar aldrig som om det er bekræftet mod den nyeste source.`
  );
}
