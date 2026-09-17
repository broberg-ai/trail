/**
 * F275.2 — de to kontakter. Prøverne er skrevet mod ACCEPTKRITERIERNE, ikke mod
 * implementeringen: hierarkiet (AC#3), default TIL (AC#2) og den sat-ud-af-kraft-
 * tilstand brugeren skal kunne SE.
 */
import { describe, it, expect } from 'vitest';
import {
  nyUdgaveErKanon,
  konnektorTilstand,
  laesSlukkedeKonnektorer,
  skrivSlukkedeKonnektorer,
} from './kanon.js';

const TIL = { brain: true, slukkedeKonnektorer: [] };

describe('F275.2 AC#2 — begge kontakter default TIL', () => {
  it('en frisk Brain uden nogen gemt værdi afløser', () => {
    expect(nyUdgaveErKanon(TIL, 'broberg-ai-site-sync')).toEqual({ kanon: true, grund: 'til' });
  });

  it('en konnektor der ALDRIG er set før står TIL uden at nogen har rørt den', () => {
    // Kernen i «gem de slukkede, ikke de tændte». Gemte vi de tændte, ville
    // denne være FRA — og det er præcis den lydløse fejl kortet forbyder.
    const k = { brain: true, slukkedeKonnektorer: ['upload'] };
    expect(nyUdgaveErKanon(k, 'en-konnektor-der-lige-er-opfundet').kanon).toBe(true);
  });

  it('en kilde UDEN konnektor følger Brain-kontakten', () => {
    expect(nyUdgaveErKanon(TIL, null).kanon).toBe(true);
    expect(nyUdgaveErKanon({ brain: false, slukkedeKonnektorer: [] }, null).kanon).toBe(false);
  });
});

describe('F275.2 AC#3 — hierarkiet er entydigt og går kun én vej', () => {
  it('Brain FRA slår alt fra, også en konnektor der står på TIL', () => {
    const k = { brain: false, slukkedeKonnektorer: [] };
    expect(nyUdgaveErKanon(k, 'broberg-ai-site-sync')).toEqual({ kanon: false, grund: 'brain-fra' });
  });

  it('Brain TIL + konnektor FRA ⇒ kun den konnektor er fra', () => {
    const k = { brain: true, slukkedeKonnektorer: ['upload'] };
    expect(nyUdgaveErKanon(k, 'upload')).toEqual({ kanon: false, grund: 'konnektor-fra' });
    expect(nyUdgaveErKanon(k, 'broberg-ai-site-sync')).toEqual({ kanon: true, grund: 'til' });
  });

  it('GRUNDEN skelner de to slukkede tilstande fra hinanden', () => {
    // Uden grunden kan produktet ikke sige HVILKEN kontakt der stoppede det,
    // og så kan brugeren ikke se hvad han skal slå til.
    const braendFra = nyUdgaveErKanon({ brain: false, slukkedeKonnektorer: ['upload'] }, 'upload');
    expect(braendFra.grund).toBe('brain-fra');
  });

  it('en konnektor-kontakt på TIL under en slukket Brain er SAT UD AF KRAFT — og kan ses', () => {
    const t = konnektorTilstand({ brain: false, slukkedeKonnektorer: [] }, 'broberg-ai-site-sync');
    expect(t).toEqual({ egenKontakt: true, satUdAfKraft: true, virker: false });
  });

  it('en konnektor der selv er slukket er IKKE «sat ud af kraft» — den er bare fra', () => {
    const t = konnektorTilstand({ brain: false, slukkedeKonnektorer: ['upload'] }, 'upload');
    expect(t).toEqual({ egenKontakt: false, satUdAfKraft: false, virker: false });
  });
});

describe('F275.2 — lagringen', () => {
  it('tom liste gemmes som null så en urørt Brain står ren', () => {
    expect(skrivSlukkedeKonnektorer([])).toBeNull();
  });

  it('rundtur bevarer id\'erne', () => {
    const json = skrivSlukkedeKonnektorer(['upload', 'chat']);
    expect(laesSlukkedeKonnektorer(json)).toEqual(['chat', 'upload']);
  });

  it('dubletter og tomme strenge falder væk', () => {
    expect(laesSlukkedeKonnektorer(skrivSlukkedeKonnektorer(['upload', 'upload', '', '  ']))).toEqual(['upload']);
  });

  it('en ØDELAGT værdi betyder «ingen er slukket» — aldrig «alt er slukket»', () => {
    // Fejlretningen skal gå mod default-tilstanden. Læste vi vrøvl som «alt fra»,
    // ville en ødelagt kolonne slukke featuren lydløst for hele Brain'en.
    for (const vaerdi of ['ikke json', '{"upload":true}', '42', 'null', '']) {
      expect(laesSlukkedeKonnektorer(vaerdi)).toEqual([]);
    }
    expect(laesSlukkedeKonnektorer(null)).toEqual([]);
    expect(laesSlukkedeKonnektorer(undefined)).toEqual([]);
  });

  it('ikke-strenge i listen kasseres, resten overlever', () => {
    expect(laesSlukkedeKonnektorer('["upload", 7, null, "chat"]')).toEqual(['upload', 'chat']);
  });
});
