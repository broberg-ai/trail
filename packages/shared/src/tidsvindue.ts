/**
 * F273.1 — «hvad lærte jeg mellem X og Y», oversat til noget databasen kan svare på.
 *
 * Ejeren tænker i dansk tid. Motoren gemmer i UTC. Mellem de to ligger den
 * fejl der ikke ligner en fejl: **en tid uden zone bliver læst i læserens egen
 * zone, lydløst.** Spørger man om kl. 16 og får kl. 14, ser svaret rigtigt ud
 * — der KOMMER rækker, de er bare fra det forkerte tidsrum.
 *
 * ## Hvorfor der sammenlignes som TEKST
 *
 * `documents.created_at` er en TEXT-kolonne med SQLites `datetime('now')`,
 * altså `YYYY-MM-DD HH:MM:SS` i UTC. Målt 15/9 2026 på produktion, tre Brains
 * i to tenants: **1.574 af 1.574 rækker har præcis den form.** Ensartet, så en
 * leksikografisk sammenligning er korrekt — formatet er stort-endian og
 * nulpolstret.
 *
 * `updated_at` er den samme kolonnetype og er **IKKE** ensartet: 287 rækker
 * står som ISO-med-Z (`2026-09-15T15:34:27.761Z`) og 341 som naive. De to
 * former sorterer ikke ens (`T` > mellemrum), så en tekstsammenligning på
 * `updated_at` ville tie og svare forkert for hver tredje række. Derfor
 * filtrerer vi på `created_at` og kun den.
 *
 * ## Hvorfor der ikke lægges «to timer» til
 *
 * Danmark er UTC+1 om vinteren (CET) og UTC+2 om sommeren (CEST). Et
 * hardkodet `+02:00` er en fejl med et halvt års lunte: den er rigtig når den
 * skrives og forkert fra slutningen af oktober. Derfor slås forskydningen op
 * for det konkrete tidspunkt via zone-NAVNET.
 */

export const DANSK_ZONE = 'Europe/Copenhagen';

/**
 * Forskydningen mellem UTC og zonen PÅ det givne øjeblik, i millisekunder.
 * Positiv øst for Greenwich. Slås op frem for at antages, fordi den skifter
 * to gange om året.
 */
function forskydningMs(oejeblik: Date, zone: string): number {
  const dele = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(oejeblik);
  const f = (t: string) => Number(dele.find((d) => d.type === t)?.value);
  // `hour12: false` giver 24 for midnat i nogle runtimes — normalisér.
  const time = f('hour') === 24 ? 0 : f('hour');
  const somUtc = Date.UTC(f('year'), f('month') - 1, f('day'), time, f('minute'), f('second'));
  return somUtc - oejeblik.getTime();
}

/** `YYYY-MM-DD` eller `YYYY-MM-DDTHH:MM[:SS]` (mellemrum tilladt i stedet for T). */
const VAEGUR = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

export type Vaegur = { aar: number; maaned: number; dag: number; time: number; minut: number; sekund: number };

/** Læser en dansk vægur-tekst. Returnerer null hvis den ikke har formen. */
export function laesVaegur(tekst: string, standardTid: 'start' | 'slut'): Vaegur | null {
  const m = VAEGUR.exec(tekst.trim());
  if (!m) return null;
  const [, aar, maaned, dag, time, minut, sekund] = m;
  const kunDato = time === undefined;
  const v: Vaegur = {
    aar: Number(aar),
    maaned: Number(maaned),
    dag: Number(dag),
    // En bar dato betyder HELE dagen i dansk tid: fra 00:00:00 til 23:59:59.
    // Uden det ville `to=2026-09-10` udelukke alt efter midnat den dag —
    // altså hele dagen man bad om.
    time: kunDato ? (standardTid === 'start' ? 0 : 23) : Number(time),
    minut: kunDato ? (standardTid === 'start' ? 0 : 59) : Number(minut),
    sekund: kunDato ? (standardTid === 'start' ? 0 : 59) : Number(sekund ?? '0'),
  };
  if (v.maaned < 1 || v.maaned > 12 || v.dag < 1 || v.dag > 31) return null;
  if (v.time > 23 || v.minut > 59 || v.sekund > 59) return null;
  // Fanger 31. februar: runder datoen af, er dagen ikke den vi bad om.
  const proeve = new Date(Date.UTC(v.aar, v.maaned - 1, v.dag));
  if (proeve.getUTCMonth() !== v.maaned - 1 || proeve.getUTCDate() !== v.dag) return null;
  return v;
}

/**
 * Dansk vægur → det øjeblik det peger på.
 *
 * To gennemløb, fordi forskydningen afhænger af øjeblikket og øjeblikket af
 * forskydningen. Første gæt bruger forskydningen ved det tidspunkt læst som
 * UTC; andet retter med forskydningen ved det gæt. Det konvergerer overalt
 * undtagen i selve skiftetimerne, hvor der ikke FINDES et entydigt svar:
 * den sidste søndag i marts springer 02:00-03:00 over, og den sidste søndag i
 * oktober har 02:00-03:00 to gange. Vi lander på et fornuftigt øjeblik og
 * påstår ikke andet — for en filtergrænse er en times tvetydighed to gange om
 * året acceptabelt, men det skal stå her frem for at blive opdaget.
 */
export function vaegurTilOejeblik(v: Vaegur, zone: string = DANSK_ZONE): Date {
  const somUtc = Date.UTC(v.aar, v.maaned - 1, v.dag, v.time, v.minut, v.sekund);
  const gaet = new Date(somUtc - forskydningMs(new Date(somUtc), zone));
  return new Date(somUtc - forskydningMs(gaet, zone));
}

/** Et øjeblik → den naive UTC-nøgle `created_at` er skrevet med. */
export function tilUtcNoegle(oejeblik: Date): string {
  return oejeblik.toISOString().slice(0, 19).replace('T', ' ');
}

export type Tidsvindue = {
  /** Sammenligningsnøglerne, i samme form som `documents.created_at`. */
  fraNoegle?: string;
  tilNoegle?: string;
  /** Det OPLØSTE vindue, tilbage i dansk tid — så et tomt svar kan skelnes
   *  fra en dato der blev misforstået. */
  opløst: { fra: string | null; til: string | null; zone: string };
};

export type VindueSvar = { ok: true; vindue: Tidsvindue } | { ok: false; fejl: string };

/**
 * Oversætter `from`/`to` som brugeren skrev dem til de nøgler databasen
 * forstår — og til en læselig kvittering på hvad der faktisk blev spurgt om.
 *
 * Et ugyldigt input er en FEJL, ikke et tomt vindue. «Jeg forstod ikke din
 * dato» og «der er ingenting i det tidsrum» må aldrig ligne hinanden.
 */
export function byggTidsvindue(
  fra: string | undefined,
  til: string | undefined,
  zone: string = DANSK_ZONE,
): VindueSvar {
  const vFra = fra === undefined || fra === '' ? null : laesVaegur(fra, 'start');
  const vTil = til === undefined || til === '' ? null : laesVaegur(til, 'slut');

  if (fra && !vFra) return { ok: false, fejl: `Ugyldig 'from': ${fra}. Forventet YYYY-MM-DD eller YYYY-MM-DDTHH:MM (dansk tid).` };
  if (til && !vTil) return { ok: false, fejl: `Ugyldig 'to': ${til}. Forventet YYYY-MM-DD eller YYYY-MM-DDTHH:MM (dansk tid).` };

  const oFra = vFra ? vaegurTilOejeblik(vFra, zone) : null;
  const oTil = vTil ? vaegurTilOejeblik(vTil, zone) : null;

  if (oFra && oTil && oFra.getTime() > oTil.getTime()) {
    return { ok: false, fejl: `'from' ligger efter 'to'.` };
  }

  return {
    ok: true,
    vindue: {
      fraNoegle: oFra ? tilUtcNoegle(oFra) : undefined,
      tilNoegle: oTil ? tilUtcNoegle(oTil) : undefined,
      opløst: {
        fra: oFra ? formatDansk(oFra, zone) : null,
        til: oTil ? formatDansk(oTil, zone) : null,
        zone,
      },
    },
  };
}

/** `2026-09-10 16:00:00` som det ser ud i zonen — kvitteringen til brugeren. */
export function formatDansk(oejeblik: Date, zone: string = DANSK_ZONE): string {
  const dele = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(oejeblik);
  return dele.replace('T', ' ');
}
