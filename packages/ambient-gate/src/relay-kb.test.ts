/**
 * F268.1 — beviset for at relayet ALDRIG gætter sin videnbase, og aldrig
 * genafsender ni dages historik af sig selv.
 *
 * Prøverne findes på grund af én måling (10/9 2026): 535 arbejdsnoter fra
 * 1.–10. september landede i broberg.ai, den Trail hjemmesidens chat svarer
 * fra. To fejl skulle mødes for at gøre det:
 *
 *   · valget          relayet tog `trail.kbIds[0]` og læste aldrig ejerens valg
 *   · genafsendelsen  hver opstart læste loggen fra byte 0 igen
 *
 * Første prøve i hver blok er en NEGATIV KONTROL: den er rød på præcis den
 * gamle kode. Uden den beviser grønt kun at prøvedata var venlige.
 */
import { describe, expect, test } from 'bun:test';
import { vaelgKb, startOffset, kbSkift } from './relay.js';

const A = 'kb-aaaa';
const B = 'kb-bbbb';

describe('vaelgKb', () => {
  test('gætter ikke: intet valgt → null, ikke listens første', () => {
    // Den gamle kode svarede A her. DET er fejlen der kostede 535 noter.
    expect(vaelgKb({ valgt: null, tilladte: [A, B] })).toBeNull();
    expect(vaelgKb({ valgt: '   ', tilladte: [A, B] })).toBeNull();
  });

  test('bruger ejerens valg', () => {
    expect(vaelgKb({ valgt: B, tilladte: [A, B] })).toBe(B);
  });

  test('rækkefølgen i parringens liste betyder intet', () => {
    expect(vaelgKb({ valgt: B, tilladte: [B, A] })).toBe(B);
    expect(vaelgKb({ valgt: B, tilladte: [A, B] })).toBe(B);
  });

  test('et valg uden adgang giver null — det falder ikke tilbage til en anden', () => {
    expect(vaelgKb({ valgt: 'kb-cccc', tilladte: [A, B] })).toBeNull();
  });

  test('kan ikke slå adgangslisten fra ved at have en tom liste og et valg', () => {
    // Tom liste = vi kunne ikke læse parringen. Så er valget det eneste vi har,
    // og det er stadig ejerens — ikke et gæt.
    expect(vaelgKb({ valgt: A, tilladte: [] })).toBe(A);
    expect(vaelgKb({ valgt: null, tilladte: [] })).toBeNull();
  });

  test('env slår igennem (bevidst, til test og fejlsøgning)', () => {
    expect(vaelgKb({ valgt: null, tilladte: [A], env: 'kb-env' })).toBe('kb-env');
  });
});

describe('startOffset', () => {
  test('genafsender ikke historikken ved opstart', () => {
    // Den gamle kode svarede 0 her → hele loggen igen. Mod en NY videnbase
    // findes motorens dubletspærre ikke, og 9 dage blev til 518 noter.
    expect(startOffset(4_096, false)).toBe(4_096);
  });

  test('--backfill er en bevidst handling, ikke normaltilstanden', () => {
    expect(startOffset(4_096, true)).toBe(0);
  });

  test('en tom log starter på 0 uanset hvad', () => {
    expect(startOffset(0, false)).toBe(0);
  });
});

describe('kbSkift — ambient samler ALTID til den samme Trail', () => {
  test('et skift ingen har bekræftet spærrer afsendelsen', () => {
    // Ejerens regel: «kun 1 trail og ALTID den samme trail». Uden denne port
    // kunne et forkert valg flytte opsamlingen igen, lige så tavst som 9/9.
    const r = kbSkift({ valgt: B, sidst: A, accepteret: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.grund).toContain(A);
      expect(r.grund).toContain(B);
      expect(r.grund).toContain('--accept-kb-change');
    }
  });

  test('samme mål som sidst → uændret', () => {
    expect(kbSkift({ valgt: A, sidst: A, accepteret: false }).ok).toBe(true);
  });

  test('første kørsel har intet at sammenligne med', () => {
    expect(kbSkift({ valgt: A, sidst: null, accepteret: false }).ok).toBe(true);
  });

  test('et bevidst skift slipper igennem', () => {
    expect(kbSkift({ valgt: B, sidst: A, accepteret: true }).ok).toBe(true);
  });
});
