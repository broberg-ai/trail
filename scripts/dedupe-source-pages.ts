/**
 * F252.2 — ryd det der formerede sig før F252.1.
 *
 * To pas, fordi ordren havde to led («rul tilbage til de neuroner vi havde …
 * SAMT fjern de ekstra kilder»):
 *
 *   1. NEURON-SIDERNE under /sources/  (wiki-rækker)
 *   2. DE RÅ KILDER                    (kind='source')
 *
 * Begge pas beholder den NYESTE pr. (path, filename) og ARKIVERER resten.
 * Intet slettes hårdt: DELETE /documents/:id er en BLØD arkivering
 * (archived=true, status='archived') med en inverse, POST .../restore.
 *
 *   bun run scripts/dedupe-source-pages.ts <tenant-slug>          # tør-kørsel
 *   bun run scripts/dedupe-source-pages.ts <tenant-slug> --apply  # gør det
 *
 * KØR IKKE FØR F252.1 ER LIVE. Uden fixet er bunken tilbage inden for en uge,
 * og man har brugt en oprydning på ingenting. Bevis at den kørende container
 * bærer fix-commit'en:  flyctl ssh console -a trail-engine-001 -C "printenv GIT_SHA"
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
  id: string; path?: string; filename?: string; title?: string; kind?: string;
  knowledgeBaseId?: string; updatedAt?: string; archived?: boolean;
}

/**
 * Nyeste overlever — sorteret på PARSET TID, ikke på strengen.
 *
 * Første udgave brugte localeCompare, og tør-kørslen afslørede den med det
 * samme: basen bærer TO tidsformater side om side —
 *   "2026-09-04T19:51:23.528Z"   (ISO, fra drizzles $defaultFn)
 *   "2026-09-04 19:49:50"        (SQLites datetime('now'))
 * Som strenge sorterer "T" efter mellemrum i ASCII, så ISO-rækken vandt
 * uanset hvad uret sagde — altså ville oprydningen have arkiveret den NYESTE
 * og bevaret den forældede, i en oprydning hvis hele formål er det modsatte.
 */
const when = (d: Doc): number => {
  const raw = d.updatedAt;
  if (!raw) return 0; // uden tidsstempel er ikke den nyeste
  // SQLite-formatet mangler zone; det er UTC, så gør det eksplicit.
  const t = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(t) ? 0 : t;
};

// --only=<kb-slug> begrænser kørslen til én videnbase. Bruges når man rydder
// op efter en HÆNDELSE og ikke vil røre en kundes base i samme ombæring: en
// dublet fra maj er ikke en del af en oprydning efter en storm i september.
const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

const kbs = ((await (await fetch(`${API}/api/v1/knowledge-bases`, { headers: H })).json()) as
  Array<{ id: string; slug: string }>).filter((k) => !only || k.slug === only);

if (only && kbs.length === 0) {
  console.error(`ingen videnbase med slug "${only}"`);
  process.exit(1);
}

interface Pass { label: string; url: (kbId: string) => string; keep: (d: Doc) => boolean }

const PASSES: Pass[] = [
  {
    label: 'SIDER',
    url: (kb) => `${API}/api/v1/knowledge-bases/${kb}/documents?kind=wiki`,
    keep: (d) => (d.path ?? '').includes('/sources/'),
  },
  {
    label: 'KILDER',
    url: (kb) => `${API}/api/v1/knowledge-bases/${kb}/documents`,
    keep: (d) => d.kind === 'source',
  },
];

const tally: Record<string, { files: number; archived: number }> = {};

for (const pass of PASSES) {
  tally[pass.label] = { files: 0, archived: 0 };
  const t = tally[pass.label]!;

  for (const kb of kbs) {
    const docs = (await (await fetch(pass.url(kb.id), { headers: H })).json()) as Doc[];

    const groups = new Map<string, Doc[]>();
    for (const d of docs) {
      if (d.archived) continue;
      if (!pass.keep(d)) continue;
      const key = `${d.path ?? ''}${d.filename ?? ''}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
    }

    const dupes = [...groups.entries()].filter(([, v]) => v.length > 1);
    if (dupes.length === 0) continue;

    console.log(`\n── ${kb.slug} · ${pass.label} — ${dupes.length} fil(er) i flere kopier`);
    for (const [key, rows] of dupes.sort((a, b) => b[1].length - a[1].length)) {
      const sorted = [...rows].sort((a, b) => when(b) - when(a));
      const keep = sorted[0]!;
      t.files += 1;
      console.log(`  ${rows.length}×  ${key.split('/').pop()}`);
      console.log(`      BEHOLD   ${keep.id}  (${keep.updatedAt ?? 'uden tidsstempel'})`);
      for (const d of sorted.slice(1)) {
        console.log(`      arkivér  ${d.id}  (${d.updatedAt ?? 'uden tidsstempel'})`);
        if (apply) {
          const res = await fetch(`${API}/api/v1/documents/${d.id}`, { method: 'DELETE', headers: H });
          if (!res.ok) {
            console.error(`      ✗ FEJL ${res.status}: ${(await res.text()).slice(0, 160)}`);
          } else {
            t.archived += 1;
          }
        }
      }
    }
  }
}

console.log(
  `\n${apply ? 'ARKIVERET' : 'TØR-KØRSEL'} — ` +
    PASSES.map((p) => {
      const t = tally[p.label]!;
      return `${p.label.toLowerCase()}: ${t.files} fil(er)${apply ? `, ${t.archived} rækker` : ''}`;
    }).join('  ·  ') +
    (apply ? '' : '  ·  intet rørt'),
);
