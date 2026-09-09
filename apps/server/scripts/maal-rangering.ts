/**
 * F265.2 — MÅL RANGERINGEN, FØR DEN ÆNDRES.
 *
 * Kører en ord-stige mod prod: samme sag, kun antallet af ord varierer.
 * Rapporterer hvor det KENDTE RIGTIGE svar lander. Uden en kendt facitliste
 * måler man kun at der kom noget tilbage.
 */
const API = process.env.TRAIL_CLOUD_API!;
const KEY = process.env.TRAIL_API_KEY!;
const TENANT = process.env.MAAL_TENANT ?? 'broberg-ai';

type Sag = { kb: string; navn: string; facit: RegExp; stige: string[] };

const SAGER: Sag[] = [
  {
    kb: 'bed7d651-dd0f-49ac-9d25-fbb1c836dad7', navn: 'buddy-sessions',
    facit: /telefonsvarer|answering machine|F177/i,
    stige: [
      'telefonsvarer',
      'telefonsvarer intercom',
      'hvordan virker telefonsvareren',
      'hvordan virker telefonsvareren i intercom',
      'hvordan virker telefonsvareren naar en session er nede i intercom',
    ],
  },
  {
    kb: 'bed7d651-dd0f-49ac-9d25-fbb1c836dad7', navn: 'buddy-sessions/dedup',
    facit: /dobbeltlevering|dedup|dublet/i,
    stige: [
      'dobbeltlevering',
      'dobbeltlevering dedup',
      'hvordan undgaar vi dobbeltlevering',
      'hvordan undgaar vi dobbeltlevering af beskeder',
      'hvordan undgaar vi dobbeltlevering af beskeder mellem sessioner',
    ],
  },
];

async function soeg(kb: string, q: string, limit = 5) {
  const r = await fetch(
    `${API}/api/v1/knowledge-bases/${kb}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${KEY}`, 'X-Trail-Tenant': TENANT } },
  );
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const d = await r.json() as { documents?: { title?: string; filename?: string }[] };
  return (d.documents ?? []).map((x) => x.title ?? x.filename ?? '(uden titel)');
}

for (const sag of SAGER) {
  console.log(`\n=== ${sag.navn} — facit: ${sag.facit} ===`);
  console.log('ord  plads  relevante/5  top-traef');
  for (const q of sag.stige) {
    const titler = await soeg(sag.kb, q);
    const plads = titler.findIndex((t) => sag.facit.test(t));
    const relevante = titler.filter((t) => sag.facit.test(t)).length;
    const ord = q.split(/\s+/).length;
    console.log(
      ` ${String(ord).padStart(2)}   ` +
      `${plads < 0 ? '  -' : String(plads + 1).padStart(3)}   ` +
      `${String(relevante).padStart(6)}/5      ` +
      `${(titler[0] ?? '(intet)').slice(0, 58)}`,
    );
  }
}
