/**
 * F275.2 — de to kontakter. Prøverne er skrevet mod ACCEPTKRITERIERNE, ikke mod
 * implementeringen: hierarkiet (AC#3), default TIL (AC#2) og den sat-ud-af-kraft-
 * tilstand brugeren skal kunne SE.
 */
import { describe, it, expect } from 'vitest';
import {
  newEditionIsCanon,
  connectorState,
  readDisabledConnectors,
  writeDisabledConnectors,
} from './canon.js';

const TIL = { brain: true, disabledConnectors: [] };

describe('F275.2 AC#2 — begge kontakter default TIL', () => {
  it('en frisk Brain uden nogen gemt værdi afløser', () => {
    expect(newEditionIsCanon(TIL, 'broberg-ai-site-sync')).toEqual({ canon: true, reason: 'on' });
  });

  it('en konnektor der ALDRIG er set før står TIL uden at nogen har rørt den', () => {
    // Kernen i «gem de slukkede, ikke de tændte». Gemte vi de tændte, ville
    // denne være FRA — og det er præcis den lydløse fejl kortet forbyder.
    const k = { brain: true, disabledConnectors: ['upload'] };
    expect(newEditionIsCanon(k, 'en-konnektor-der-lige-er-opfundet').canon).toBe(true);
  });

  it('en source UDEN konnektor følger Brain-kontakten', () => {
    expect(newEditionIsCanon(TIL, null).canon).toBe(true);
    expect(newEditionIsCanon({ brain: false, disabledConnectors: [] }, null).canon).toBe(false);
  });
});

describe('F275.2 AC#3 — hierarkiet er entydigt og går kun én vej', () => {
  it('Brain FRA slår alt fra, også en konnektor der står på TIL', () => {
    const k = { brain: false, disabledConnectors: [] };
    expect(newEditionIsCanon(k, 'broberg-ai-site-sync')).toEqual({ canon: false, reason: 'brain-off' });
  });

  it('Brain TIL + konnektor FRA ⇒ kun den konnektor er fra', () => {
    const k = { brain: true, disabledConnectors: ['upload'] };
    expect(newEditionIsCanon(k, 'upload')).toEqual({ canon: false, reason: 'connector-off' });
    expect(newEditionIsCanon(k, 'broberg-ai-site-sync')).toEqual({ canon: true, reason: 'on' });
  });

  it('GRUNDEN skelner de to slukkede tilstande fra hinanden', () => {
    // Uden grunden kan produktet ikke sige HVILKEN kontakt der stoppede det,
    // og så kan brugeren ikke se hvad han skal slå til.
    const braendFra = newEditionIsCanon({ brain: false, disabledConnectors: ['upload'] }, 'upload');
    expect(braendFra.reason).toBe('brain-off');
  });

  it('en konnektor-kontakt på TIL under en slukket Brain er SAT UD AF KRAFT — og kan ses', () => {
    const t = connectorState({ brain: false, disabledConnectors: [] }, 'broberg-ai-site-sync');
    expect(t).toEqual({ ownSwitch: true, overriddenByBrain: true, effective: false });
  });

  it('en konnektor der selv er slukket er IKKE «sat ud af kraft» — den er bare fra', () => {
    const t = connectorState({ brain: false, disabledConnectors: ['upload'] }, 'upload');
    expect(t).toEqual({ ownSwitch: false, overriddenByBrain: false, effective: false });
  });
});

describe('F275.2 — lagringen', () => {
  it('tom liste gemmes som null så en urørt Brain står ren', () => {
    expect(writeDisabledConnectors([])).toBeNull();
  });

  it('rundtur bevarer id\'erne', () => {
    const json = writeDisabledConnectors(['upload', 'chat']);
    expect(readDisabledConnectors(json)).toEqual(['chat', 'upload']);
  });

  it('dubletter og tomme strenge falder væk', () => {
    expect(readDisabledConnectors(writeDisabledConnectors(['upload', 'upload', '', '  ']))).toEqual(['upload']);
  });

  it('en ØDELAGT værdi betyder «ingen er slukket» — aldrig «alt er slukket»', () => {
    // Fejlretningen skal gå mod default-tilstanden. Læste vi vrøvl som «alt fra»,
    // ville en ødelagt kolonne slukke featuren lydløst for hele Brain'en.
    for (const vaerdi of ['ikke json', '{"upload":true}', '42', 'null', '']) {
      expect(readDisabledConnectors(vaerdi)).toEqual([]);
    }
    expect(readDisabledConnectors(null)).toEqual([]);
    expect(readDisabledConnectors(undefined)).toEqual([]);
  });

  it('ikke-strenge i listen kasseres, resten overlever', () => {
    expect(readDisabledConnectors('["upload", 7, null, "chat"]')).toEqual(['upload', 'chat']);
  });
});
