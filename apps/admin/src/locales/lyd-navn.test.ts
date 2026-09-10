/**
 * F271 — lyd-indstillingen må ikke hedde «Ambient».
 *
 * Christian 10/9 2026: «Da vi har et produkt der hedder Ambient så skal
 * Ambient i menuen bare hedde Sound.»
 *
 * Kontakten tænder en baggrundslyd mens man arbejder. Trail Ambient er den
 * macOS-agent der optager arbejdssessioner og skriver Neuroner. Samme ord, to
 * vidt forskellige ting — og den ene af dem sender data ind i en videnbase.
 * En bruger der slår «Ambient» fra i menuen kunne med god ret tro at han lige
 * havde stoppet optagelsen.
 *
 * Vagten er skrevet mod ORDET, ikke mod nøglen: en fremtidig oversættelse eller
 * en velment omdøbning kan bringe kollisionen tilbage uden at røre koden.
 */
import { describe, expect, test } from 'bun:test';
import en from './en.json';
import da from './da.json';

const LOKALER: Array<[string, typeof en | typeof da]> = [['en', en], ['da', da]];

describe('lyd-indstillingen', () => {
  test('hedder Sound på engelsk og Lyd på dansk', () => {
    expect(en.userMenu.sound).toBe('Sound');
    expect(da.userMenu.sound).toBe('Lyd');
  });

  test('INTET synligt ord i menuen er «Ambient» — det er produktets navn', () => {
    for (const [navn, l] of LOKALER) {
      for (const [nøgle, værdi] of Object.entries(l.userMenu)) {
        expect(`${navn}.${nøgle}=${værdi}`).not.toMatch(/ambient/i);
      }
    }
  });

  test('til/fra findes i begge sprog', () => {
    for (const [navn, l] of LOKALER) {
      expect(`${navn}:${l.userMenu.soundOff}`.length).toBeGreaterThan(navn.length + 1);
      expect(`${navn}:${l.userMenu.soundOn}`.length).toBeGreaterThan(navn.length + 1);
    }
  });

  test('de gamle nøgler er VÆK — ellers står en død oversættelse og ligner dækning', () => {
    for (const [, l] of LOKALER) {
      expect('ambient' in l.userMenu).toBe(false);
      expect('ambientOff' in l.userMenu).toBe(false);
      expect('ambientOn' in l.userMenu).toBe(false);
    }
  });
});
