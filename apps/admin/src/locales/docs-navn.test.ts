/**
 * F271.3 — dokumentationen kalder enheden et Brain, ikke «a Trail».
 *
 * F271.1 omdøbte admin-fladen. F271.4 fandt to tekster hardkodet i skærmkoden.
 * DENNE prøve dækker det tredje sted ordet bor: prosaen på docs.trailmem.com,
 * hvor 244 forekomster fordelt på 16 filer skulle læses én for én.
 *
 * DERFOR ER DEN EN LISTE OG IKKE ET MØNSTER. Et søg-erstat ville have ramt:
 *
 *   «A trail of which guidelines you have actually internalised»
 *      — det almindelige engelske ord, i en sætning om sporbarhed
 *   «the Trail icon» / «the Trail card»
 *      — browserudvidelsens ikon og dens kort i chrome://extensions
 *   «a Trail engine you can reach over HTTPS»
 *      — produktet, ikke enheden
 *   `trail.db`, `/api/v1/knowledge-bases/...`
 *      — filnavne og ruter, som IKKE er omdøbt
 *
 * Vurderingen er truffet én gang pr. sted ved at LÆSE sætningen, og listen
 * herunder er den vurdering skrevet ned så et menneske kan være uenig i den.
 */
import { test, expect } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `apps/docs` er BEVIDST udeladt af pnpm-workspacet (se pnpm-workspace.yaml:
 * `!apps/docs`), så en prøve placeret dér ville aldrig blive kørt af `pnpm
 * test` — den ville være teater. Vagten bor derfor sammen med de to andre
 * navne-vagter i admin og læser docs-filerne over mappegrænsen.
 */
const DOCS = new URL('../../../docs/content/docs/', import.meta.url).pathname;

/**
 * Hver post: filen, og det tekststykke hvor ordet betyder noget ANDET end
 * enheden. Tilføjer du en linje, påstår du at netop dén sætning handler om
 * produktet, om et teknisk navn, eller om det almindelige engelske ord.
 */
const IKKE_ENHEDEN: ReadonlyArray<[string, string]> = [
  ['web-clipper.md', 'Click the Trail icon'],
  ['web-clipper.md', 'the Trail server you'],
  ['web-clipper.md', 'on the Trail card'],
  ['concepts-connectors.md', 'not in a Trail Neuron'],
  ['quick-start.md', 'integration with a Trail engine'],
  ['quick-start.md', 'A Trail engine you can reach over HTTPS'],
  ['who-is-trail-for.md', 'A trail of which guidelines'],
  ['site-llm-with-trail-as-tool.md', 'the user has a Trail instance'],
  ['site-llm-with-trail-as-tool.md', 'A Trail tenant + KB'],
  ['widget.md', 'a Trail bearer key'],
  // «that» som HENVISENDE stedord, ikke som bestemmer. «a Source that Trail
  // compiles» er produktet som grundled i en ledsætning — grammatisk umuligt
  // at skelne fra «that Trail» med et mønster, så vurderingen står her.
  ['site-llm-with-trail-as-tool.md', "that Trail's KB authors"],
  ['site-llm-with-trail-as-tool.md', "that Trail couldn't answer"],
  ['web-clipper.md', 'that Trail compiles into Neurons'],
];

/** Ordet som ORD — ikke `trail.db`, ikke trailmem.com, ikke /trail/. */
const TRAIL_ORD = /\b[Tt]rails?\b/;

/**
 * Kendetegner enheds-brug: en bestemmer foran, eller flertal.
 *
 * `i`-flaget er BÆRENDE og blev fundet ved mutation. Uden det matchede kun
 * bestemmere med lille begyndelsesbogstav, så «**A** trail is a knowledge
 * base» — sætningen der beviste at navnet ikke forklarede sig selv, og altså
 * selve grunden til hele omdøbningen — stod grønt i starten af en sætning.
 * Et mønster der ikke fanger den vigtigste forekomst måler noget andet end
 * man tror.
 */
const ENHEDS_FORM = /\b(a|an|your|each|per|the|this|that|one|every|another|its|our|my)\s+trails?\b|\btrails\b/i;

function docsFiler(): string[] {
  return readdirSync(DOCS).filter((f) => f.endsWith('.md'));
}

function fundne(): Array<{ fil: string; linje: number; tekst: string }> {
  const fund: Array<{ fil: string; linje: number; tekst: string }> = [];
  for (const fil of docsFiler()) {
    readFileSync(join(DOCS, fil), 'utf8').split('\n').forEach((linje, i) => {
      // Kodeblokke og stier er tekniske navne, ikke prosa om enheden.
      // `trail.db` er et FILNAVN og er ikke omdøbt. Det står uden backticks i
      // frontmatter, så backtick-strippet alene fangede det ikke — og «one
      // trail.db» læste derfor som «one trail».
      const uden = linje
        .replace(/`[^`]*`/g, '')
        .replace(/\S*trailmem\.com\S*/g, '')
        .replace(/\btrail\.db\b/g, '');
      if (!TRAIL_ORD.test(uden) || !ENHEDS_FORM.test(uden)) return;
      if (IKKE_ENHEDEN.some(([f, t]) => fil === f && linje.includes(t))) return;
      fund.push({ fil, linje: i + 1, tekst: linje.trim() });
    });
  }
  return fund;
}

test('POSITIV KONTROL: prøven læser rigtige docs-filer og kan genkende formen', () => {
  // Uden den ville «0 fund» også bestå hvis stien var forkert — og en spærre
  // der ikke måler noget ser ud præcis som en der er grøn.
  const filer = docsFiler();
  expect(filer.length).toBeGreaterThan(10);
  expect(filer).toContain('concepts-kb.md');
  expect(ENHEDS_FORM.test('inside a Trail')).toBe(true);
  expect(ENHEDS_FORM.test('your Trail')).toBe(true);
  // NEGATIV kontrol på selve mønsteret: produktet som subjekt er ikke enheds-form.
  expect(ENHEDS_FORM.test('Trail compiles it into Neurons')).toBe(false);
});

test('docs-siden nævner Brain — ellers har omdøbningen ikke nået prosaen', () => {
  const kb = readFileSync(join(DOCS, 'concepts-kb.md'), 'utf8');
  expect(kb).toContain('A **Brain** is the unit of isolation');
  // Og den SIGER at API-stien ikke er omdøbt, så ingen tror endpointet flyttede.
  expect(kb).toContain('/api/v1/knowledge-bases/');
});

test('ingen docs-side kalder enheden «a Trail»', () => {
  const fund = fundne();
  const rapport = fund.map((f) => `  ${f.fil}:${f.linje}  ${f.tekst}`).join('\n');
  expect(fund.length, `enheds-brug af «Trail» i docs:\n${rapport}`).toBe(0);
});

test('undtagelserne PEGER PÅ NOGET — en død undtagelse skjuler at vagten er holdt op med at måle', () => {
  for (const [fil, tekst] of IKKE_ENHEDEN) {
    expect(readFileSync(join(DOCS, fil), 'utf8'), `${fil} indeholder ikke længere ${tekst}`).toContain(tekst);
  }
});
