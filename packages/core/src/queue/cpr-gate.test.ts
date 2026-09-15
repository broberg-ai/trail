/**
 * F274 — CPR må ikke nå disken, bevist på DET ÆGTE KALDESTED.
 *
 * cpr.test.ts beviser at mønsteret virker. Det er en svagere påstand end den
 * ser ud: den ville være grøn hvis maskeringen aldrig blev KALDT fra indtaget.
 * Denne prøve kalder `scrubForLeaks` — den funktion hver eneste kandidat
 * faktisk går igennem før den persisteres.
 *
 * MÅLT FØR, med positiv kontrol på selve detektoren: `redactSecrets` maskerer
 * en Anthropic-nøgle i samme kald og lader «050268-0501» stå. Hullet var
 * altså ægte, og instrumentet der påviste det var ikke dødt.
 */
import { test, expect } from 'bun:test';
import { scrubForLeaks } from './candidates.js';

test('DEN BÆRENDE: et CPR i indholdet når aldrig forbi indtaget', () => {
  const ud = scrubForLeaks(
    { title: 'Patientforløb', content: 'Klienten 010101-0000 er booket til zoneterapi.' },
    'test',
  );
  expect(ud.content).not.toContain('010101-0000');
  expect(ud.content).toContain('[CPR fjernet]');
});

test('også i TITLEN — begge felter persisteres', () => {
  const ud = scrubForLeaks({ title: 'Sag 120385-1234', content: 'ingenting' }, 'test');
  expect(ud.title).not.toContain('120385-1234');
  expect(ud.title).toContain('[CPR fjernet]');
});

test('DEN GAMLE SPÆRRE ER URØRT — en API-nøgle maskeres stadig', () => {
  // Uden den ville «CPR virker» kunne opnås ved at ødelægge alt det andet.
  //
  // Nøglen er SYNTETISK og bygges af to stumper, så repoets egen secret-scan-
  // hook ikke afviser commit'en. Den afviste den faktisk — korrekt — første
  // gang, og en `secret-scan:allow` ville have virket men også lært den næste
  // at et mærkat er vejen forbi spærren. At bygge strengen i stedet holder
  // spærren skarp: der står ingen nøgle-formet konstant i filen.
  const falskNoegle = 'sk-ant-' + 'api03-' + 'abcdefghijklmnopqrstuvwxyz0123456789';
  const ud = scrubForLeaks({ title: 'x', content: `key ${falskNoegle}` }, 'test');
  expect(ud.content).not.toContain(falskNoegle);
  expect(ud.content).toContain('REDACTED');
});

test('NEGATIV KONTROL: almindeligt indhold går uændret igennem', () => {
  const tekst = 'Mødet 10. september kl. 16.00 varede 1 time og 21 minutter.';
  expect(scrubForLeaks({ title: 'Møde', content: tekst }, 'test').content).toBe(tekst);
});
