/**
 * F271.1 — enheden hedder Brain, produktet hedder Trail.
 *
 * Beviset for at det var nødvendigt stod i vores egen tomme tilstand, som var
 * nødt til at DEFINERE ordet: «En trail er én vidensbase inde i denne tenant.»
 * Den sætning findes kun når navnet ikke forklarer sig selv.
 *
 * VAGTEN GÅR BEGGE VEJE, og den anden halvdel er den bærende: uden den ville
 * «omdøb alt» bestå prøven, og «Sign in to Brain» ville være grønt.
 */
import { describe, expect, test } from 'bun:test';
import en from './en.json';
import da from './da.json';
import { ENHEDS_NOEGLER, PRODUKT_NOEGLER, BEGGE_NOEGLER } from './trail-ord.js';

const LOKALER: Array<[string, unknown]> = [['en', en], ['da', da]];

function slaaOp(o: unknown, sti: string): string | undefined {
  let n: unknown = o;
  for (const d of sti.split('.')) {
    if (typeof n !== 'object' || n === null) return undefined;
    n = (n as Record<string, unknown>)[d];
  }
  return typeof n === 'string' ? n : undefined;
}

describe('Brain / Trail', () => {
  test('hver klassificeret nøgle FINDES — ellers måler vagten ingenting', () => {
    const alle = [...ENHEDS_NOEGLER, ...PRODUKT_NOEGLER, ...BEGGE_NOEGLER];
    for (const [navn, l] of LOKALER) {
      for (const k of alle) {
        expect(`${navn}:${k}`, `${navn}.${k} mangler`).toBe(`${navn}:${k}`);
        expect(typeof slaaOp(l, k)).toBe('string');
      }
    }
    expect(alle.length).toBe(71);
  });

  test('ENHEDS-tekster siger ALDRIG «trail» længere', () => {
    for (const [navn, l] of LOKALER) {
      for (const k of ENHEDS_NOEGLER) {
        // Påstanden er om VÆRDIEN, ikke om nøglen: settings.trail.* HEDDER
        // stadig trail (93 kaldesteder, ingen brugerværdi i at omdøbe dem), og
        // en assertion der også læste nøglen ville fejle på sit eget mærkat.
        expect(slaaOp(l, k), `${navn}.${k}`).not.toMatch(/\btrails?\b/i);
      }
    }
  });

  test('PRODUKT-tekster siger STADIG «Trail» — den halvdel er den bærende', () => {
    for (const [navn, l] of LOKALER) {
      for (const k of PRODUKT_NOEGLER) {
        expect(slaaOp(l, k), `${navn}.${k}`).toMatch(/trail/i);
      }
    }
  });

  test('den ene streng med BEGGE betydninger bærer dem begge', () => {
    for (const [, l] of LOKALER) {
      const v = slaaOp(l, BEGGE_NOEGLER[0]!)!;
      expect(v).toMatch(/Trail Ambient/);
      expect(v).toMatch(/Brains/);
    }
  });

  test('dansk: Brain er intetkøn — aldrig «denne Brain» eller «en Brain»', () => {
    for (const k of ENHEDS_NOEGLER) {
      const v = slaaOp(da, k) ?? '';
      expect(v, `da.${k}`).not.toMatch(/\b[Dd]enne Brain\b/);
      expect(v, `da.${k}`).not.toMatch(/\b[Ee]n Brain\b/);
    }
  });
});
