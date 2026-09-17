/**
 * F275.3 — linten må aldrig rejse en modsigelse mellem to udgaver af SAMME kilde.
 *
 * Kontrollanten herunder siger ALTID «de modsiger hinanden». Det er med vilje:
 * en prøve hvor modellen selv kunne svare nej ville bestå uden at bevise noget.
 * Alt der er grønt her, er grønt fordi springet virkede — ikke fordi der ikke
 * var noget at springe over.
 */
import { describe, it, expect, mock } from 'bun:test';
import {
  detectContradictions,
  sammeKilde,
  type ContradictionCandidate,
  type NewNeuron,
} from './contradictions.js';

const ALTID_MODSIGELSE = mock(async () => ({
  contradicts: true,
  summary: 'de siger hver sit',
  newQuote: 'nu',
  existingQuote: 'før',
}));

function neuron(id: string, identitet: string | null): NewNeuron {
  return { documentId: id, filename: `${id}.md`, title: id, content: `indhold ${id}`, version: 1, sourceIdentity: identitet };
}
function modpart(id: string, identitet: string | null): ContradictionCandidate {
  return { documentId: id, filename: `${id}.md`, title: id, content: `indhold ${id}`, version: 1, sourceIdentity: identitet };
}

const URL_A = 'url:https://broberg.ai/flagskibe/bid';
const URL_B = 'url:https://broberg.ai/indsigter/design';

describe('F275.3 AC#0 — to udgaver af samme kilde rejser INGEN modsigelse', () => {
  it('samme URL ⇒ nul fund, og kontrollanten blev slet ikke spurgt', async () => {
    ALTID_MODSIGELSE.mockClear();
    const fund = await detectContradictions(
      neuron('ny', URL_A), [modpart('gammel', URL_A)], ALTID_MODSIGELSE, undefined, true,
    );
    expect(fund).toEqual([]);
    // Springet ligger FØR kaldet: en rettelse på sitet koster heller ikke penge.
    expect(ALTID_MODSIGELSE).not.toHaveBeenCalled();
  });
});

describe('F275.3 AC#1 — NEGATIV KONTROL: forskellige kilder modsiger stadig hinanden', () => {
  it('to forskellige URL\'er giver et fund', async () => {
    const fund = await detectContradictions(
      neuron('ny', URL_A), [modpart('anden', URL_B)], ALTID_MODSIGELSE, undefined, true,
    );
    expect(fund.length).toBe(1);
    expect(fund[0]!.kind).toBe('contradiction-alert');
  });

  it('blandet flok: kun modparten med SAMME kilde springes over', async () => {
    // Uden denne ville «spring altid over» bestå lige så grønt som reglen.
    const fund = await detectContradictions(
      neuron('ny', URL_A),
      [modpart('samme-kilde', URL_A), modpart('anden-kilde', URL_B), modpart('ukendt', null)],
      ALTID_MODSIGELSE, undefined, true,
    );
    expect(fund.map((f) => (f.details as { existingDocumentId: string }).existingDocumentId).sort())
      .toEqual(['anden-kilde', 'ukendt']);
  });
});

describe('F275.3 AC#4 — DEN SIKRE STANDARD: ingen identitet ⇒ MODSIGELSE', () => {
  it('to Neuroner UDEN identitet er ikke «samme ukendte kilde»', async () => {
    // Faldt tvivlen den anden vej, ville hele den nuværende base — hvor feltet
    // er tomt indtil backfill'en er kørt — blive usynlig for detektion i det
    // sekund kontakten blev slået til. Og en modsigelse der ikke rejses ser
    // præcis ud som en der ikke findes.
    const fund = await detectContradictions(
      neuron('ny', null), [modpart('gammel', null)], ALTID_MODSIGELSE, undefined, true,
    );
    expect(fund.length).toBe(1);
  });

  it('kun den ene side kendt ⇒ stadig modsigelse, i begge retninger', async () => {
    expect((await detectContradictions(neuron('n', URL_A), [modpart('g', null)], ALTID_MODSIGELSE, undefined, true)).length).toBe(1);
    expect((await detectContradictions(neuron('n', null), [modpart('g', URL_A)], ALTID_MODSIGELSE, undefined, true)).length).toBe(1);
  });

  it('sammeKilde() siger det selv: null matcher aldrig null', () => {
    expect(sammeKilde({ sourceIdentity: null }, { sourceIdentity: null })).toBe(false);
    expect(sammeKilde({ sourceIdentity: URL_A }, { sourceIdentity: null })).toBe(false);
    expect(sammeKilde({ sourceIdentity: URL_A }, { sourceIdentity: URL_A })).toBe(true);
    expect(sammeKilde({ sourceIdentity: URL_A }, { sourceIdentity: URL_B })).toBe(false);
  });

  it('en tom streng er heller ikke en identitet der matcher en anden tom', () => {
    // kildeIdentitet() returnerer aldrig '', men en rå DB-værdi kunne være det.
    expect(sammeKilde({ sourceIdentity: '' }, { sourceIdentity: '' })).toBe(true);
    // ^ dokumenteret ærligt: '' === '' er sandt. Derfor er det kildeIdentitet()
    //   der skal blive ved med at afvise tomme værdier — se kilde-identitet.ts.
  });
});

describe('F275.3 AC#3 — kontakten styrer det', () => {
  it('kontakten FRA ⇒ linten opfører sig som før featuren fandtes', async () => {
    const fund = await detectContradictions(
      neuron('ny', URL_A), [modpart('gammel', URL_A)], ALTID_MODSIGELSE, undefined, false,
    );
    expect(fund.length).toBe(1);
  });

  it('argumentet UDELADT ⇒ også gammel adfærd', async () => {
    // Standarden er `false` med vilje: en ny regel må ikke kunne snige sig ind
    // gennem et argument en kalder glemte at sende.
    const fund = await detectContradictions(neuron('ny', URL_A), [modpart('gammel', URL_A)], ALTID_MODSIGELSE);
    expect(fund.length).toBe(1);
  });
});

describe('F275.3 — springet rører ikke de gamle regler', () => {
  it('en Neuron modsiger stadig ikke sig selv', async () => {
    const fund = await detectContradictions(
      neuron('samme', URL_A), [modpart('samme', URL_B)], ALTID_MODSIGELSE, undefined, true,
    );
    expect(fund).toEqual([]);
  });

  it('en kontrollant der fejler tier stadig — den rejser ikke et gæt', async () => {
    const fund = await detectContradictions(
      neuron('ny', URL_A),
      [modpart('anden', URL_B)],
      mock(async () => { throw new Error('modellen svarede ikke'); }),
      undefined, true,
    );
    expect(fund).toEqual([]);
  });
});
