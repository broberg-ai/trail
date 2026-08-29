/**
 * F196.5 — en deploy der ikke kan navngive sin egen commit skal sige det højt.
 *
 * Baggrunden, målt 2026-08-29: `flyctl deploy` i hånden er den samme kommando
 * som `pnpm ship:*` minus `--build-arg GIT_SHA`. Dockerfilens
 * `ARG GIT_SHA=unknown` vinder så, og registret får en række der siger at en
 * deploy skete — men ikke hvilken kode. Motoren stod på sha="unknown" i fire
 * timer, og da en rettelse skulle bevises live på produktion kunne registret —
 * den ENESTE udefra-visning af hvad der kører, eftersom /health og /version
 * begge svarer 404 — ikke svare. Rettelsen VAR live; den kunne ikke vises.
 *
 * Prøven dækker BEGGE rapporterings-stier. At rette den ene og ikke den anden
 * ville gendanne præcis den opdeling der lod fejlen overleve.
 *
 * Kør fra apps/server:  bun run scripts/verify-f196-5.ts
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const { reportDeploy } = await import('@trail/shared');

/** Kør reportDeploy med et bestemt miljø og fang BÅDE advarslen og POST'en. */
async function run(env: Record<string, string | undefined>) {
  const realEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else process.env[k] = v;
  }
  const warns: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };

  let posted: { url: string; body: Record<string, unknown> } | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    posted = { url: String(url), body: JSON.parse(String(init?.body ?? '{}')) };
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  try { await reportDeploy(); }
  finally {
    console.warn = realWarn;
    globalThis.fetch = realFetch;
    for (const k of Object.keys(env)) delete (process.env as Record<string, string | undefined>)[k];
    Object.assign(process.env, realEnv);
  }
  return { warns, posted };
}

const CONFIGURED = { UPMETRICS_API_KEY: 'uk_test', UPMETRICS_SITE: 'test.trailmem.com' };

// ── AC1 — en sha-løs deploy advarer, og advarslen NAVNGIVER app'en ──────────
for (const [label, sha] of [['GIT_SHA helt usat', undefined], ['GIT_SHA="unknown"', 'unknown']] as const) {
  const r = await run({ ...CONFIGURED, GIT_SHA: sha });
  check(
    `${label}: advarer`,
    r.warns.length === 1,
    `${r.warns.length} advarsel(er)`,
  );
  check(
    `${label}: advarslen navngiver app'en og siger at den ikke kan spores`,
    r.warns.some((w) => w.includes('test.trailmem.com') && /GIT_SHA/.test(w) && /traced|spores/i.test(w)),
    JSON.stringify(r.warns[0]?.slice(0, 90)),
  );
}

// ── AC2 — rapporten sendes ALLIGEVEL (fail-soft er uændret) ─────────────────
// Den farlige "rettelse" er en der holder op med at rapportere. En deploy der
// er sket SKAL registreres; at bytte en vag række for INGEN række er værre.
const noSha = await run({ ...CONFIGURED, GIT_SHA: undefined });
check(
  'en sha-løs deploy rapporteres stadig — advarsel er ikke afvisning',
  noSha.posted !== null,
  noSha.posted ? String(noSha.posted.url) : 'INTET blev sendt',
);
check(
  '…med status:success og sha:"unknown", ikke et tomt felt',
  noSha.posted?.body.status === 'success' && noSha.posted?.body.sha === 'unknown',
  JSON.stringify(noSha.posted?.body),
);

// ── Positiv kontrol — en RIGTIG sha advarer ikke ────────────────────────────
// Uden den ville "advarer altid" bestå alt ovenstående.
const good = await run({ ...CONFIGURED, GIT_SHA: '45e8ca7' });
check('en deploy MED sha advarer ikke', good.warns.length === 0, JSON.stringify(good.warns));
check('…og rapporterer den rigtige sha', good.posted?.body.sha === '45e8ca7', JSON.stringify(good.posted?.body.sha));
check(
  'deploy_id er stadig sha-site (idempotens-kontrakten, upmetrics #4223)',
  good.posted?.body.deploy_id === '45e8ca7-test.trailmem.com',
  JSON.stringify(good.posted?.body.deploy_id),
);

// ── Dvale — uden nøgle sker der intet, heller ikke en advarsel ──────────────
const dormant = await run({ UPMETRICS_API_KEY: undefined, UPMETRICS_SITE: undefined, GIT_SHA: undefined });
check(
  'uden nøgle/site: ingen POST OG ingen advarsel (lokal dev larmer ikke)',
  dormant.posted === null && dormant.warns.length === 0,
  `posted=${dormant.posted !== null} warns=${dormant.warns.length}`,
);

// ── AC3 — SAMME vagt i nginx-stien, kørt som rigtig shell ───────────────────
const SH = join(import.meta.dir, '../../../apps/landing/report-deploy.sh');
function sh(env: Record<string, string>) {
  const r = spawnSync('sh', [SH], {
    env: { ...env, PATH: process.env.PATH ?? '', UPMETRICS_BASE_URL: 'http://127.0.0.1:9' },
    encoding: 'utf8',
  });
  return { code: r.status, err: r.stderr ?? '' };
}
const shNoSha = sh({ UPMETRICS_API_KEY: 'uk_test', UPMETRICS_SITE: 'trailmem.com' });
check('nginx-scriptet advarer uden GIT_SHA', /WARN trailmem\.com/.test(shNoSha.err), JSON.stringify(shNoSha.err.slice(0, 90)));
check('nginx-scriptet afslutter 0 selv når POST fejler', shNoSha.code === 0, `exit ${shNoSha.code}`);
const shSha = sh({ UPMETRICS_API_KEY: 'uk_test', UPMETRICS_SITE: 'trailmem.com', GIT_SHA: '45e8ca7' });
check('nginx-scriptet advarer IKKE med en rigtig sha', shSha.err.trim() === '', JSON.stringify(shSha.err.slice(0, 90)));
const shDormant = sh({ UPMETRICS_SITE: 'trailmem.com' });
check('nginx-scriptet er tavst uden nøgle', shDormant.err.trim() === '' && shDormant.code === 0, JSON.stringify(shDormant.err));

// ── De tre nginx-kopier må ikke skride fra hinanden ─────────────────────────
const hashes = await Promise.all(['landing', 'docs', 'widget'].map(async (a) =>
  Bun.hash(await Bun.file(join(import.meta.dir, `../../../apps/${a}/report-deploy.sh`)).text()).toString()));
check(
  'landing/docs/widget har byte-identiske scripts',
  new Set(hashes).size === 1,
  `${new Set(hashes).size} unik(ke) hash`,
);

console.log(`\n${fail === 0 ? '✓ ALLE' : '✗'} ${pass} bestået, ${fail} fejlet`);
process.exit(fail === 0 ? 0 : 1);
