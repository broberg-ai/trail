/**
 * F222.8 — ingen enkelt forespørgsel må hente ET HELT KB's tekst.
 *
 * F222.3 flyttede kundedatabaserne til `trail-db-001` (sqld over HTTP), og
 * dermed fik hver forespørgsel en grænse den lokale fil ikke havde.
 *
 * MÅLT 21. september 2026 på maskinen (`sqld --help`, sqld 0.24.33):
 *
 *     --max-response-size        [default: 10MB]
 *     --max-total-response-size  [default: 32MB]
 *
 * Ingen af dem sættes i `apps/db/start.sh`, og `printenv SQLD_MAX_RESPONSE_SIZE`
 * svarer exit 1 på maskinen — vi kører altså standarden.
 *
 * HVORFOR DENNE PRØVE MÅLER KILDEN OG IKKE EN KØRSEL. Lokalt findes grænsen
 * ikke: en scanning der henter alt vil altid lykkes på en udviklermaskine. En
 * prøve der kørte scanningen og så at den lykkedes, ville derfor være grøn både
 * før og efter rettelsen — den samme grønne retning fejlen kom fra. Så prøven
 * måler den egenskab der faktisk holder i produktionen: *ingen forespørgsel
 * beder om et helt KB's tekst på én gang.*
 *
 * Reglen selv bor i `scripts/audit-kb-content-scans.ts`, så den kan KØRES af et
 * menneske der skal migrere — ikke kun af det der hævder den.
 */
import { test, expect } from 'bun:test';
import { unboundedKbContentScans } from '../../scripts/audit-kb-content-scans.js';

/**
 * De NI kaldesteder målt 21. september 2026, før nogen blev migreret.
 * To af dem er brugervendte ruter (chat, graph).
 *
 * Listen kan kun KRYMPE. Den findes fordi alternativet var værre på en bestemt
 * måde: en vagt committet rød blokerer hver eneste udrulning ud af dette repo
 * for alle — også arbejde der intet har med F222.8 at gøre — og en port man skal
 * udenom for at komme videre, går man udenom.
 *
 * TALLET HAR VÆRET FORKERT TRE GANGE, og den historie er vigtigere end tallet:
 *
 *   20   `knowledgeBaseId` hvor som helst i sætningen — også i KOLONNE-listen.
 *        `contradiction-lint.ts` henter ét dokument på id og blev talt med.
 *   12   scopet skal stå i WHERE. Men en eksplicit `id IN (…)` bounder
 *        resultatet ved listens længde, og `search.ts` gør præcis det.
 *    9   nuværende tal.
 *
 * Hver rettelse kom af at LÆSE kaldestedet, aldrig af at læse reglen igen. Og
 * hver af dem fejlede i BEGGE retninger samtidig: den talte uskyldige med, og
 * den ville have sluppet et ægte fuld-KB-scan igennem hvis det var skrevet med
 * en variabel i stedet for kolonnenavnet.
 *
 * KONKLUSIONEN, og den ændrer kortets plan: **et regex over kildetekst kan ikke
 * svare på hvor mange rækker en forespørgsel giver.** Spørgsmålet afhænger af
 * data, ikke af hvordan forespørgslen er skrevet. Denne vagt er derfor
 * DEGRADERET til en hurtig «skriv ikke den form»-lint — nyttig, billig, og
 * ikke beviset.
 *
 * Det bærende instrument skal måle den ÆGTE svarstørrelse ved kørsel. Der er
 * ét sted at hænge det op: `openRemoteTenantDb` i `lib/tenant-pool.ts` pakker
 * libsql-klienten i `LibsqlTrailDatabase`, og hver eneste kundeforespørgsel
 * passerer dén. En måling dér kan ikke narres af hvordan forespørgslen er
 * formuleret, dækker både rå SQL og drizzle, og fanger et kaldested nummer ti
 * som ingen har tænkt på. Det er næste skridt på kortet.
 */
const KNOWN_9 = new Set([
  'apps/server/src/bootstrap/F102-seed-glossary-neurons.ts:94',
  'apps/server/src/routes/chat.ts:1083', //   BRUGERVENDT
  'apps/server/src/routes/graph.ts:113', //   BRUGERVENDT
  'apps/server/src/services/chat/mcp-router.ts:239',
  'apps/server/src/services/model-eval/runner.ts:154',
  'apps/server/src/services/glossary-backfill.ts:78',
  'apps/server/src/services/ingest.ts:962',
  'packages/core/src/lint/faded-heuristics.ts:36',
  'packages/core/src/ingest/candidate-api.ts:348',
]);

test("INGEN NY forespørgsel henter et helt KB's tekst på én gang", () => {
  const fresh = unboundedKbContentScans().filter((o) => !KNOWN_9.has(`${o.file}:${o.line}`));

  // Printed rather than counted, so a failure names the file to fix instead of
  // handing the next reader a number to go and re-derive.
  const report = fresh.map((o) => `  ${o.file}:${o.line}`).join('\n');

  expect(
    fresh.length === 0
      ? ''
      : `${fresh.length} NY ubegrænset fuld-KB scanning — brug den side-inddelte gennemløber:\n${report}`,
  ).toBe('');
});

test('listen KRYMPER — en migreret post skal fjernes, ikke blive stående', () => {
  // Without this, a migrated call site would leave a stale entry behind and the
  // list would stop describing reality — the same "looks like coverage" failure
  // the guard exists to prevent, one level up. It is also what caught my own
  // bad predicate: eight entries stopped matching the moment it was corrected.
  const live = new Set(unboundedKbContentScans().map((o) => `${o.file}:${o.line}`));
  const stale = [...KNOWN_9].filter((k) => !live.has(k));

  expect(
    stale.length === 0
      ? ''
      : `${stale.length} post(er) i KNOWN_9 rammer ingen kode længere — fjern dem:\n  ${stale.join('\n  ')}`,
  ).toBe('');
});

test('vagten kan overhovedet SE noget — ellers beviser den intet', () => {
  // The negative control for the guard itself. Without it, a regex that
  // silently stopped matching would make the tests above pass for the worst
  // possible reason: an empty list read as a clean repo.
  const live = unboundedKbContentScans();
  expect(live.length).toBeGreaterThan(0);
  expect(live.some((o) => o.file.includes('/routes/'))).toBe(true);
});
