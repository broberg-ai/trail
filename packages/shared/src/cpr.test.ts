/**
 * F274 — CPR må ikke nå disken.
 *
 * DEN BÆRENDE PRØVE er den om modulus-11, og den er skrevet som et FORBUD:
 * ægte CPR-numre dumper den test siden 2007, så en validering på den ville
 * smide ægte numre væk som falske positive — altså fejle i den FARLIGE
 * retning, hvor nummeret slipper umaskeret igennem.
 *
 * Christians eget nummer bruges IKKE som prøvedata. Det ville lægge et rigtigt
 * CPR i repoet for at bevise at vi ikke vil have rigtige CPR'er i repoet.
 */
import { test, expect } from 'bun:test';
import { maskerCpr, seromCpr, erGyldigDato } from './cpr.js';

test('DEN BÆRENDE: et nummer der DUMPER modulus-11 maskeres alligevel', () => {
  // 010101-0000 har et ugyldigt kontrolciffer efter den gamle regel, og er
  // præcis den slags nummer CPR-registret har udstedt siden 2007.
  const { maskeret, antal } = maskerCpr('Patient 010101-0000 er booket');
  expect(antal).toBe(1);
  expect(maskeret).toBe('Patient [CPR fjernet] er booket');
});

test('med og uden bindestreg', () => {
  expect(maskerCpr('120385-1234').antal).toBe(1);
  expect(maskerCpr('1203851234').antal).toBe(1);
});

test('DATODELEN er det der adskiller et CPR fra et ordrenummer', () => {
  // Måned 13 og dag 32 findes ikke — det er ti cifre, ikke en fødselsdag.
  expect(maskerCpr('ordre 991399-1234').antal).toBe(0);
  expect(maskerCpr('ref 320185-1234').antal).toBe(0);
  // 31. februar findes heller ikke.
  expect(maskerCpr('id 310285-1234').antal).toBe(0);
  // Men 29. februar accepteres: århundredet er ikke entydigt i et CPR, så
  // skudår kan ikke afgøres — og at afvise ville smide ægte numre væk.
  expect(maskerCpr('290284-1234').antal).toBe(1);
});

test('ORDGRÆNSER: de sidste ti cifre af et langt tal er ikke et CPR', () => {
  expect(maskerCpr('transaktion 99120385123456').antal).toBe(0);
  expect(maskerCpr('99120385-1234').antal).toBe(0);
});

test('flere numre i samme tekst maskeres alle', () => {
  const r = maskerCpr('120385-1234 og 010101-0000 begge');
  expect(r.antal).toBe(2);
  expect(r.maskeret).toBe('[CPR fjernet] og [CPR fjernet] begge');
});

test('MARKØREN ER SYNLIG — et lydløst indgreb kan ikke skelnes fra intet', () => {
  expect(maskerCpr('120385-1234').maskeret).toContain('CPR fjernet');
});

test('NEGATIV KONTROL: almindelig tekst røres ikke', () => {
  // Uden den ville «alt bliver maskeret» bestå lige så grønt.
  for (const t of ['Ingen tal her', 'version 1.2.3', 'kl. 14.30 den 15/9', '2026-09-15']) {
    expect(maskerCpr(t).maskeret, t).toBe(t);
    expect(maskerCpr(t).antal).toBe(0);
  }
});

test('seromCpr svarer det samme som maskeringen — ét begreb, ikke to', () => {
  // To kopier af reglen er ikke gale den dag de skrives, men den dag den ene
  // bliver rettet.
  for (const t of ['120385-1234', 'ordre 991399-1234', 'ingenting', '010101-0000']) {
    expect(seromCpr(t), t).toBe(maskerCpr(t).antal > 0);
  }
});

test('erGyldigDato afviser det den skal, og kun det', () => {
  expect(erGyldigDato('12', '03', '85')).toBe(true);
  expect(erGyldigDato('31', '12', '99')).toBe(true);
  expect(erGyldigDato('31', '04', '85')).toBe(false); // april har 30
  expect(erGyldigDato('00', '01', '85')).toBe(false);
  expect(erGyldigDato('01', '00', '85')).toBe(false);
});

// ── F274.1: filnavnet er også en lækage-flade ─────────────────────────────
import { slugify } from './slug.js';

test('DEN BÆRENDE FOR F274.1: slug\'en af en maskeret titel bærer intet CPR', () => {
  // Fundet på PRODUKTION, ikke i en prøve: titlen blev maskeret, men
  // filnavnet blev dannet af den RÅ titel og endte som
  // «f274-live-kontrol-010101-0000.md». Filnavnet er slug'en — den står i
  // URL'en, i listen og i hvert [[link]].
  const raa = 'F274 live-kontrol 010101-0000';
  expect(slugify(raa)).toContain('010101-0000');            // sådan så fejlen ud
  expect(slugify(maskerCpr(raa).maskeret)).not.toContain('010101');
  expect(slugify(maskerCpr(raa).maskeret)).not.toContain('0000');
});
