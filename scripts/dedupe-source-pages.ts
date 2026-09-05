/**
 * F252.2 — ryd de kilde-sider der formerede sig før F252.1.
 *
 * Beholder den NYESTE side pr. (path, filename) og ARKIVERER resten. Intet
 * slettes hårdt: en fejl skal kunne fortrydes.
 *
 *   bun run scripts/dedupe-source-pages.ts <tenant-slug>          # tør-kørsel
 *   bun run scripts/dedupe-source-pages.ts <tenant-slug> --apply  # gør det
 *
 * KØR IKKE FØR F252.1 ER LIVE. Uden fixet er bunken tilbage inden for en uge,
 * og man har brugt en sletning på ingenting.
 */
const API = process.env.TRAIL_CLOUD_API!;
const KEY = process.env.TRAIL_API_KEY!;
const tenant = process.argv[2];
const apply = process.argv.includes('--apply');

if (!tenant) {
  console.error('brug: bun run scripts/dedupe-source-pages.ts <tenant-slug> [--apply]');
  process.exit(1);
}

const H = { Authorization: `Bearer ${KEY}`, 'X-Trail-Tenant': tenant };

interface Doc {
  id: string; path?: string; filename?: string; title?: string;
  knowledgeBaseId?: string; updatedAt?: string; archived?: boolean;
}

const kbs = (await (await fetch(`${API}/api/v1/knowledge-bases`, { headers: H })).json()) as
  Array<{ id: string; slug: string }>;

let totalDupes = 0;
let totalArchived = 0;

for (const kb of kbs) {
  const docs = (await (
    await fetch(`${API}/api/v1/knowledge-bases/${kb.id}/documents?kind=wiki`, { headers: H })
  ).json()) as Doc[];

  const groups = new Map<string, Doc[]>();
  for (const d of docs) {
    if (d.archived) continue;
    const path = d.path ?? '';
    if (!path.includes('/sources/')) continue;
    const key = `${path}${d.filename ?? ''}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }

  const dupes = [...groups.entries()].filter(([, v]) => v.length > 1);
  if (dupes.length === 0) continue;

  console.log(`\n── ${kb.slug} — ${dupes.length} fil(er) i flere kopier`);
  for (const [key, rows] of dupes.sort((a, b) => b[1].length - a[1].length)) {
    // Nyeste overlever — sorteret på PARSET TID, ikke på strengen.
    //
    // Første udgave brugte localeCompare, og tør-kørslen afslørede den med det
    // samme: databasen bærer TO tidsformater side om side —
    //   "2026-08-28T12:41:55.639Z"   (ISO, fra drizzles $defaultFn)
    //   "2026-08-28 12:41:57"        (SQLites datetime('now'))
    // Som strenge sorterer "T" efter mellemrum i ASCII, så ISO-rækken vandt
    // uanset hvad uret sagde. På f215-md.md ville den have arkiveret den række
    // der var TO SEKUNDER NYERE end den den beholdt — altså slettet det
    // rigtige svar og bevaret det forældede, i en oprydning hvis hele formål
    // er at efterlade det nyeste.
    const when = (d: Doc): number => {
      const raw = d.updatedAt;
      if (!raw) return 0; // uden tidsstempel er ikke den nyeste
      // SQLite-formatet mangler zone; det er UTC, så gør det eksplicit.
      const t = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
      return Number.isNaN(t) ? 0 : t;
    };
    const sorted = [...rows].sort((a, b) => when(b) - when(a));
    const keep = sorted[0]!;
    const drop = sorted.slice(1);
    totalDupes += 1;
    console.log(`  ${rows.length}×  ${key.split('/').pop()}`);
    console.log(`      BEHOLD   ${keep.id}  (${keep.updatedAt ?? 'uden tidsstempel'})`);
    for (const d of drop) {
      console.log(`      arkivér  ${d.id}  (${d.updatedAt ?? 'uden tidsstempel'})`);
      if (apply) {
        // DELETE er en BLØD arkivering her (archived=true, status='archived'),
        // og den har en inverse: POST /documents/:id/restore. Intet slettes
        // hårdt — en fejl kan fortrydes række for række.
        const res = await fetch(`${API}/api/v1/documents/${d.id}`, {
          method: 'DELETE',
          headers: H,
        });
        if (!res.ok) {
          console.error(`      ✗ FEJL ${res.status}: ${(await res.text()).slice(0, 160)}`);
        } else {
          totalArchived += 1;
        }
      }
    }
  }
}

console.log(
  `\n${apply ? 'ARKIVERET' : 'TØR-KØRSEL'} — ${totalDupes} fil(er) med kopier, ` +
    `${apply ? `${totalArchived} rækker arkiveret` : 'intet rørt'}`,
);
