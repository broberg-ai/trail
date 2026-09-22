/**
 * F286.7 — modprøver for `readAnswer()`.
 *
 * HVORFOR DE HER PRØVER SER UD SOM DE GØR. Kortets AC#2 kræver eksplicit en
 * modprøve, fordi en tæller der altid svarer det samme ville bestå «vi tæller
 * to slags» ved et uheld: hvis ALT blev stemplet `unparseable`, ville et split
 * på 39/0 se ud som en måling og være et fastlåst svar.
 *
 * Så hver prøve har sin makker i den anden retning. Muterer man `readAnswer` til
 * altid at svare én ting, bliver mindst to prøver røde.
 */
import { describe, expect, test } from 'bun:test';
import { readAnswer } from './baseline.js';

const LABELS = ['approved', 'rejected', 'ingested'];

describe('readAnswer — de tre udfald', () => {
  test('en etiket på menuen er et svar', () => {
    expect(readAnswer('{"label":"approved"}', LABELS)).toEqual({ label: 'approved' });
  });

  test('kodehegn omkring JSON er stadig et svar', () => {
    // Modellen svarer jævnligt i ```json-hegn. Blev det læst som uparseligt,
    // ville format-tallet vokse af en formatering vi selv kan fjerne.
    expect(readAnswer('```json\n{"label":"rejected"}\n```', LABELS)).toEqual({ label: 'rejected' });
  });

  test('en etiket UDEN FOR menuen er out-of-set, ikke uparselig', () => {
    const a = readAnswer('{"label":"maybe"}', LABELS);
    expect(a.label).toBe(null);
    expect(a.kind).toBe('out-of-set');
    // Det rå svar gemmes, ellers kan man tælle fejlen men ikke rette den.
    expect(a.raw).toBe('"maybe"');
  });

  test('et svar helt uden JSON er uparseligt, ikke out-of-set', () => {
    const a = readAnswer('I cannot classify this text.', LABELS);
    expect(a.label).toBe(null);
    expect(a.kind).toBe('unparseable');
  });

  test('MODPRØVE: de to slags ikke-svar får IKKE samme stempel', () => {
    // Den bærende prøve. Uden den kan begge grene returnere det samme og alle
    // prøver ovenfor ville stadig passere hver for sig.
    const udenfor = readAnswer('{"label":"maybe"}', LABELS);
    const uparselig = readAnswer('nope', LABELS);
    expect(udenfor.kind).not.toBe(uparselig.kind);
  });

  test('MODPRØVE: et gyldigt svar bærer INGEN no-answer-slags', () => {
    // Ellers ville en tæller der stempler alt som out-of-set stadig kunne
    // bestå prøven ovenfor.
    expect(readAnswer('{"label":"approved"}', LABELS).kind).toBeUndefined();
  });

  test('{"label":null} er out-of-set — systemprompten beder selv om det', () => {
    // Vores systemprompt siger «hvis ingen af etiketterne passer, svar
    // {"label": null}». Det ER et svar på formen, bare ikke en etiket, så det
    // hører i out-of-set og ikke i uparselig. Blandes de to, ser en model der
    // pænt afviser ud som en model der ikke kan formatere.
    const a = readAnswer('{"label":null}', LABELS);
    expect(a.label).toBe(null);
    expect(a.kind).toBe('out-of-set');
    expect(a.raw).toBe('null');
  });

  test('en etiket er ikke gyldig bare fordi den ligner en', () => {
    // Præfiks-match ville gøre «approve» til «approved». Sker det, måler vi
    // en mildere model end den vi har.
    expect(readAnswer('{"label":"approve"}', LABELS).kind).toBe('out-of-set');
    expect(readAnswer('{"label":"Approved"}', LABELS).kind).toBe('out-of-set');
  });

  test('det rå svar afkortes, så én lang model-udgydelse ikke fylder rapporten', () => {
    const langt = 'x'.repeat(500);
    const a = readAnswer(langt, LABELS);
    expect(a.kind).toBe('unparseable');
    expect(a.raw!.length).toBeLessThanOrEqual(200);
  });
});
