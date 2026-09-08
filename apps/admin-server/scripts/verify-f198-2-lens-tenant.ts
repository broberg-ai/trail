/**
 * F198.2 — BEVIS: lander Lens-sessionen i VORES tenant?
 *
 * Kør:  bun run apps/admin-server/scripts/verify-f198-2-lens-tenant.ts
 *       (BASE=https://app.trailmem.com som default; sæt BASE for lokalt)
 *
 * Hvorfor scriptet ikke bare tjekker at cookien blev udstedt: en udstedt cookie
 * beviser at VI satte den, ikke at serveren læser den. Prøven mint'er, sender
 * cookierne tilbage og spørger `/api/auth/me` hvad den så faktisk sidder i —
 * altså en tilbagelæsning, ikke afsenderens egen mening.
 *
 * NEGATIV KONTROL ER INDBYGGET (case 2): samme mint, men KUN session-cookien
 * sendes med. Den skal IKKE svare broberg-ai. Uden den ville prøven bestå selv
 * hvis den ekstra cookie var uden virkning — den ville måle serverens
 * fallback og kalde det et bevis.
 */
const BASE = process.env.BASE ?? 'https://app.trailmem.com';
const FORVENTET = process.env.LENS_TENANT_SLUG ?? 'broberg-ai';
// En KB der tilhører broberg-ai. 200 med den rigtige tenant, 404 med en anden.
const KB = process.env.KB_ID ?? 'da6f14fb-8bf3-4f19-9492-54075ff6d188';

const secret = (
  process.env.LENS_MINT_SECRET ??
  (await Bun.file(`${import.meta.dir}/../../../.lens/mint-secret`).text().catch(() => ''))
).trim();
if (!secret) {
  console.error('mangler LENS_MINT_SECRET (eller .lens/mint-secret)');
  process.exit(1);
}

type Cookie = { name: string; value: string };

const res = await fetch(`${BASE}/api/lens-session`, {
  method: 'POST',
  headers: { authorization: `Bearer ${secret}` },
});
if (!res.ok) {
  console.error(`mint fejlede: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const state = (await res.json()) as { cookies: Cookie[] };
const alle = state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
const kunSession = state.cookies
  .filter((c) => c.name === 'trail-session')
  .map((c) => `${c.name}=${c.value}`)
  .join('; ');

async function aktivTenant(cookie: string): Promise<string | null> {
  const r = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
  if (!r.ok) return null;
  const j = (await r.json()) as { tenant?: { slug?: string } };
  return j.tenant?.slug ?? null;
}

let fejl = 0;
function hævd(navn: string, faktisk: unknown, forventet: unknown) {
  // STRENG lighed, og begge værdier printes ved fejl. «Indeholder» ville bestå
  // på en afkortet eller sammenblandet værdi — det er den svage prædikat-fælde
  // huset allerede har målt to gange.
  const ok = faktisk === forventet;
  if (!ok) fejl++;
  console.log(`${ok ? '✓' : '✗'} ${navn}\n    faktisk=${JSON.stringify(faktisk)}  forventet=${JSON.stringify(forventet)}`);
}

// AC#1 — sessionen lander i vores egen tenant.
hævd('aktiv tenant med begge cookies', await aktivTenant(alle), FORVENTET);

// AC#3 — negativ kontrol: uden den ekstra cookie må den IKKE ramme rigtigt.
const udenCookie = await aktivTenant(kunSession);
const negativOk = udenCookie !== FORVENTET;
if (!negativOk) fejl++;
console.log(
  `${negativOk ? '✓' : '✗'} negativ kontrol: kun session-cookie ⇒ IKKE ${FORVENTET}\n    faktisk=${JSON.stringify(udenCookie)}`,
);

// AC#2 — og den kan så faktisk læse en af VORES KB'er.
const kb = await fetch(`${BASE}/api/v1/knowledge-bases/${KB}/documents?kind=source&limit=1`, {
  headers: { cookie: alle },
});
hævd('broberg-ai KB læsbar', kb.status, 200);

// AC#4 — vagten er uændret: skrivning er stadig forbudt.
const skriv = await fetch(`${BASE}/api/auth/switch-tenant`, {
  method: 'POST',
  headers: { cookie: alle, 'content-type': 'application/json' },
  body: JSON.stringify({ slug: 'fd-aalborg' }),
});
hævd('read-only-vagten holder (switch-tenant)', skriv.status, 403);

console.log(fejl === 0 ? '\nALLE BESTÅET' : `\n${fejl} FEJLET`);
process.exit(fejl === 0 ? 0 : 1);
