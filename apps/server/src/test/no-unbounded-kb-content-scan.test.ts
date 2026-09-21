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
 * HVAD DENNE PRØVE ER, OG HVAD DEN IKKE ER. Den er en billig
 * «skriv-ikke-den-form»-lint. Den er IKKE beviset, og det er en måling og
 * ikke en beskedenhed: tallet her var forkert fire gange (20 → 12 → 9 → 0
 * ægte), hver gang fundet ved at læse kaldestedet frem for reglen, og hver
 * fejl gik i BEGGE retninger — den talte uskyldige med, og den ville have
 * sluppet en ægte scanning igennem skrevet med en variabel i stedet for et
 * kolonnenavn. Grunden er ikke sjusk: **hvor mange rækker en forespørgsel
 * giver, afhænger af DATA, ikke af hvordan den er skrevet.**
 *
 * Det bærende instrument måler derfor det ægte svar ved kørsel —
 * `withResponseSizeGuard` i `@trail/db`, hængt op i `openRemoteTenantDb`, hvor
 * hver eneste kundeforespørgsel passerer.
 *
 * Reglen selv bor i `scripts/audit-kb-content-scans.ts`, så den kan KØRES af
 * et menneske der migrerer — ikke kun af det der hævder den.
 */
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unboundedKbContentScans } from '../../scripts/audit-kb-content-scans.js';

test("INGEN forespørgsel henter et helt KB's tekst på én gang", () => {
  const offenders = unboundedKbContentScans();

  // Printed rather than counted, so a failure names the file to fix instead of
  // handing the next reader a number to go and re-derive.
  const report = offenders.map((o) => `  ${o.file}:${o.line}`).join('\n');

  expect(
    offenders.length === 0
      ? ''
      : `${offenders.length} ubegrænset fuld-KB scanning — brug collectPaged/scanPaged:\n${report}`,
  ).toBe('');
});

test('vagten kan overhovedet SE mønstret — ellers beviser prøven ovenfor intet', () => {
  // The negative control USED to assert that the live scan found something.
  // That worked only while the repo still had offenders, and it would have
  // turned green-by-emptiness the moment the migration finished — the exact
  // false green this card is about, in the control itself.
  //
  // So it runs the detector against a synthetic source file instead. Now the
  // control keeps working at zero, which is precisely when it is needed.
  const dir = mkdtempSync(join(tmpdir(), 'f222-8-guard-'));
  writeFileSync(
    join(dir, 'offender.ts'),
    [
      'const rows = await trail.db',
      '  .select({ id: documents.id, content: documents.content })',
      '  .from(documents)',
      '  .where(and(eq(documents.knowledgeBaseId, kbId), eq(documents.archived, false)))',
      '  .all();',
    ].join('\n'),
  );

  const found = unboundedKbContentScans([{ path: dir, floor: 1 }]);
  expect(found.length).toBe(1);
  // Line 2 — the statement is anchored at `.select({`, not at the `const`
  // that assigns it. Worth asserting rather than just counting: a detector
  // that reported the wrong line would send the next reader to the wrong
  // place, and a bare count cannot tell the difference.
  expect(found[0]!.line).toBe(2);
});

test('vagten TIER om en forespørgsel der er bundet — ellers larmer den på alt', () => {
  // The other half of the control: a detector that flags everything would
  // also pass the test above.
  const dir = mkdtempSync(join(tmpdir(), 'f222-8-guard-ok-'));
  writeFileSync(
    join(dir, 'bounded.ts'),
    [
      'const paged = await collectPaged(',
      '  (cursor, limit) =>',
      '    trail.db',
      '      .select({ id: documents.id, content: documents.content })',
      '      .from(documents)',
      '      .where(and(eq(documents.knowledgeBaseId, kbId), gt(documents.id, cursor)))',
      '      .orderBy(asc(documents.id))',
      '      .limit(limit)',
      '      .all(),',
      '  (r) => r.id,',
      ');',
      '',
      'const one = await trail.db',
      '  .select({ content: documents.content })',
      '  .from(documents)',
      '  .where(and(eq(documents.knowledgeBaseId, kbId), eq(documents.filename, f)))',
      '  .get();',
    ].join('\n'),
  );

  expect(unboundedKbContentScans([{ path: dir, floor: 1 }])).toEqual([]);
});
