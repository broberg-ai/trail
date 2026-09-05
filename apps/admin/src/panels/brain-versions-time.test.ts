/**
 * F253.4 — tidspunktet i fladen SKAL være dansk tid med zonen navngivet.
 *
 * Serveren gemmer og svarer i UTC (`datetime('now')` i en Fly-container). En
 * tid uden zone bliver læst i læserens egen — lydløst, og mellem midnat og
 * 02:00 dansk tid er det en ANDEN DATO. Det er allerede nået ud til en kunde
 * én gang i flåden: et opkald oprettet 22:30Z den 21. er 00:30 den 22. i
 * København, og kunden fik at vide den 21.
 *
 * Zonen angives ved NAVN, aldrig som et fast +02:00: Danmark er UTC+1 om
 * vinteren, så et hardkodet offset er forkert et halvt år ad gangen.
 */
import { test, expect } from 'bun:test';

import { dansk } from '../lib/dates';

test('serverens plads-format læses som UTC og vises i dansk tid', () => {
  // SOMMERTID: UTC+2. 21:47 UTC = 23:47 i København, samme dag.
  expect(dansk('2026-09-05 21:47:28')).toContain('23.47');
  expect(dansk('2026-09-05 21:47:28')).toContain('05');
});

test('ISO-formatet med Z giver PRÆCIS det samme — begge findes i basen', () => {
  expect(dansk('2026-09-05T21:47:28.305Z')).toBe(dansk('2026-09-05 21:47:28'));
});

test('DATOEN skifter i midnats-vinduet — den fejl der allerede har ramt en kunde', () => {
  // 22:30 UTC den 21. er 00:30 den 22. i København.
  const ud = dansk('2026-09-21 22:30:00');
  expect(ud).toContain('22');   // dagen efter
  expect(ud).toContain('00.30');
});

test('VINTERTID er UTC+1 — et hardkodet +02:00 ville være forkert her', () => {
  // 5. januar: CET, altså +1. 21:47 UTC = 22:47 i København, ikke 23:47.
  const vinter = dansk('2026-01-05 21:47:00');
  expect(vinter).toContain('22.47');
  expect(vinter).not.toContain('23.47');
});

test('et uforståeligt tidsstempel returneres uændret frem for «Invalid Date»', () => {
  expect(dansk('ikke en dato')).toBe('ikke en dato');
});
