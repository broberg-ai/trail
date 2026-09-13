/**
 * F272.2 — probe-kontrakten målt på det LEVENDE svar, ikke i kildekoden.
 *
 * Prøven i probe-kontrakt.test.ts læser documents.ts og beviser at NAVNENE står
 * i filen. Det er en svagere påstand end den ser ud: den ville være grøn hvis
 * ruten var flyttet, hvis middlewaren svarede før den, eller hvis en fejl gav
 * 500. buddys probe læser svaret — ikke vores kildekode.
 *
 *   bun run apps/server/scripts/verify-probe-kontrakt.ts
 *
 * Kræver TRAIL_CLOUD_API + TRAIL_API_KEY (kør efter `source .env.local-ingest`).
 */
const API = process.env.TRAIL_CLOUD_API;
const KEY = process.env.TRAIL_API_KEY;
if (!API || !KEY) {
  console.error('mangler TRAIL_CLOUD_API / TRAIL_API_KEY — kør: set -a; source .env.local-ingest; set +a');
  process.exit(2);
}

// De tenants buddys probe-jobs faktisk kalder (job 94a291d2 og 6e2791f3).
const TENANTS = ['broberg-ai', 'sanne-andersen'];

let fejl = 0;
for (const t of TENANTS) {
  const res = await fetch(`${API}/api/v1/documents?awaitingLocalCompile=true`, {
    headers: { Authorization: `Bearer ${KEY}`, 'X-Trail-Tenant': t },
  });
  if (!res.ok) { console.error(`FEJL ${t}: HTTP ${res.status}`); fejl++; continue; }
  const json = (await res.json()) as Record<string, unknown>;

  // Præcis de to stier buddy læser. En manglende sti er hos dem uskelnelig fra
  // «0 der venter», så den skal fanges HER frem for at blive tavs hos dem.
  const documentsOk = Array.isArray(json.documents);
  const idsOk = Array.isArray(json.ids);
  const status = documentsOk && idsOk ? 'ok  ' : 'FEJL';
  if (!documentsOk || !idsOk) fejl++;
  console.log(
    `${status} ${t.padEnd(16)} documents=${documentsOk ? 'array' : typeof json.documents}` +
    ` ids=${idsOk ? 'array' : typeof json.ids}` +
    ` (top-nøgler: ${Object.keys(json).join(', ')})`,
  );
}
console.log(fejl === 0 ? '\nKONTRAKTEN HOLDER på alle kaldte tenants.' : `\n${fejl} brud.`);
process.exit(fejl === 0 ? 0 : 1);
