/**
 * F212.4 — kan tørkørslen af lint-drænet skelne "intet at rydde" fra
 * "jeg kiggede aldrig"?
 *
 * FØRST EN MÅLING, IKKE EN RETTELSE. Kortet blev skrevet ud fra to kørsler mod
 * produktion der begge svarede {scanned: 0, rejected: 0} — og jeg konkluderede
 * at scanned var gated på `apply`. Læsningen af koden siger noget andet:
 * `matching` udregnes FØR `if (apply)`, så scanned burde tælle i begge
 * tilstande, og de to nuller på prod var bare sande.
 *
 * Denne prøve afgør det på en fixture hvor der GARANTERET er noget at tælle —
 * præcis den kontrol de to prod-kørsler manglede. Hvad den finder, afgør hvad
 * der skal bygges.
 *
 * Kør fra apps/server:  bun run scripts/verify-f212-4.ts
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, sessions, queueCandidates } from '@trail/db';
import { createApp } from '../src/app.js';

const T = 't-f2124', U = 'u-f2124';
const KB_OFF = 'kb-lint-off', KB_ON = 'kb-lint-on';
const DB_PATH = join(process.env.TMPDIR ?? '/tmp', `f2124-${process.env.USER ?? 'x'}.db`);
try { rmSync(DB_PATH, { force: true }); } catch { /* first run */ }

const trail = await createLibsqlDatabase({ path: DB_PATH });
await trail.runMigrations();
await trail.initFTS();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

await trail.db.insert(tenants).values({ id: T, slug: 'f2124', name: 'F2124', plan: 'hobby' }).run();
await trail.db.insert(users).values({ id: U, tenantId: T, email: 'f2124@local.trail', displayName: 'F', role: 'owner', onboarded: true }).run();
// To KB'er: én med lint SLÅET FRA (drænets målgruppe) og én med lint TÆNDT.
// Den anden er den kontrol der gør et 0 til en scope-beslutning frem for en tom tabel.
await trail.db.insert(knowledgeBases).values([
  { id: KB_OFF, tenantId: T, createdBy: U, name: 'Lint fra', slug: 'lint-fra', language: 'da', contradictionLintEnabled: false },
  { id: KB_ON,  tenantId: T, createdBy: U, name: 'Lint til', slug: 'lint-til', language: 'da', contradictionLintEnabled: true },
]).run();
await trail.db.insert(sessions).values({ id: 'sess-f2124', userId: U, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).run();

const LINT = JSON.stringify({ connector: 'lint' });
const KNOWLEDGE = JSON.stringify({ connector: 'external-feed' });
await trail.db.insert(queueCandidates).values([
  // 3 lint-kandidater i den lint-SLUKKEDE KB → drænets målgruppe
  { id: 'c1', tenantId: T, knowledgeBaseId: KB_OFF, kind: 'contradiction-alert', title: 'støj 1', content: 'x', metadata: LINT, status: 'pending' },
  { id: 'c2', tenantId: T, knowledgeBaseId: KB_OFF, kind: 'contradiction-alert', title: 'støj 2', content: 'x', metadata: LINT, status: 'pending' },
  { id: 'c3', tenantId: T, knowledgeBaseId: KB_OFF, kind: 'contradiction-alert', title: 'støj 3', content: 'x', metadata: LINT, status: 'pending' },
  // 1 lint-kandidat i den lint-TÆNDTE KB → må ALDRIG røres
  { id: 'c4', tenantId: T, knowledgeBaseId: KB_ON, kind: 'contradiction-alert', title: 'ægte fund', content: 'x', metadata: LINT, status: 'pending' },
  // 1 VIDENS-kandidat i den slukkede KB → må aldrig røres (anden connector)
  { id: 'c5', tenantId: T, knowledgeBaseId: KB_OFF, kind: 'external-feed', title: 'rigtig viden', content: 'x', metadata: KNOWLEDGE, status: 'pending' },
]).run();

const app = createApp(trail, new Map([['f2124', trail]]));
const drain = async (body: unknown) => {
  const res = await app.request('http://engine.local/api/v1/maintenance/drain-lint-candidates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'session=sess-f2124' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, number | string | boolean | null> };
};
/** Statusser læst med RÅ SQL — aldrig gennem laget der skrev dem. */
async function statuses(): Promise<Record<string, string>> {
  const r = await trail.client.execute('SELECT id, status FROM queue_candidates ORDER BY id');
  return Object.fromEntries((r.rows as unknown as Array<{ id: string; status: string }>).map((x) => [x.id, x.status]));
}

const before = await statuses();

// ── AC1 — tørkørslen SKAL kunne se de tre, og må ikke røre noget ────────────
const dry = await drain({ apply: false });
check('tørkørsel: scanned tæller det den ville ramme', dry.body.scanned === 3, `scanned=${dry.body.scanned} (forventet 3)`);
check(
  'tørkørsel: rejected forudsiger det samme tal — IKKE 0',
  dry.body.rejected === 3,
  `rejected=${dry.body.rejected} (forventet 3; 0 = "kan ikke skelne fra intet at gøre")`,
);
check('tørkørsel: applied=false', dry.body.applied === false, String(dry.body.applied));
check(
  'tørkørsel ændrer INTET på disken (rå SQL før/efter)',
  JSON.stringify(await statuses()) === JSON.stringify(before),
  JSON.stringify(await statuses()),
);

// ── AC2 — den ægte kørsel siger det SAMME som forudsigelsen ─────────────────
// Asserteret mod tørkørslens tal, ikke mod en konstant jeg selv har skrevet.
const real = await drain({ apply: true });
check(
  'ægte kørsel: rejected === tørkørslens forudsigelse',
  real.body.rejected === dry.body.rejected,
  `forudsagt ${dry.body.rejected} → faktisk ${real.body.rejected}`,
);
check('ægte kørsel: scanned === tørkørslens scanned', real.body.scanned === dry.body.scanned, `${dry.body.scanned} → ${real.body.scanned}`);
const after = await statuses();
check(
  'og rækkerne skiftede FAKTISK status (rå SQL)',
  after.c1 === 'rejected' && after.c2 === 'rejected' && after.c3 === 'rejected',
  JSON.stringify(after),
);

// ── AC3 — nullet er en scope-beslutning, ikke en tom tabel ──────────────────
check(
  'lint-fundet i den lint-TÆNDTE KB er urørt',
  after.c4 === 'pending',
  `c4=${after.c4} (skal være pending — ægte fund i en kurateret KB)`,
);
check(
  'videns-kandidaten i samme KB er urørt',
  after.c5 === 'pending',
  `c5=${after.c5}`,
);
const dryAgain = await drain({ apply: false });
check(
  'anden tørkørsel: scanned=0 OG rejected=0 — nu hvor der reelt intet er',
  dryAgain.body.scanned === 0 && dryAgain.body.rejected === 0,
  `scanned=${dryAgain.body.scanned} rejected=${dryAgain.body.rejected}`,
);
check(
  '…men to kandidater står stadig i køen, så 0 er scope og ikke tomhed',
  Object.values(after).filter((s) => s === 'pending').length === 2,
  JSON.stringify(after),
);

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗'} ${pass} bestået, ${fail} fejlet`);
process.exit(fail === 0 ? 0 : 1);
