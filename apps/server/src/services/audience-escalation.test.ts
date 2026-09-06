/**
 * F255 — publikum må INDSNÆVRES, aldrig UDVIDES.
 *
 * Prøven er bygget om den målte hændelse, ikke om min gengivelse af den:
 * samme bearer-nøgle mod produktion 6/9 fik heuristik-dokumentet udleveret
 * med `?audience=curator` og ikke uden.
 */
import { test, expect } from 'bun:test';
import { effectiveAudience } from './audience.js';

test('EN BEARER-NØGLE DER BEDER OM CURATOR FÅR TOOL — det var hele hullet', () => {
  expect(effectiveAudience('bearer', 'curator')).toBe('tool');
});

test('en bearer-nøgle uden parameter får tool — uændret, og det er kontrollen', () => {
  // Går denne i stykker, måler prøven ovenfor ikke en eskalering: den måler
  // bare at bearer altid er tool, hvilket ville bestå selv hvis loftet var væk.
  expect(effectiveAudience('bearer', null)).toBe('tool');
  expect(effectiveAudience('bearer', undefined)).toBe('tool');
});

test('en SESSION må stadig indsnævre til tool — se-som-ekstern er en ægte funktion', () => {
  expect(effectiveAudience('session', 'tool')).toBe('tool');
  expect(effectiveAudience('session', 'public')).toBe('public');
});

test('en session uden parameter er curator — ellers havde vi lukket admin ude', () => {
  expect(effectiveAudience('session', null)).toBe('curator');
});

test('public og tool omskrives ikke til hinanden — de er ens på filter, ikke på prompt', () => {
  // Begge filtrerer identisk i dag, men divergerer på chat-prompt-niveau
  // (audience.ts's egen kommentar). En "normalisering" til tool ville stille
  // og roligt ændre tonen i et kundesvar.
  expect(effectiveAudience('bearer', 'public')).toBe('public');
  expect(effectiveAudience('session', 'public')).toBe('public');
});

test('vrøvl i parameteren falder tilbage til loftet, ikke til curator', () => {
  expect(effectiveAudience('bearer', 'kurator')).toBe('tool');
  expect(effectiveAudience('bearer', '')).toBe('tool');
  expect(effectiveAudience('bearer', 'CURATOR')).toBe('tool'); // versal-variant er ikke gyldig
});

test('ukendt authType behandles som session — uændret fra defaultAudienceForAuth', () => {
  // Ikke en påstand om at det er RIGTIGT, men om at F255 ikke ændrede det.
  // Ændres den regel, skal det være et bevidst valg med sin egen begrundelse.
  expect(effectiveAudience(undefined, null)).toBe('curator');
});
