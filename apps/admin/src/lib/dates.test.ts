/**
 * Ejerens regel, 15/9 2026: «datoer skal ALTID vises på dansk i mine produkter
 * også selv om sproget er Engelsk.»
 *
 * DEN BÆRENDE PRØVE er den der kalder med locale 'en' og KRÆVER dansk. Den
 * gamle kode gav «Apr 29, 2026» dér, og en prøvesuite der kun kaldte med 'da'
 * ville have været grøn på præcis den fejl.
 *
 * Hvorfor reglen ikke er kosmetik: `04/09/2026` er 4. september for en dansker
 * og 9. april for en amerikaner, og tallet afslører ikke hvilken læsning der
 * var ment. Det fejler i den GRØNNE retning — datoen ser rigtig ud.
 */
import { test, expect } from 'bun:test';
import {
  formatLocaleDate,
  formatShortLocaleDate,
  dansk,
  danskFuld,
  danskISODato,
  danskVaegurVisning,
} from './dates.js';

test('DEN BÆRENDE: en dato er dansk også når sproget er engelsk', () => {
  const da = formatLocaleDate('2026-04-29', 'da');
  const en = formatLocaleDate('2026-04-29', 'en');
  expect(en).toBe(da);
  // Ikke bare «ens» — faktisk dansk. «Apr 29, 2026» ville bestå en ens-test
  // hvis begge sprog var brudt på samme måde.
  expect(en).toContain('2026');
  expect(en).toContain('29');
  expect(en).not.toMatch(/Apr \d/); // den engelske form
});

test('den korte form er også dansk på engelsk', () => {
  expect(formatShortLocaleDate('2026-04-29', 'en')).toBe('29/4');
  expect(formatShortLocaleDate('2026-04-29', 'da')).toBe('29/4');
});

test('en ulæselig dato returneres uændret frem for at blive til «Invalid Date»', () => {
  expect(formatLocaleDate('ikke en dato', 'da')).toBe('ikke en dato');
  expect(formatShortLocaleDate('', 'en')).toBe('');
});

test('dansk(): et SERVER-stempel (naiv UTC) omregnes til dansk tid', () => {
  // 2026-09-10 14:13:24 UTC er 16:13 i København (CEST).
  expect(dansk('2026-09-10 14:13:24')).toContain('16');
  expect(dansk('2026-09-10 14:13:24')).toContain('10');
});

test('dansk(): VINTER — forskydningen er én time, ikke to', () => {
  // Et fast +02:00 ville give 15:00 her. Danmark er UTC+1 om vinteren.
  expect(dansk('2026-01-10 14:00:00')).toContain('15');
});

test('danskFuld() bærer året med', () => {
  expect(danskFuld('2026-09-10 14:13:24')).toContain('2026');
});

test('danskISODato() giver ISO-formen i DANSK tid', () => {
  // 22:30Z den 21. er 00:30 den 22. i København — datoen må følge zonen.
  expect(danskISODato(new Date('2026-09-21T22:30:00Z'))).toBe('2026-09-22');
  // Og om vinteren, hvor forskydningen er mindre:
  expect(danskISODato(new Date('2026-01-21T23:30:00Z'))).toBe('2026-01-22');
  expect(danskISODato(new Date('2026-01-21T22:30:00Z'))).toBe('2026-01-21');
});

test('danskVaegurVisning() omregner IKKE — værdien er allerede dansk vægur', () => {
  // Motorens kvittering er dansk lokaltid. Gik den gennem dansk(), ville
  // 16:00 blive til 18:00. De to strenge ligner hinanden fuldstændigt, og
  // det er hele grunden til at funktionen findes.
  const ud = danskVaegurVisning('2026-09-10 16:00:00');
  expect(ud).toContain('16.00');
  expect(ud).not.toContain('18');
  expect(ud).toContain('2026');
});

test('danskVaegurVisning() lader en uventet form være', () => {
  expect(danskVaegurVisning('i går')).toBe('i går');
});
