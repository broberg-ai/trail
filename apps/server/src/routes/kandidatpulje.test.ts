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
