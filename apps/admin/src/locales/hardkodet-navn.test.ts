/**
 * F271.2 — hullet i F271, fundet ved at KIGGE PÅ SKÆRMEN.
 *
 * F271.1 omdøbte enheden fra «a Trail» til «a Brain» og vogter det med
 * brain-navn.test.ts. Den prøve læser `en.json` og `da.json` — altså de 71
 * nøgler. Den kunne aldrig have fanget en tekst der er skrevet DIREKTE ind i
 * en skærm-fil, for den kigger ikke der.
 *
 * To sådanne slap igennem og stod synligt i produktet i fem dage:
 *
 *   wiki-tree.tsx  «No Neurons yet. … to grow this Trail.»
 *   activity.tsx   gruppefilterets mærkat 'Trail'
 *
 * Den første var værre end et navn: den var hardkodet på ENGELSK og skyggede
 * derfor for `wikiTree.empty`, som allerede fandtes oversat. En dansk bruger
 * fik en engelsk sætning på en ellers dansk side, og ingen nøgle at rette den i.
 *
 * DENNE PRØVE LÆSER KILDEKODEN, ikke oversættelserne. Den er med vilje en
 * LISTE og ikke et mønster: «Trail» i produkt-betydning er helt legitimt
 * («Sign in to Trail», `document.title`), og et mønster ville skulle gentage
 * den vurdering hver gang det kørte. Vurderingen er truffet én gang pr. sted
 * og kan læses af et menneske.
 */
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROD = new URL('../', import.meta.url).pathname; // apps/admin/src/

/**
 * De steder hvor ordet «Trail» i en hardkodet streng betyder PRODUKTET og
 * derfor skal blive stående. Formen er `fil:tekststump`.
 *
 * Tilføjer du en linje her, siger du at netop dén tekst handler om produktet.
 * Det er en påstand et menneske skal kunne læse og være uenig i.
 */
const PRODUKT_STEDER: ReadonlyArray<[string, string]> = [
  ['app.tsx', "'Trail · Admin'"],
  ['panels/settings-account.tsx', 'og åbn Trail derfra'],
  ['panels/settings-account.tsx', 'then open Trail from there'],
  ['panels/play.tsx', 'ported to use trail accent colour'],
];

/**
 * Strenge hvor «trail» er en TEKNISK identifikator — et cookie-navn, en
 * header, en lagringsnøgle. Intet menneske læser dem, så de omdøbes ikke:
 * cookie-navnet er en kontrakt med serveren, og at ændre det ville logge
 * enhver bruger ud for en kosmetisk gevinst.
 *
 * Holdt ADSKILT fra PRODUKT_STEDER med vilje. De to lister svarer på hvert
 * sit spørgsmål — «betyder ordet produktet her?» og «er dette overhovedet
 * tekst nogen ser?» — og en fælles liste ville skjule hvilket af dem der
 * blev stillet.
 */
const TEKNISKE_STEDER: ReadonlyArray<[string, string]> = [
  ['app.tsx', 'trail-return-to='],
];

function tsxFiler(dir: string, ud: string[] = []): string[] {
  for (const navn of readdirSync(dir)) {
    const sti = join(dir, navn);
    if (statSync(sti).isDirectory()) {
      if (navn === 'locales' || navn === 'node_modules') continue;
      tsxFiler(sti, ud);
    } else if (navn.endsWith('.tsx')) {
      ud.push(sti);
    }
  }
  return ud;
}

/** En hardkodet tekststreng i kilden — enkelt- eller dobbeltciteret. */
const STRENG = /'([^'\\\n]{2,200})'|"([^"\\\n]{2,200})"/g;
/**
 * Ordet som ORD. `\b` i begge ender, og intet andet.
 *
 * Første udgave skrev `($|[^\w/@.-])` i halen for at undgå `trail.noget` og
 * `trailmem.com`. Den udelukkede dermed også en sætning der ENDER på ordet —
 * «… to grow this Trail.» — altså præcis den ene tekst vagten blev skrevet
 * for. Målt: mutationen der satte den tilbage forblev grøn to gange.
 *
 * `\b` klarer begge de tilfælde der bekymrede mig: «trailmem» har ingen
 * ordgrænse efter «trail», og «@trail/shared» er en sti, som filtreres væk
 * nedenfor på at den er mellemrumsfri med et sti-tegn.
 */
const TRAIL_ORD = /\b[Tt]rails?\b/;

function fundne(): Array<{ fil: string; tekst: string }> {
  const fund: Array<{ fil: string; tekst: string }> = [];
  for (const sti of tsxFiler(ROD)) {
    const rel = sti.slice(ROD.length);
    for (const linje of readFileSync(sti, 'utf8').split('\n')) {
      // Importer og stier er ikke brugertekst.
      if (/^\s*(import|export)\s/.test(linje)) continue;
      // KOMMENTARER ER HELLER IKKE. Første udgave af denne prøve flagede fire
      // steder — alle fire var kommentarer eller JSDoc («no such Trail», «"New
      // trail" CTA opens …»). De skal blive stående: de beskriver historik og
      // identifikatorer, og en vagt der råber ulv på dem bliver slået fra, og
      // så fanger den heller ikke den næste ægte. Identifikatorer som
      // NewTrailModal omdøbes ikke — kun det et menneske LÆSER på skærmen.
      if (/^\s*(\/\/|\*|\/\*)/.test(linje)) continue;
      for (const m of linje.matchAll(STRENG)) {
        const tekst = m[1] ?? m[2] ?? '';
        if (!TRAIL_ORD.test(tekst)) continue;
        // En sti, et id eller en nøgle — ikke skærmtekst. Kendetegnet er at
        // den har INGEN MELLEMRUM **og** bærer et sti-tegn.
        //
        // De to led er begge lært af en mutation der forblev grøn:
        //
        //  · «kun ét token» alene slugte `label: 'Trail'` — gruppefilterets
        //    mærkat midt på Activity-skærmen. Et enkelt ord er ofte præcis
        //    dét et mærkat ER.
        //  · «indeholder et punktum» alene slugte hele sætningen «No Neurons
        //    yet. … to grow this Trail.» — for sætninger ender i punktum.
        //
        // Begge fejlede i den GRØNNE retning, og begge blev fundet ved at
        // sætte den ægte fejl tilbage og se om vagten opdagede den. En vagt
        // der ikke er prøvet sådan, måler noget andet end man tror.
        if (!/\s/.test(tekst) && /[/@.:-]/.test(tekst)) continue;
        if (PRODUKT_STEDER.some(([f, t]) => rel === f && (tekst.includes(t) || `'${tekst}'` === t))) continue;
        if (TEKNISKE_STEDER.some(([f, t]) => rel === f && tekst.includes(t))) continue;
        fund.push({ fil: rel, tekst });
      }
    }
  }
  return fund;
}

test('POSITIV KONTROL: prøven kan overhovedet finde en hardkodet streng', () => {
  // Uden den ville «0 fund» også bestå hvis filsøgningen eller regexen var gal
  // — præcis den fejlform vagten findes for.
  const alle = tsxFiler(ROD);
  expect(alle.length).toBeGreaterThan(20);
  expect(alle.some((f) => f.endsWith('panels/wiki-tree.tsx'))).toBe(true);
  const kilde = readFileSync(join(ROD, 'app.tsx'), 'utf8');
  expect(TRAIL_ORD.test('Trail · Admin')).toBe(true);
  expect(kilde).toContain('Trail · Admin');
});

test('ingen hardkodet skærmtekst siger «Trail» i ENHEDS-betydning', () => {
  const fund = fundne();
  const rapport = fund.map((f) => `  ${f.fil}: «${f.tekst}»`).join('\n');
  expect(fund.length, `hardkodet Trail-tekst uden for locales:\n${rapport}`).toBe(0);
});

test('undtagelserne PEGER PÅ NOGET — en død undtagelse skjuler at vagten er holdt op med at måle', () => {
  for (const [fil, tekst] of [...PRODUKT_STEDER, ...TEKNISKE_STEDER]) {
    const kilde = readFileSync(join(ROD, fil), 'utf8');
    expect(kilde, `${fil} indeholder ikke længere ${tekst}`).toContain(tekst.replace(/^'|'$/g, ''));
  }
});
