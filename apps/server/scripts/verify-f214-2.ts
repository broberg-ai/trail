/**
 * F214.2 — pager `?cursor` faktisk, og kan en afkortet side skelnes fra en hel?
 *
 * Fejlen var ikke en manglende funktion. `cursor` STOD i skemaet og blev aldrig
 * læst, så en kaldende der skrev sin løkke ud fra skemaet fik 200 OK og side 1
 * igen og igen. Målt på prod 29-08: count=7403, og 200 rækker nåelige. Intet
 * fejlede.
 *
 * Den prøve der betyder mest her er KOLLISIONS-prøven. `createdAt` er
 * sekund-opløst og kolliderer (målt: 190 unikke ud af 200 rækker), og
 * batch-skrivere laver klynger af samme sekund. En cursor på tid alene ville
 * springe rækker over præcis dér — tavst, og kun under belastning. Derfor
 * ligger klyngen her HEN OVER en sidegrænse.
 *
 * Kør fra apps/server:  bun run scripts/verify-f214-2.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, queueCandidates } from '@trail/db';
import { createApp } from '../src/app.js';

const T = 't-f2142', U = 'u-f2142', KB = 'kb-f2142';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f2142-${process.env.USER ?? 'x'}.db`);
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) { try { rmSync(f, { force: true }); } catch { /* første kørsel */ } }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await trail.db.insert(tenants).values({ id: T, slug: 'f2142', name: 'F2142', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f2142@local.trail', displayName: 'F', role: 'owner', onboarded: true }).run();
await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'KB', slug: 'kb', language: 'da' }).run();
await trail.db.insert(sessions).values({ id: 'sess-f2142', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();

// 12 kandidater. r05–r10 deler ÉT sekund — klyngen der med limit=5 ligger hen
// over grænsen mellem side 1 og side 2. Det er hele grunden til at id er med i
// cursoren; uden den er ordenen ikke total og en keyset-cursor er udefineret.
const SAME = '2026-08-20 12:00:00';
const rows = [
  { id: 'r01', createdAt: '2026-08-24 10:00:00' },
  { id: 'r02', createdAt: '2026-08-23 10:00:00' },
  { id: 'r03', createdAt: '2026-08-22 10:00:00' },
  { id: 'r04', createdAt: '2026-08-21 10:00:00' },
  { id: 'r05', createdAt: SAME }, { id: 'r06', createdAt: SAME },
  { id: 'r07', createdAt: SAME }, { id: 'r08', createdAt: SAME },
  { id: 'r09', createdAt: SAME }, { id: 'r10', createdAt: SAME },
  { id: 'r11', createdAt: '2026-08-19 10:00:00' },
  { id: 'r12', createdAt: '2026-08-18 10:00:00' },
];
await trail.db.insert(queueCandidates).values(
  rows.map((r) => ({
    id: r.id, tenantId: T, knowledgeBaseId: KB, kind: 'external-feed' as const,
    title: r.id, content: 'x', metadata: JSON.stringify({ connector: 'api' }),
    status: 'pending' as const, createdAt: r.createdAt,
  })),
).run();

// Formatet er en forudsætning for at streng-sammenligning ER tids-sammenligning.
// Lander der en dag et ISO-Z-format i kolonnen, skal DENNE gå rød frem for at
// pagineringen bliver stille forkert.
const fmt = await trail.client.execute("SELECT DISTINCT created_at FROM queue_candidates");
const allSameShape = (fmt.rows as unknown as Array<{ created_at: string }>)
  .every((r) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(r.created_at)));
check('createdAt har ét format, så leksikografisk = kronologisk', allSameShape,
  `${fmt.rows.length} distinkte værdier`);

const app = createApp(trail, new Map([['f2142', trail]]));
type Page = { items: Array<{ id: string }>; count: number; nextCursor: string | null };
async function get(qs: string): Promise<{ status: number; body: Page & { error?: string } }> {
  const res = await app.request(`http://engine.local/api/v1/queue?${qs}`, {
    headers: { Cookie: 'session=sess-f2142' },
  });
  return { status: res.status, body: (await res.json()) as Page & { error?: string } };
}

// ── AC1 — to på hinanden følgende sider er DISJUNKTE ────────────────────────
const p1 = await get('limit=5');
const p2 = await get(`limit=5&cursor=${encodeURIComponent(p1.body.nextCursor ?? '')}`);
const ids1 = p1.body.items.map((i) => i.id);
const ids2 = p2.body.items.map((i) => i.id);
const overlap = ids1.filter((i) => ids2.includes(i));
check('side 1 og side 2 deler INGEN række', overlap.length === 0,
  `side1=${JSON.stringify(ids1)} side2=${JSON.stringify(ids2)} overlap=${JSON.stringify(overlap)}`);
check('og de er de 10 nyeste i rigtig rækkefølge',
  JSON.stringify([...ids1, ...ids2]) === JSON.stringify(['r01','r02','r03','r04','r10','r09','r08','r07','r06','r05']),
  JSON.stringify([...ids1, ...ids2]));

// ── AC2 — hele filteret kan drænes: hver række præcis én gang ───────────────
const seen: string[] = [];
let cursor: string | null = null;
let guard = 0;
do {
  const page: { status: number; body: Page & { error?: string } } =
    await get(`limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  seen.push(...page.body.items.map((i) => i.id));
  cursor = page.body.nextCursor;
} while (cursor && ++guard < 20);
check('en fuld gennemløbning ser hver række PRÆCIS én gang',
  seen.length === 12 && new Set(seen).size === 12,
  `${seen.length} rækker, ${new Set(seen).size} unikke (forventet 12/12)`);
check('og den når præcis count — ingen manglende, ingen dubletter',
  seen.length === p1.body.count,
  `set=${seen.length} count=${p1.body.count}`);
check('løkken TERMINERER (den gamle kode ville løbe til vagt-grænsen)',
  guard < 19, `${guard + 1} sider hentet`);

// ── AC3 — KOLLISIONEN: de seks samme-sekund-rækker overlever grænsen ────────
const cluster = seen.filter((id) => ['r05','r06','r07','r08','r09','r10'].includes(id));
check('alle SEKS samme-sekund-rækker kom med, hver præcis én gang',
  cluster.length === 6 && new Set(cluster).size === 6,
  `${JSON.stringify(cluster)} — klyngen ligger hen over sidegrænsen`);

// ── AC4 — afkortet side kan skelnes fra hel side ────────────────────────────
check('afkortet side har nextCursor', p1.body.nextCursor !== null, String(p1.body.nextCursor));
const whole = await get('limit=50');
check('side der rummer alt har nextCursor=null', whole.body.nextCursor === null, String(whole.body.nextCursor));
const exact = await get('limit=12');
check('NØJAGTIG sidestørrelse (12 af 12) giver også null — ikke gættet på items.length',
  exact.body.nextCursor === null && exact.body.items.length === 12,
  `items=${exact.body.items.length} nextCursor=${exact.body.nextCursor}`);

// ── AC5 — count er uændret af limit OG af cursor (regressionskontrollen) ────
check('count er 12 uanset limit', p1.body.count === 12 && whole.body.count === 12,
  `limit5=${p1.body.count} limit50=${whole.body.count}`);
check('count er 12 også på side 2 — cursor flytter den ikke', p2.body.count === 12, String(p2.body.count));

// ── AC6 — en ugyldig cursor er en 400 der NAVNGIVER feltet ─────────────────
for (const bad of ['ikke-base64!!', 'YWJj', '']) {
  const r = await get(`limit=5&cursor=${encodeURIComponent(bad)}`);
  const namesField = typeof r.body.error === 'string' && r.body.error.includes('cursor');
  if (bad === '') {
    // Tom streng = ingen cursor. Må starte forfra, det er ikke en fejl.
    check('tom cursor behandles som "ingen cursor", ikke som fejl',
      r.status === 200 && r.body.items[0]?.id === 'r01', `status=${r.status}`);
  } else {
    check(`cursor="${bad}" → 400 der navngiver feltet`,
      r.status === 400 && namesField, `status=${r.status} fejl=${JSON.stringify(r.body.error)}`);
  }
}
// Den negative kontrol der betyder mest: en dårlig cursor må ALDRIG bare give side 1.
const badPage = await get('limit=5&cursor=ikke-base64!!');
check('en dårlig cursor giver IKKE stille side 1 tilbage',
  !(badPage.status === 200 && badPage.body.items?.[0]?.id === 'r01'),
  `status=${badPage.status} første=${badPage.body.items?.[0]?.id}`);

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗'} ${pass} bestået, ${fail} fejlet`);
process.exit(fail === 0 ? 0 : 1);
