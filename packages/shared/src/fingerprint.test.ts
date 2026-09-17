/**
 * F275.6 — the fingerprint must be able to say BOTH yes and no.
 *
 * A similarity measure that always answers "same work" passes just as green as
 * one that works. So every claim here has its counterpart.
 *
 * The fixture documents stay in Danish on purpose. MinHash works on words, and
 * the documents customers actually upload are Danish — an English fixture would
 * measure a word distribution we do not serve.
 */
import { test, describe, it, expect } from 'bun:test';
import { fingerprint, similarity, nameVerdict, ASK_ABOVE, MINHASH_K } from './fingerprint.js';

/** A document long enough to measure — like a real report. */
const REPORT = `
Årsrapport 2025 for Broberg ApS. Selskabet har i regnskabsåret realiseret en
omsætning på 12,4 millioner kroner mod 9,8 millioner året før. Væksten kommer
primært fra nye kundeaftaler inden for hosting og softwareudvikling. Resultatet
før skat udgør 2,1 millioner kroner. Bestyrelsen indstiller at årets resultat
overføres til næste regnskabsår. Selskabet beskæftigede i gennemsnit fire
medarbejdere. Ledelsen forventer fortsat vækst i det kommende regnskabsår,
drevet af den samme kombination af hosting og udvikling som hidtil.
`;

/** The SAME document, only the year edited — the owner's own example. */
const REPORT_OTHER_YEAR = REPORT.replace('2025', '2026');

/** A genuinely DIFFERENT document on a related topic. */
const OTHER = `
Databehandleraftale mellem Broberg ApS og kunden. Aftalen regulerer behandling af
personoplysninger i forbindelse med levering af hosting. Databehandleren må alene
behandle oplysninger efter dokumenteret instruks fra den dataansvarlige.
Oplysningerne opbevares inden for EU og slettes ved aftalens ophør. Parterne er
enige om at tekniske og organisatoriske sikkerhedsforanstaltninger skal afspejle
risikoen ved behandlingen. Aftalen træder i kraft ved underskrift.
`;

describe('F275.6 AC#0 — a checksum cannot do this', () => {
  it('one edited year barely moves the fingerprint', () => {
    const s = similarity(fingerprint(REPORT), fingerprint(REPORT_OTHER_YEAR))!;
    expect(s).toBeGreaterThan(ASK_ABOVE);
    expect(s).toBeLessThan(1); // … but it is not the SAME document
  });

  it('… while an exact comparison would say "completely different"', () => {
    // The very reason we do not use a checksum: the two strings differ, so a
    // hash could never see that they are the same work.
    expect(REPORT).not.toBe(REPORT_OTHER_YEAR);
    expect(fingerprint(REPORT)).not.toBe(fingerprint(REPORT_OTHER_YEAR));
  });

  it('identical text yields an identical fingerprint', () => {
    expect(fingerprint(REPORT)).toBe(fingerprint(REPORT));
    expect(similarity(fingerprint(REPORT), fingerprint(REPORT))).toBe(1);
  });

  it('line wrapping and punctuation do NOT count as a difference', () => {
    // Two versions of the same PDF, one re-exported: same WORDS, different layout.
    //
    // The fixture first stripped commas too — and THE TEST CAUGHT ME: "12,4"
    // becomes "124", i.e. a different NUMBER. That is a content change disguised
    // as formatting, and the similarity correctly fell to 0.625. Only genuine
    // layout is varied here: line breaks, double spaces, spaces around marks.
    const reflowed = REPORT.replace(/\n/g, '  ').replace(/\./g, ' . ') + '   ';
    expect(similarity(fingerprint(REPORT), fingerprint(reflowed))).toBe(1);
  });
});

describe('F275.6 AC#4 — the fingerprint must be able to say NO', () => {
  it('two genuinely different documents do NOT resemble each other', () => {
    // Without this, "always answer same work" passes just as green as the rule.
    const s = similarity(fingerprint(REPORT), fingerprint(OTHER))!;
    expect(s).toBeLessThan(ASK_ABOVE);
  });

  it('… and sharing a sender does not pull them together', () => {
    // Both mention "Broberg ApS" and "hosting". Shared words are not a shared work.
    expect(similarity(fingerprint(REPORT), fingerprint(OTHER))).toBeLessThan(0.3);
  });
});

describe('F275.6 AC#5 — "cannot be decided" is a THIRD state', () => {
  it('a scanned PDF with no text layer has no fingerprint — and is not "new source"', () => {
    expect(fingerprint('')).toBeNull();
    expect(fingerprint(null)).toBeNull();
    expect(fingerprint('   \n  ')).toBeNull();
    // A few words from an OCR attempt are not enough to measure either.
    expect(fingerprint('Side 1 af 4')).toBeNull();
  });

  it('with one of two fingerprints missing, similarity is NULL — not zero', () => {
    // 0 would mean "measured as completely different". null means "not measured".
    expect(similarity(fingerprint(REPORT), null)).toBeNull();
    expect(similarity(null, null)).toBeNull();
    expect(similarity(fingerprint(REPORT), 'too short')).toBeNull();
  });

  it('and the name verdict says so OUT LOUD rather than guessing', () => {
    expect(nameVerdict(null, true)).toBe('undecidable');
    expect(nameVerdict(null, false)).toBe('undecidable');
  });
});

describe('F275.6 AC#3 — the filename is a WARNING LIGHT, four cases', () => {
  it('high similarity + SAME name = new edition', () => {
    expect(nameVerdict(0.97, true)).toBe('new-edition');
  });
  it('high similarity + DIFFERENT name = same work under a new name', () => {
    expect(nameVerdict(0.97, false)).toBe('same-work-new-name');
  });
  it('LOW similarity + SAME name = NAME COLLISION — two works fighting over one name', () => {
    // The most important of the four. With filename + Brain as the identity,
    // this is EXACTLY where a silent overwrite would happen, and it is invisible
    // afterwards.
    expect(nameVerdict(0.12, true)).toBe('name-collision');
  });
  it('low similarity + different name = a new source, and we say nothing', () => {
    expect(nameVerdict(0.12, false)).toBe('new-source');
  });
  it('the threshold is inclusive at its own boundary', () => {
    expect(nameVerdict(ASK_ABOVE, true)).toBe('new-edition');
    expect(nameVerdict(ASK_ABOVE - 0.0001, true)).toBe('name-collision');
  });
});

describe('F275.6 — the shape of the signature', () => {
  it('fixed width, so two can always be compared slot by slot', () => {
    expect(fingerprint(REPORT)!.length).toBe(MINHASH_K * 8);
    expect(fingerprint(OTHER)!.length).toBe(MINHASH_K * 8);
  });
  it('a corrupted signature yields NULL, not a false number', () => {
    expect(similarity('abc', fingerprint(REPORT))).toBeNull();
  });
});
