/**
 * F266.2 — drænet skal kunne tage støjen og lade modsigelserne stå.
 *
 * DEN BÆRENDE PÅSTAND ER EN NEGATIV: en contradiction må ALDRIG ryge med.
 * Målt hos Sanne 10/9: 330 ventende, heraf 73 contradiction. Uden typefilter
 * var valget «behold støjen» eller «smid en kundes ægte fund væk».
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const rute = readFileSync(new URL('./maintenance.ts', import.meta.url), 'utf8');

test('F266.2 DEN BÆRENDE: typefilteret anvendes EFTER scope-tællingen', () => {
  // Rækkefølgen bærer: tælles der efter filteret, kan «køen er tom» og
  // «filteret ramte intet» ikke skelnes — netop den fejl jeg selv gik i.
  const iScope = rute.indexOf('const iScope = await trail.db');
  const filter = rute.indexOf('if (kinds) filters.push(inArray(queueCandidates.kind');
  const matching = rute.indexOf('const matching = await trail.db');
  expect(iScope).toBeGreaterThan(-1);
  expect(filter).toBeGreaterThan(iScope);      // filteret kommer EFTER tællingen
  expect(matching).toBeGreaterThan(filter);    // og matching efter filteret
});

test('F266.2 svaret bærer BEGGE tal, så nul kan skelnes fra nul', () => {
  expect(rute).toContain('iScope: iScope.length,');
  expect(rute).toContain('scanned: matching.length,');
});

test('F266.2 UDEN kinds er opførslen uændret — den gamle sikkerhedsregel gælder', () => {
  // Ship-dark: et kald uden feltet må ramme præcis de samme rækker som før.
  expect(rute).toContain('const kinds = Array.isArray(body.kinds)');
  expect(rute).toContain('    : null;');
  // Filteret tilføjes KUN når kinds er sat.
  expect(rute).toContain('if (kinds) filters.push(');
  // Og lint-slukket-scopet er urørt.
  expect(rute).toContain("scope: kbId ? 'single-kb' : 'lint-disabled-kbs'");
});

test('F266.2 tomme og ikke-streng-værdier i kinds ignoreres', () => {
  // En klient der sender {kinds: []} eller {kinds: [null]} må ikke ende med
  // et filter der matcher ingenting og ser ud som «der var intet at rydde».
  expect(rute).toContain("k.length > 0");
});
