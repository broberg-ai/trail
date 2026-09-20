/**
 * F212.3 — TID SIDEN SIDSTE SUCCES, ALDRIG SIDEN SIDSTE FORSØG.
 *
 * Det er hele kortets pointe, og det er en påstand man kan bestå ved et
 * uheld: mens udrulningen var brudt i to måneder, blev der FORSØGT dagligt.
 * En forsøgs-baseret kontrol havde været grøn hele vejen.
 *
 * Her er skellet STRUKTURELT frem for omhyggeligt, og det er værd at kunne
 * læse: `reportDeploy()` sender kun `status: 'success'`, og den affyres
 * FRA DEN BOOTEDE APP. En række kan altså kun findes hvis et build både
 * blev bygget OG startede. Registret kan ikke indeholde et forsøg.
 *
 * TRE TILSTANDE, IKKE TO. «Kan ikke læses» er sin egen tilstand og
 * alarmerer: et register vi ikke kan nå er ikke bevis på at udrulningen er
 * frisk. Det er sådan en kontrol går tavst grøn når dens egen afhængighed
 * knækker — samme fejlform som resten af epicen, ét led længere ude.
 *
 * MUTATIONS-TJEK, kørt 20. september 2026. Baseline 9/9 grønne:
 *   - `ageDays > maxAgeDays` → `>=`               8 pass / 1 fail
 *       rød: «præcis 14 dage er endnu ikke forældet».
 *   - `unreachable`-grenen returnerer 'fresh'     7 pass / 2 fail
 *       rød: «et ulæseligt register alarmerer» OG «en HTTP-fejl er ukendt,
 *       ikke frisk». Det er mutationen der ville lade kontrollen gå tavst
 *       grøn når Upmetrics er nede.
 *   - `!reading.deployedAt` → 'fresh'             7 pass / 2 fail
 *       rød: «et site der aldrig er udrullet alarmerer» OG readRelease-
 *       prøven, som læser no_release gennem en rigtig HTTP-attrap.
 *   - sæt alderen ind i `message`                 8 pass / 1 fail
 *       rød: «beskeden bærer ikke den levende alder» — samme frosne-titel-
 *       problem som disk-vagten, målt samme dag.
 *   - `Number.isFinite(at)`-værnet væk            8 pass / 1 fail
 *       rød: «en ulæselig dato er UKENDT, ikke nul dage gammel». NaN er
 *       hverken > eller <= tærsklen, så den ville blive «frisk».
 *   - `res.ok`-tjekket FØR kroppen læses (min egen
 *     første udgave, fundet af live-proben)       10 pass / 1 fail
 *       rød: «no_release kommer med HTTP 404». Attrappen i den tidligere
 *       udgave af prøven svarede 200, så ingen enhedsprøve kunne fange
 *       det — kun et kald mod det ægte register.
 */
import { test, expect } from 'bun:test';
import { judgeRelease, readRelease, MAX_DEPLOY_AGE_DAYS } from './deploy-freshness.js';

const NOW = new Date('2026-09-20T12:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const judge = (r: Parameters<typeof judgeRelease>[0], maxAgeDays?: number) =>
  judgeRelease(r, { site: 'trail-engine-001', now: NOW, maxAgeDays });

test('en udrulning fra i dag er frisk', () => {
  const v = judge({ deployedAt: daysAgo(0.1), sha: 'c4e5c26' });
  expect(v.state).toBe('fresh');
});

test('præcis 14 dage er endnu ikke forældet — 14,1 er', () => {
  expect(judge({ deployedAt: daysAgo(MAX_DEPLOY_AGE_DAYS), sha: 'x' }).state).toBe('fresh');
  expect(judge({ deployedAt: daysAgo(MAX_DEPLOY_AGE_DAYS + 0.1), sha: 'x' }).state).toBe('stale');
});

test('to måneder uden en succes alarmerer — den faktiske hændelse', () => {
  // 23. august → 20. september, den periode hvor hver udrulning fejlede
  // i Docker-bygget mens den gamle version blev ved med at svare.
  const v = stale(judge({ deployedAt: daysAgo(58), sha: 'gammel' }));
  expect(v.ageDays).toBe(58);
});

/** Narrow to the stale shape so the assertions cannot read `undefined`. */
function stale(v: ReturnType<typeof judge>): { ageDays: number; message: string } {
  if (v.state !== 'stale') throw new Error(`expected stale, got ${v.state}`);
  return v;
}

test('beskeden bærer IKKE den levende alder — kun tærsklen', () => {
  const a = stale(judge({ deployedAt: daysAgo(17), sha: 'x' }));
  const b = stale(judge({ deployedAt: daysAgo(58), sha: 'x' }));
  // Issue-titlen fryser ved første hændelse, så «17 dage» ville stadig
  // stå der ved 60. Alderen ligger i tags i stedet.
  expect(a.message).toBe(b.message);
  expect(a.message).toContain('over 14 days');
  expect(a.message).not.toContain('17');
  expect(b.message).not.toContain('58');
  // Men alderen er BEVARET på verdict'et, så tag og log kan vise den.
  expect(a.ageDays).toBe(17);
  expect(b.ageDays).toBe(58);
});

test('et site der ALDRIG er udrullet alarmerer — og det er sin egen tilstand', () => {
  const v = judge({ deployedAt: null, sha: null });
  expect(v.state).toBe('never');
  expect(v.state === 'never' && v.message).toContain('no successful deploy has ever');
});

test('et register vi ikke kan NÅ alarmerer — ukendt er ikke frisk', () => {
  const v = judge({ deployedAt: null, sha: null, unreachable: 'fetch failed' });
  expect(v.state).toBe('unknown');
  expect(v.state === 'unknown' && v.message).toContain('cannot tell');
  expect(v.state === 'unknown' && v.message).toContain('fetch failed');
});

test('en HTTP-fejl er UKENDT, ikke frisk og ikke «aldrig»', () => {
  // Forskellen betyder noget: «aldrig udrullet» peger på et forkert
  // site-navn, «kan ikke nås» peger på Upmetrics. To forskellige remedier.
  const v = judge({ deployedAt: null, sha: null, unreachable: 'HTTP 502' });
  expect(v.state).toBe('unknown');
});

test('en ulæselig dato er UKENDT, ikke nul dage gammel', () => {
  // `Date.parse('i går') = NaN`, og NaN i et regnestykke ville have givet
  // en alder på NaN, som hverken er > eller <= tærsklen — altså «frisk»
  // ved et uheld.
  const v = judge({ deployedAt: 'i går', sha: 'x' });
  expect(v.state).toBe('unknown');
  expect(v.state === 'unknown' && v.message).toContain('unreadable date');
});

test('no_release kommer med HTTP 404 — og skal stadig læses som «aldrig»', async () => {
  // MÅLT mod det levende register 20/9 2026: status ER 404, og kroppen ER
  // {"error":"no_release"}. Første udgave af readRelease tjekkede res.ok
  // FØRST og meldte «kan ikke fastslås» for et site der blot aldrig havde
  // udrullet. Live-proben fandt det; ingen enhedsprøve kunne have gjort
  // det, for jeg havde selv skrevet attrappen til at svare 200.
  const stub = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(JSON.stringify({ error: 'no_release', site: 'nope' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
  });
  try {
    const r = await readRelease('nope', `http://127.0.0.1:${stub.port}`);
    expect(r.deployedAt).toBe(null);
    expect(r.unreachable).toBeUndefined();
    expect(judge(r).state).toBe('never');
  } finally {
    stub.stop(true);
  }
});

test('en 502 UDEN brugbar krop er «kan ikke fastslås» — ikke «aldrig»', async () => {
  const stub = Bun.serve({ port: 0, fetch: () => new Response('gateway', { status: 502 }) });
  try {
    const r = await readRelease('x', `http://127.0.0.1:${stub.port}`);
    expect(r.unreachable).toContain('502');
    expect(judge(r).state).toBe('unknown');
  } finally {
    stub.stop(true);
  }
});

test('et 200-svar med et ægte tidsstempel læses som frisk', async () => {
  const stub = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(JSON.stringify({ site: 'trail-engine-001', sha: 'c4e5c26', deployedAt: daysAgo(0.5) }), {
        headers: { 'content-type': 'application/json' },
      }),
  });
  try {
    const r = await readRelease('trail-engine-001', `http://127.0.0.1:${stub.port}`);
    expect(r.sha).toBe('c4e5c26');
    expect(judge(r).state).toBe('fresh');
  } finally {
    stub.stop(true);
  }
});
