/**
 * F268.3 — en flytning skal FLYTTE, ikke omskrive.
 *
 * Målt 10/9 2026: 24 arbejdsnoter skulle flyttes fra broberg.ai til CB-M1.
 * Den understøttede vej er at poste kandidaten igen mod den nye Trail — og
 * dét kørte destillationen én gang til, oven på sin egen destillation:
 *
 *   titel   «Fejlmønstre i buddy-sessions…» → «Fejlanalyse i buddy-sessions…»
 *   længde  640 tegn → 594
 *   tabt    «og ikke fra i dag» (en nøgtern detalje i en fejlanalyse)
 *
 * Første prøve er den negative kontrol: den er rød uden spærren.
 */
import { describe, expect, test } from 'bun:test';
import { erAlleredeDestilleret, stampDistill } from './ambient-distill.js';

const AMBIENT = '{"connector":"trail-ambient-capture","sourceUrl":"ambient://focus-session/x"}';

describe('erAlleredeDestilleret', () => {
  test('en allerede destilleret optagelse genkendes — så den ikke omskrives igen', () => {
    expect(erAlleredeDestilleret(stampDistill(AMBIENT, 'knowledge'))).toBe(true);
    expect(erAlleredeDestilleret(stampDistill(AMBIENT, 'noise'))).toBe(true);
  });

  test('en frisk optagelse er ikke destilleret — den skal stadig igennem', () => {
    expect(erAlleredeDestilleret(AMBIENT)).toBe(false);
  });

  test('intet metadata, tomt eller ugyldigt JSON → ikke destilleret, aldrig et kast', () => {
    expect(erAlleredeDestilleret(null)).toBe(false);
    expect(erAlleredeDestilleret(undefined)).toBe(false);
    expect(erAlleredeDestilleret('')).toBe(false);
    expect(erAlleredeDestilleret('{ikke json')).toBe(false);
  });

  test('en ukendt værdi i feltet tæller IKKE som destilleret', () => {
    // Ellers ville et vilkårligt `distill`-felt kunne slå destillationen fra.
    expect(erAlleredeDestilleret('{"distill":true}')).toBe(false);
    expect(erAlleredeDestilleret('{"distill":"måske"}')).toBe(false);
  });
});
