/**
 * F265.2 — KANDIDAT-PULJEN ER STØRRE END SVARET.
 *
 * Fejlen målt på prod: alle fire kandidat-kilder blev hentet med brugerens
 * `limit`, og først derefter fusioneret. Så «giv mig 5» kasserede det rigtige
 * dokument FØR de to søgemetoder kunne blive enige om det.
 *
 *   limit=5   det rigtige svar er slet ikke med
 *   limit=10  det rigtige svar er nummer ET
 *
 * Prøverne her læser RUTENS EGEN KILDETEKST, fordi det er kaldestederne der
 * bærer fejlen — en prøve på fusionsfunktionen alene ville have været grøn
 * hele vejen igennem, præcis som den var før.
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const rute = readFileSync(new URL('./search.ts', import.meta.url), 'utf8');

test('F265.2 DEN BÆRENDE: ingen kandidat-kilde hentes med brugerens limit', () => {
  // Præcis de fire kald der var fejlen. Står ét af dem tilbage med `limit`,
  // kan det gode dokument stadig blive kasseret før fusionen.
  expect(rute).toContain('trail.searchDocuments(ftsQuery, kbId, tenant.id, kandidater)');
  expect(rute).toContain('trail.searchChunks(ftsQuery, kbId, tenant.id, kandidater)');
  expect(rute).toContain('trail.searchUserNotes(query, kbId, tenant.id, kandidater)');
  expect(rute).toContain('vectorSearch(trail, tenant.id, kbId, query, kandidater)');

  expect(rute).not.toContain('trail.searchDocuments(ftsQuery, kbId, tenant.id, limit)');
  expect(rute).not.toContain('vectorSearch(trail, tenant.id, kbId, query, limit)');
});

test('F265.2 puljen er STØRRE end svaret — ellers er der intet vundet', () => {
  // Et loft er nødvendigt (et svar må ikke koste en fuld korpus-gennemgang),
  // men et loft der er LIG limit ville genindføre fejlen i tavshed.
  const m = rute.match(/const kandidater = ([^;]+);/);
  expect(m).not.toBeNull();
  const udtryk = m![1]!;
  for (const limit of [1, 5, 10, 20, 50]) {
    // eslint-disable-next-line no-eval
    const k = eval(udtryk.replace(/\blimit\b/g, String(limit))) as number;
    expect(k).toBeGreaterThan(limit);
    expect(k).toBeLessThanOrEqual(250); // loftet holder
  }
});

test('F265.2 puljen skæres ned EFTER filtrene, ikke før', () => {
  // Skæres der før, kan et tag- eller publikums-filter efterlade færre træf
  // end der blev bedt om, mens der stadig ligger gode kandidater i puljen.
  const iFilter = rute.indexOf('isVisibleToAudience(audience');
  const iSkaer = rute.indexOf('filtered = filtered.slice(0, limit)');
  expect(iFilter).toBeGreaterThan(-1);
  expect(iSkaer).toBeGreaterThan(iFilter);
});

test('F265.2 stykkerne skæres OGSÅ ned — begge return-grene', () => {
  // Stykkerne hentes nu fra den store pulje. Uden afkortningen ville et svar
  // på «giv mig 5» bære op mod 250 tekststykker — præcis den token-regning
  // F265.3 fjernede. Begge grene, fordi includeContent ikke må afgøre det.
  const antal = rute.split('chunks.slice(0, limit)').length - 1;
  expect(antal).toBe(2);
});

// ── F265.2, anden halvdel: den SMALLE forespørgsel som ekstra signal ───────

import { buildFtsQuery } from '@trail/shared';
import { rangerKandidater } from '@trail/core';

test('F265.2 AND-formen kræver HVERT ord — det er hele forskellen fra OR', () => {
  const q = 'dobbeltlevering beskeder sessioner';
  expect(buildFtsQuery(q, { operator: 'AND' })).toBe(
    '"dobbeltlevering"* AND "beskeder"* AND "sessioner"*',
  );
  expect(buildFtsQuery(q)).toContain(' OR ');
});

test('F265.2 DEN BÆRENDE: AND-formen udvider ALDRIG med synonymer', () => {
  // Udvidelsen tilføjer de ord et dokument SANDSYNLIGVIS bruger. Kræver man
  // dem alle, kræver man at teksten indeholder hvert gæt på et synonym — og
  // så giver den smalle forespørgsel nul træf på næsten alt. Den ville stadig
  // se ud til at virke, fordi et tomt ekstra-signal bare er en no-op.
  const medUdvidelse = buildFtsQuery('hvad koster en behandling');
  const smal = buildFtsQuery('hvad koster en behandling', { operator: 'AND' });
  expect(medUdvidelse.length).toBeGreaterThan(smal.length);   // OR-formen ER udvidet
  expect(smal.split(' AND ').length).toBe(
    buildFtsQuery('hvad koster en behandling', { expand: false }).split(' OR ').length,
  );
});

test('F265.2 den smalle liste er et SIGNAL, ikke et filter — tom liste ændrer intet', () => {
  // Et dokument der ikke rummer hvert ord må ikke forsvinde. Uden denne
  // egenskab ville én tastefejl i et spørgsmål tømme svaret.
  const kandidater = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const uden = rangerKandidater(kandidater, {
    præcise: new Set(), ord: kandidater, vektor: [],
  });
  const medTom = rangerKandidater(kandidater, {
    præcise: new Set(), ord: kandidater, vektor: [], alleOrd: [],
  });
  expect(medTom.map((x) => x.id)).toEqual(uden.map((x) => x.id));
  expect(medTom.length).toBe(3);
});

test('F265.2 den smalle liste ÆNDRER rækkefølgen — ellers er signalet pynt', () => {
  // FØRSTE UDGAVE AF DEN HER PRØVE KUNNE IKKE SKELNE: den gav dokumentet BÅDE
  // et vektor-træf og en plads på den smalle liste, og så vandt det allerede
  // uden det nye signal. Den ville have bestået lige så grønt hvis alleOrd
  // aldrig nåede fusionen — altså præcis den prøve der ikke må skrives.
  //
  // Her er b DÅRLIGERE placeret i ordmatchningen end a og har intet
  // vektor-træf. Kun den smalle liste taler for den.
  const kandidater = [{ id: 'a' }, { id: 'b' }];
  const ord = [{ id: 'a' }, { id: 'b' }];

  const uden = rangerKandidater(kandidater, { præcise: new Set(), ord, vektor: [] });
  expect(uden.map((x) => x.id)).toEqual(['a', 'b']);

  const med = rangerKandidater(kandidater, {
    præcise: new Set(), ord, vektor: [], alleOrd: [{ id: 'b' }],
  });
  expect(med.map((x) => x.id)).toEqual(['b', 'a']);
});

test('F265.2 boostet gælder OGSÅ en Trail uden betydnings-søgning', () => {
  // Lå boostet kun i hybrid-grenen, ville den smalle liste blive hentet og
  // smidt væk for hver videnbase med hybrid slukket.
  const rute = readFileSync(new URL('./search.ts', import.meta.url), 'utf8');
  const efterElse = rute.slice(rute.indexOf('} else if (alleOrdHits.length > 0)'));
  expect(efterElse).toContain('rangerKandidater');
  expect(efterElse).toContain('vektor: []');
});
