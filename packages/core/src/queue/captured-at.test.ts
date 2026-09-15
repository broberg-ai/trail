/**
 * F273.3 — «hvornår skete det» må ikke forveksles med «hvornår blev det gemt».
 *
 * Ambient har sendt et optagetidspunkt HELE TIDEN (relay.ts: `capturedAt:
 * summary.end`). Det blev tabt i `parseOp`, som krævede et `op`-felt og
 * derefter smed hele metadata-objektet væk hvis det manglede — og Ambients
 * metadata er `{connector, sourceUrl?, capturedAt?}`, altså uden `op`.
 *
 * Endnu en gang husets fejlform: EN MANGLENDE VÆRDI FIK EN ANDEN, FULDT GYLDIG
 * VÆRDI TIL AT FORSVINDE TAVST. Intet fejlede; feltet var bare aldrig der.
 *
 * MÅLT i CB-M1 den 15/9 2026, som grundlag: 944 af 946 Neuroner havde tom
 * metadata, og 187 var skrevet i minutter med 5+ rækker — værst 32 på ét
 * minut. Så «createdAt som optagetid» er ikke en teoretisk unøjagtighed.
 */
import { test, expect } from 'bun:test';
import { gyldigtTidsstempel } from './candidates.js';

test('DEN BÆRENDE: et gyldigt ISO-tidspunkt overlever', () => {
  expect(gyldigtTidsstempel('2026-09-10T14:13:24.000Z')).toBe('2026-09-10T14:13:24.000Z');
  // Også en form uden millisekunder — det er den Ambient sender.
  expect(gyldigtTidsstempel('2026-09-10T14:13:24Z')).toBe('2026-09-10T14:13:24.000Z');
});

test('DEN TREDJE TILSTAND: intet tidspunkt er NULL, ikke «nu»', () => {
  // Det farlige alternativ ville være at falde tilbage på Date.now() — så
  // ville «ikke målt» blive til et selvsikkert, forkert klokkeslæt.
  expect(gyldigtTidsstempel(undefined)).toBeNull();
  expect(gyldigtTidsstempel('')).toBeNull();
  expect(gyldigtTidsstempel('   ')).toBeNull();
});

test('en streng vi ikke kan læse er IKKE et tidspunkt', () => {
  // Feltet kommer fra en ekstern afsender. En uparselig streng gemt som var
  // den en tid ville først svare forkert den dag nogen filtrerer på den.
  for (const skrald of ['i går', 'engang i sommer', 'null', '2026-13-45T99:99:99Z']) {
    expect(gyldigtTidsstempel(skrald), `«${skrald}» skal afvises`).toBeNull();
  }
});

test('NEGATIV KONTROL på selve prøven: den kan overhovedet sige ja', () => {
  // Uden den ville «alt giver null» bestå lige så grønt som en virkende
  // funktion — og det er præcis den fejl vagten findes for.
  expect(gyldigtTidsstempel('2026-01-01T00:00:00Z')).not.toBeNull();
});

// ── parseOp: dét sted tidspunktet FAKTISK blev tabt ────────────────────────
import { parseOp } from './candidates.js';

/** Præcis den form Ambients relay sender — bemærk: INTET `op`-felt. */
const AMBIENT_METADATA = JSON.stringify({
  connector: 'trail-ambient-capture',
  sourceUrl: 'ambient://focus-session/2026-09-10T14:00:00Z',
  capturedAt: '2026-09-10T14:13:24Z',
});

const kandidat = (metadata: string | null) =>
  ({ metadata } as unknown as Parameters<typeof parseOp>[0]);

test('DEN BÆRENDE: Ambient-metadata UDEN op-felt beholder capturedAt', () => {
  // Den gamle udgave krævede `parsed.op` og returnerede `{op:'create'}` —
  // altså blev hele objektet kasseret, og optagetidspunktet forsvandt for
  // hver eneste Ambient-Neuron uden at noget fejlede.
  const op = parseOp(kandidat(AMBIENT_METADATA));
  expect(op.capturedAt).toBe('2026-09-10T14:13:24Z');
  expect(op.op).toBe('create'); // standarden er uændret
});

test('et EKSPLICIT op vinder stadig — den gamle vej er urørt', () => {
  const op = parseOp(kandidat(JSON.stringify({ op: 'archive', targetDocumentId: 'doc_1' })));
  expect(op.op).toBe('archive');
  expect(op.targetDocumentId).toBe('doc_1');
});

test('ingen metadata og ugyldig JSON giver stadig et rent create', () => {
  expect(parseOp(kandidat(null)).op).toBe('create');
  expect(parseOp(kandidat('{ ikke json')).op).toBe('create');
  expect(parseOp(kandidat('"en streng, ikke et objekt"')).op).toBe('create');
  expect(parseOp(kandidat('null')).op).toBe('create');
});
