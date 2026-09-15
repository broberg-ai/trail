/**
 * F273.1 — tidsfilteret målt på den LEVENDE motor, ikke i en enhedsprøve.
 *
 * tidsvindue.test.ts beviser at oversættelsen dansk→UTC er rigtig. Det er en
 * svagere påstand end den ser ud: den ville være grøn hvis parametrene aldrig
 * nåede forespørgslen, hvis de blev stavet forkert på ruten, eller hvis
 * `created_at` i en anden tenant stod i en anden form.
 *
 * Målet er det møde ejeren selv daterede: torsdag 10. september 2026 kl. 16.00
 * dansk tid, FD Aalborg. Ambient skrev tre opsummeringer af samme samtale
 * (16:52, 17:06, 17:34) og udførte handlepunktet kl. 18:00.
 *
 *   bun run apps/server/scripts/verify-tidsfilter.ts
 *
 * Kræver TRAIL_CLOUD_API + TRAIL_API_KEY (kør efter `source .env.local-ingest`).
 */
const API = process.env.TRAIL_CLOUD_API;
const KEY = process.env.TRAIL_API_KEY;
if (!API || !KEY) {
  console.error('mangler TRAIL_CLOUD_API / TRAIL_API_KEY — kør: set -a; source .env.local-ingest; set +a');
  process.exit(2);
}

const TENANT = 'broberg-ai';
const KB = 'ae9aad44-8ac8-4036-bf02-222e17f593d1'; // CB-M1

type Doc = { id: string; title: string | null; createdAt: string };

async function hent(q: string): Promise<{ status: number; docs: Doc[]; vindue: string | null; fejl?: string }> {
  const res = await fetch(`${API}/api/v1/knowledge-bases/${KB}/documents?${q}`, {
    headers: { Authorization: `Bearer ${KEY}`, 'X-Trail-Tenant': TENANT },
  });
  const body = await res.json();
  return {
    status: res.status,
    docs: Array.isArray(body) ? (body as Doc[]) : [],
    vindue: res.headers.get('X-Trail-Window'),
    fejl: Array.isArray(body) ? undefined : (body as { error?: string }).error,
  };
}

let fejl = 0;
const kræv = (navn: string, ok: boolean, detalje = '') => {
  console.log(`${ok ? 'ok  ' : 'FEJL'} ${navn}${detalje ? ` — ${detalje}` : ''}`);
  if (!ok) fejl++;
};

// ── 1. POSITIV KONTROL på instrumentet selv ──────────────────────────────
// Uden den beviser «filteret gav 3» ingenting: et filter der fejler i den
// tomme retning ville også kunne give et lille tal.
const alle = await hent('kind=wiki');
kræv('positiv kontrol: ufiltreret liste er ikke tom', alle.docs.length > 0, `${alle.docs.length} Neuroner`);
kræv('ufiltreret svar bærer INGEN vindue-header', alle.vindue === null);

// ── 2. Mødevinduet ───────────────────────────────────────────────────────
const møde = await hent('kind=wiki&from=2026-09-10T16:00&to=2026-09-10T17:45');
kræv('mødevinduet er en ÆGTE delmængde', møde.docs.length > 0 && møde.docs.length < alle.docs.length,
  `${møde.docs.length} af ${alle.docs.length}`);

for (const d of møde.docs) console.log(`       ${d.createdAt}  ${d.title ?? '(uden titel)'}`);

// Hver række SKAL ligge i vinduet, omregnet til dansk tid.
const iVinduet = møde.docs.every((d) => {
  const ms = Date.parse(d.createdAt.replace(' ', 'T') + 'Z'); // naiv = UTC
  return ms >= Date.parse('2026-09-10T14:00:00Z') && ms <= Date.parse('2026-09-10T15:45:00Z');
});
kræv('hver returneret række ligger FAKTISK i vinduet', iVinduet);

// Kendte naboer: kl. 15:30 (før) og 18:00 (efter) må IKKE være med.
const titler = møde.docs.map((d) => d.title ?? '');
kræv('naboen FØR vinduet er udelukket', !titler.some((t) => t.includes('VN Leker og HelpDesk')));
kræv('naboen EFTER vinduet er udelukket', !titler.some((t) => t.includes('forsikringsforløb')));

// ── 3. Kvitteringen ──────────────────────────────────────────────────────
kræv('svaret bærer det opløste vindue i dansk tid', møde.vindue !== null, møde.vindue ?? '(ingen)');
if (møde.vindue) {
  const v = JSON.parse(møde.vindue) as { fra: string; til: string; zone: string };
  kræv('vinduet er kvitteret som dansk vægur', v.fra === '2026-09-10 16:00:00' && v.til === '2026-09-10 17:45:00',
    `${v.fra} → ${v.til} (${v.zone})`);
  kræv('zonen er navngivet, ikke en forskydning', v.zone === 'Europe/Copenhagen');
}

// ── 4. DEN TREDJE TILSTAND ───────────────────────────────────────────────
// Et tomt vindue og en misforstået dato må ikke ligne hinanden.
const tomt = await hent('kind=wiki&from=2020-01-01&to=2020-01-02');
kræv('et ÆGTE tomt vindue svarer 200 med 0 rækker', tomt.status === 200 && tomt.docs.length === 0);

const skrald = await hent('kind=wiki&from=i%20g%C3%A5r');
kræv('en ugyldig dato svarer 400, ikke en tom liste', skrald.status === 400, skrald.fejl ?? '');
kræv('fejlen navngiver det forventede format', (skrald.fejl ?? '').includes('YYYY-MM-DD'));

const vendt = await hent('kind=wiki&from=2026-09-11&to=2026-09-10');
kræv('from efter to afvises', vendt.status === 400, vendt.fejl ?? '');

console.log(fejl === 0 ? '\nALT GRØNT' : `\n${fejl} FEJL`);
process.exit(fejl === 0 ? 0 : 1);
