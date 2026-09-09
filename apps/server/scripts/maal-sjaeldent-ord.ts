/**
 * F265.2 — MÅL PÅ INDHOLD, IKKE PÅ TITLER.
 *
 * Den første stige dømte relevans på om TITLEN matchede et regex. Det er et
 * for groft instrument: et dokument kan svare præcist på spørgsmålet og hedde
 * noget andet, og en titel kan matche uden at teksten handler om det.
 *
 * Her spørges der om noget der faktisk kan afgøres: STÅR DET SJÆLDNE ORD I
 * DOKUMENTET? Det er den ene ting brugeren beviseligt ledte efter.
 */
const API = process.env.TRAIL_CLOUD_API!;
const KEY = process.env.TRAIL_API_KEY!;
const H = { Authorization: `Bearer ${KEY}`, 'X-Trail-Tenant': 'broberg-ai' };
const KB = 'bed7d651-dd0f-49ac-9d25-fbb1c836dad7';

type Sag = { navn: string; sjaeldent: string; stige: string[] };
const SAGER: Sag[] = [
  {
    navn: 'dedup', sjaeldent: 'dobbeltlevering',
    stige: [
      'dobbeltlevering',
      'dobbeltlevering dedup',
      'hvordan undgaar vi dobbeltlevering',
      'hvordan undgaar vi dobbeltlevering af beskeder',
      'hvordan undgaar vi dobbeltlevering af beskeder mellem sessioner',
    ],
  },
  {
    navn: 'telefonsvarer', sjaeldent: 'telefonsvarer',
    stige: [
      'telefonsvarer',
      'telefonsvarer intercom',
      'hvordan virker telefonsvareren',
      'hvordan virker telefonsvareren i intercom',
      'hvordan virker telefonsvareren naar en session er nede i intercom',
    ],
  },
];

for (const sag of SAGER) {
  console.log(`\n=== ${sag.navn} — indeholder dokumentet «${sag.sjaeldent}»? ===`);
  console.log('ord  top-5 med ordet   nr.1 har det   nr.1');
  for (const q of sag.stige) {
    const r = await fetch(
      `${API}/api/v1/knowledge-bases/${KB}/search?q=${encodeURIComponent(q)}&limit=5&includeContent=true`,
      { headers: H },
    );
    const d = await r.json() as { documents?: { title?: string; filename?: string; content?: string }[] };
    const docs = d.documents ?? [];
    const har = (x: { title?: string; content?: string }) =>
      `${x.title ?? ''} ${x.content ?? ''}`.toLowerCase().includes(sag.sjaeldent.toLowerCase());
    const antal = docs.filter(har).length;
    const ord = q.split(/\s+/).length;
    console.log(
      ` ${String(ord).padStart(2)}       ${String(antal)}/5            ` +
      `${docs[0] && har(docs[0]) ? 'JA ' : 'nej'}          ` +
      `${(docs[0]?.title ?? docs[0]?.filename ?? '(intet)').slice(0, 50)}`,
    );
  }
}
