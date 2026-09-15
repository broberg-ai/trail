/**
 * F274.1 — ÉN skrub-regel, ét sted.
 *
 * Der var to. `scrubForLeaks` (candidates.ts) skrubbede titel + indhold, og
 * `candidate-api.ts` gentog det samme udtryk indlejret for at danne filnavnet.
 * De var enige den dag de blev skrevet — og det er præcis hvad der gør en
 * dublet farlig: den er ikke gal når den skrives, men den dag den ene bliver
 * rettet. Lægger nogen et tredje mønster i `scrubForLeaks`, ville filnavnet
 * ikke have fået det, og ingen ville se forskellen.
 *
 * Rækkefølgen er ikke ligegyldig: `redactSecrets` først, `maskerCpr` bagefter.
 * Nøglemaskeringen indsætter sin egen markør, og et CPR kan stå i en tekst der
 * også bærer en nøgle — begge skal væk, uafhængigt af hinanden.
 */
import { redactSecrets, type RedactionFinding } from './secret-scan.js';
import { maskerCpr } from './cpr.js';

export function skrubStreng(tekst: string): {
  ren: string;
  findings: RedactionFinding[];
  cprAntal: number;
} {
  const nøgler = redactSecrets(tekst);
  const cpr = maskerCpr(nøgler.redacted);
  return { ren: cpr.maskeret, findings: nøgler.findings, cprAntal: cpr.antal };
}
