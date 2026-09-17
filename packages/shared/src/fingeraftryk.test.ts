/**
 * F275.6 — fingeraftrykket skal kunne sige BÅDE ja og nej.
 *
 * En lighedsmåling der altid svarer «samme værk» består lige så grønt som en der
 * virker. Derfor har hver påstand her sin modpart.
 */
import { test, describe, it, expect } from 'bun:test';
import { fingeraftryk, lighed, navnesag, SPØRG_OVER, MINHASH_K } from './fingeraftryk.js';

/** Et dokument langt nok til at måle på — som en rigtig rapport. */
const RAPPORT = `
Årsrapport 2025 for Broberg ApS. Selskabet har i regnskabsåret realiseret en
omsætning på 12,4 millioner kroner mod 9,8 millioner året før. Væksten kommer
primært fra nye kundeaftaler inden for hosting og softwareudvikling. Resultatet
før skat udgør 2,1 millioner kroner. Bestyrelsen indstiller at årets resultat
overføres til næste regnskabsår. Selskabet beskæftigede i gennemsnit fire
medarbejdere. Ledelsen forventer fortsat vækst i det kommende regnskabsår,
drevet af den samme kombination af hosting og udvikling som hidtil.
`;

/** SAMME dokument, kun årstallet rettet — Christians eget eksempel. */
const RAPPORT_ANDET_AAR = RAPPORT.replace('2025', '2026');

/** Et ægte ANDET dokument om et beslægtet emne. */
const ANDET = `
Databehandleraftale mellem Broberg ApS og kunden. Aftalen regulerer behandling af
personoplysninger i forbindelse med levering af hosting. Databehandleren må alene
behandle oplysninger efter dokumenteret instruks fra den dataansvarlige.
Oplysningerne opbevares inden for EU og slettes ved aftalens ophør. Parterne er
enige om at tekniske og organisatoriske sikkerhedsforanstaltninger skal afspejle
risikoen ved behandlingen. Aftalen træder i kraft ved underskrift.
`;

describe('F275.6 AC#0 — en checksum kan ikke det her', () => {
  it('ét rettet årstal ændrer fingeraftrykket NÆSTEN ikke', () => {
    const l = lighed(fingeraftryk(RAPPORT), fingeraftryk(RAPPORT_ANDET_AAR))!;
    expect(l).toBeGreaterThan(SPØRG_OVER);
    expect(l).toBeLessThan(1); // … men det er ikke det SAMME dokument
  });

  it('… mens en exakt sammenligning ville sige «helt forskellige»', () => {
    // Selve grunden til at vi ikke bruger en checksum: de to strenge er
    // forskellige, og en hash ville derfor ikke kunne se at de er samme værk.
    expect(RAPPORT).not.toBe(RAPPORT_ANDET_AAR);
    expect(fingeraftryk(RAPPORT)).not.toBe(fingeraftryk(RAPPORT_ANDET_AAR));
  });

  it('identisk tekst giver identisk aftryk', () => {
    expect(fingeraftryk(RAPPORT)).toBe(fingeraftryk(RAPPORT));
    expect(lighed(fingeraftryk(RAPPORT), fingeraftryk(RAPPORT))).toBe(1);
  });

  it('linjeombrydning og tegnsætning tæller IKKE som en forskel', () => {
    // To udgaver af samme PDF, den ene gen-eksporteret: samme ORD, anden opsætning.
    //
    // Fiksturen fjernede først også kommaerne — og PRØVEN FANGEDE MIG: «12,4»
    // bliver til «124», altså et andet TAL. Det er en indholdsændring forklædt
    // som en formatering, og ligheden faldt korrekt til 0,625. Kun ægte layout
    // varieres her: linjeskift, dobbelte mellemrum, mellemrum omkring tegn.
    const omsat = RAPPORT.replace(/\n/g, '  ').replace(/\./g, ' . ') + '   ';
    expect(lighed(fingeraftryk(RAPPORT), fingeraftryk(omsat))).toBe(1);
  });
});

describe('F275.6 AC#4 — fingeraftrykket skal kunne sige NEJ', () => {
  it('to ægte forskellige dokumenter ligner IKKE hinanden', () => {
    // Uden denne består «svar altid samme værk» lige så grønt som reglen.
    const l = lighed(fingeraftryk(RAPPORT), fingeraftryk(ANDET))!;
    expect(l).toBeLessThan(SPØRG_OVER);
  });

  it('… og de deler samme afsender uden at det trækker dem sammen', () => {
    // Begge nævner «Broberg ApS» og «hosting». Fælles ord er ikke fælles værk.
    expect(lighed(fingeraftryk(RAPPORT), fingeraftryk(ANDET))).toBeLessThan(0.3);
  });
});

describe('F275.6 AC#5 — «kan ikke afgøres» er en TREDJE tilstand', () => {
  it('en scannet PDF uden tekstlag har intet aftryk — og er ikke «ny kilde»', () => {
    expect(fingeraftryk('')).toBeNull();
    expect(fingeraftryk(null)).toBeNull();
    expect(fingeraftryk('   \n  ')).toBeNull();
    // Nogle få ord fra et OCR-forsøg er heller ikke nok til at måle på.
    expect(fingeraftryk('Side 1 af 4')).toBeNull();
  });

  it('mangler ét af to aftryk, er ligheden NULL — ikke nul', () => {
    // 0 ville betyde «målt til helt forskellige». null betyder «ikke målt».
    expect(lighed(fingeraftryk(RAPPORT), null)).toBeNull();
    expect(lighed(null, null)).toBeNull();
    expect(lighed(fingeraftryk(RAPPORT), 'for kort')).toBeNull();
  });

  it('og navnesagen siger det HØJT frem for at gætte', () => {
    expect(navnesag(null, true)).toBe('kan-ikke-afgoeres');
    expect(navnesag(null, false)).toBe('kan-ikke-afgoeres');
  });
});

describe('F275.6 AC#3 — filnavnet er en ADVARSELSLAMPE, fire tilfælde', () => {
  it('høj lighed + SAMME navn = ny udgave', () => {
    expect(navnesag(0.97, true)).toBe('ny-udgave');
  });
  it('høj lighed + ANDET navn = samme værk under nyt navn', () => {
    expect(navnesag(0.97, false)).toBe('samme-vaerk-nyt-navn');
  });
  it('LAV lighed + SAMME navn = NAVNEKOLLISION — to værker slås om ét navn', () => {
    // Den vigtigste af de fire. Med filnavn+Brain som identitet er det NETOP
    // her en lydløs overskrivning ville ske, og den er usynlig bagefter.
    expect(navnesag(0.12, true)).toBe('navnekollision');
  });
  it('lav lighed + andet navn = ny kilde, og vi siger intet', () => {
    expect(navnesag(0.12, false)).toBe('ny-kilde');
  });
  it('tærsklen er inklusiv i sin egen grænse', () => {
    expect(navnesag(SPØRG_OVER, true)).toBe('ny-udgave');
    expect(navnesag(SPØRG_OVER - 0.0001, true)).toBe('navnekollision');
  });
});

describe('F275.6 — signaturens form', () => {
  it('fast bredde, så to altid kan sammenlignes plads for plads', () => {
    expect(fingeraftryk(RAPPORT)!.length).toBe(MINHASH_K * 8);
    expect(fingeraftryk(ANDET)!.length).toBe(MINHASH_K * 8);
  });
  it('en ødelagt signatur giver NULL, ikke et falsk tal', () => {
    expect(lighed('abc', fingeraftryk(RAPPORT))).toBeNull();
  });
});
