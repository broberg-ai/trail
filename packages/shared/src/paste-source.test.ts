/**
 * F149.7 — indsat tekst bliver en kildefil.
 *
 * Den bærende prøve er UNIKHEDEN. Et gen-upload af samme filnavn opdaterer det
 * eksisterende dokument i stedet for at oprette et nyt (uploads.ts:357) — det
 * er mekanismen bag F252's dublet-storm, brugt her i den modsatte retning:
 * to noter med samme overskrift ville overskrive hinanden i stilhed.
 */
import { test, expect } from 'bun:test';
import { noteFilnavn, udledTitel, slugifyTitel, kanGemmes } from './paste-source.js';

test('TO NOTER MED SAMME OVERSKRIFT BLIVER TO FILER — ellers overskriver den anden den første', () => {
  const tekst = '# Tanker om hybrid søgning\n\nnoget indhold';
  const a = noteFilnavn(tekst, new Date('2026-09-06T12:00:00Z'));
  const b = noteFilnavn(tekst, new Date('2026-09-06T12:00:01Z'));
  expect(a).not.toBe(b);
});

test('filnavnet bærer overskriften, så en note kan genkendes på listen', () => {
  const n = noteFilnavn('# Tanker om hybrid søgning\n\nx', new Date('2026-09-06T12:00:00Z'));
  expect(n).toContain('tanker-om-hybrid-soegning');
  expect(n.endsWith('.md')).toBe(true);
});

test('uden overskrift bruges første linje med indhold — ikke en tom streng', () => {
  expect(udledTitel('\n\n   \nDette er første rigtige linje\nmere')).toBe('Dette er første rigtige linje');
});

test('en tekst helt uden brugbar linje giver stadig et navn, ikke en tom fil', () => {
  // Kan ikke ske gennem UI'et (kanGemmes spærrer), men et navn på "" ville
  // give filnavnet "note-<stempel>-.md" og se ud som en fejl på listen.
  expect(udledTitel('   \n \n')).toBe('note');
  expect(noteFilnavn('   ')).toContain('note');
});

test('danske tegn overlever som læsbar tekst, ikke som bindestreger', () => {
  expect(slugifyTitel('Øvelser på Ærø i måneskin')).toBe('oevelser-paa-aeroe-i-maaneskin');
});

test('tom eller kun-mellemrum kan ikke gemmes', () => {
  expect(kanGemmes('')).toBe(false);
  expect(kanGemmes('   \n\t ')).toBe(false);
  expect(kanGemmes('x')).toBe(true);
});

test('filnavnet indeholder ingen tegn der kræver escaping i en URL-sti', () => {
  const n = noteFilnavn('# Æblegrød & "fløde" 50%/år: <test>', new Date('2026-09-06T12:00:00Z'));
  expect(n).toMatch(/^[a-z0-9._-]+$/);
});
