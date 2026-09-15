/**
 * F273.1 — prøverne på tidsvinduet.
 *
 * Den bærende er VINTER-prøven. Hele fejlklassen her er «læg to timer til»,
 * og den er rigtig hele sommeren. En prøvesuite med kun september-datoer ville
 * være grøn på et hardkodet +02:00 — altså grøn på præcis den fejl den skulle
 * fange, i et halvt år.
 */
import { test, expect } from 'bun:test';
import {
  byggTidsvindue,
  laesVaegur,
  vaegurTilOejeblik,
  tilUtcNoegle,
  formatDansk,
  DANSK_ZONE,
} from './tidsvindue.js';

test('SOMMER (CEST, UTC+2): 10/9 kl. 16:00 dansk = 14:00 UTC', () => {
  const r = byggTidsvindue('2026-09-10T16:00', '2026-09-10T17:30');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.vindue.fraNoegle).toBe('2026-09-10 14:00:00');
  expect(r.vindue.tilNoegle).toBe('2026-09-10 15:30:00');
});

test('DEN BÆRENDE — VINTER (CET, UTC+1): 10/1 kl. 16:00 dansk = 15:00 UTC', () => {
  // Et hardkodet +02:00 ville give 14:00:00 her og bestå sommer-prøven.
  const r = byggTidsvindue('2026-01-10T16:00', '2026-01-10T17:30');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.vindue.fraNoegle).toBe('2026-01-10 15:00:00');
  expect(r.vindue.tilNoegle).toBe('2026-01-10 16:30:00');
});

test('forskydningen skifter MELLEM de to — samme vægur, forskellig nøgle', () => {
  const sommer = byggTidsvindue('2026-07-01T12:00', undefined);
  const vinter = byggTidsvindue('2026-12-01T12:00', undefined);
  expect(sommer.ok && vinter.ok).toBe(true);
  if (!sommer.ok || !vinter.ok) return;
  expect(sommer.vindue.fraNoegle).toBe('2026-07-01 10:00:00');
  expect(vinter.vindue.fraNoegle).toBe('2026-12-01 11:00:00');
  // Selve påstanden: de er IKKE ens. En fast forskydning ville gøre dem ens.
  expect(sommer.vindue.fraNoegle).not.toBe(vinter.vindue.fraNoegle);
});

test('en bar dato dækker HELE dagen i dansk tid', () => {
  const r = byggTidsvindue('2026-09-10', '2026-09-10');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  // 00:00:00 dansk = 22:00 UTC dagen før; 23:59:59 dansk = 21:59:59 UTC samme dag.
  expect(r.vindue.fraNoegle).toBe('2026-09-09 22:00:00');
  expect(r.vindue.tilNoegle).toBe('2026-09-10 21:59:59');
});

test('nøglerne kan sammenlignes som TEKST mod det created_at faktisk indeholder', () => {
  // Præcis de former produktionen står i (målt 15/9 2026: 1.574/1.574).
  const raekker = ['2026-09-10 13:30:00', '2026-09-10 14:15:00', '2026-09-10 15:29:59', '2026-09-10 16:01:00'];
  const r = byggTidsvindue('2026-09-10T16:00', '2026-09-10T17:30');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const i = raekker.filter((k) => k >= r.vindue.fraNoegle! && k <= r.vindue.tilNoegle!);
  expect(i).toEqual(['2026-09-10 14:15:00', '2026-09-10 15:29:59']);
});

test('det OPLØSTE vindue kommer tilbage i dansk tid med zonenavn', () => {
  const r = byggTidsvindue('2026-09-10T16:00', '2026-09-10T17:30');
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.vindue.opløst.fra).toBe('2026-09-10 16:00:00');
  expect(r.vindue.opløst.til).toBe('2026-09-10 17:30:00');
  expect(r.vindue.opløst.zone).toBe(DANSK_ZONE);
});

test('kun den ene ende er også et gyldigt vindue', () => {
  const a = byggTidsvindue('2026-09-10', undefined);
  const b = byggTidsvindue(undefined, '2026-09-10');
  expect(a.ok && b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(a.vindue.tilNoegle).toBeUndefined();
  expect(b.vindue.fraNoegle).toBeUndefined();
  expect(a.vindue.opløst.til).toBeNull();
});

test('intet vindue overhovedet er gyldigt og filtrerer ingenting', () => {
  const r = byggTidsvindue(undefined, undefined);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.vindue.fraNoegle).toBeUndefined();
  expect(r.vindue.tilNoegle).toBeUndefined();
});

test('DEN TREDJE TILSTAND: en ugyldig dato er en FEJL, ikke et tomt vindue', () => {
  for (const d of ['i går', '10-09-2026', '2026-13-01', '2026-02-31', '2026-09-10T25:00']) {
    const r = byggTidsvindue(d, undefined);
    expect(r.ok, `«${d}» skal afvises`).toBe(false);
    if (!r.ok) expect(r.fejl).toContain('Ugyldig');
  }
});

test('from efter to afvises frem for at give en tom liste', () => {
  const r = byggTidsvindue('2026-09-11', '2026-09-10');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.fejl).toContain('efter');
});

test('laesVaegur: bar dato får 00:00:00 som start og 23:59:59 som slut', () => {
  expect(laesVaegur('2026-09-10', 'start')).toMatchObject({ time: 0, minut: 0, sekund: 0 });
  expect(laesVaegur('2026-09-10', 'slut')).toMatchObject({ time: 23, minut: 59, sekund: 59 });
});

test('mellemrum virker som skilletegn ligesom T', () => {
  const a = byggTidsvindue('2026-09-10T16:00', undefined);
  const b = byggTidsvindue('2026-09-10 16:00', undefined);
  expect(a.ok && b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  expect(a.vindue.fraNoegle).toBe(b.vindue.fraNoegle);
});

test('midnat dansk tid taber ikke en dag (24-timers-fælden)', () => {
  const v = laesVaegur('2026-06-15T00:00', 'start')!;
  expect(formatDansk(vaegurTilOejeblik(v))).toBe('2026-06-15 00:00:00');
  expect(tilUtcNoegle(vaegurTilOejeblik(v))).toBe('2026-06-14 22:00:00');
});
