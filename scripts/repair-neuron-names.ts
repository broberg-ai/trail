/**
 * F256.2 — reparér Neuroner der blev født med en sti eller et filnavn som navn.
 *
 * MÅLT 6/9 2026 i broberg.ai: 26 Neuroner, 142 af basens 328 brudte links.
 *
 *   filnavn:  neurons-entities-christian-broberg-md.md
 *   titel:    /neurons/entities/christian-broberg.md
 *   indhold:  title: Christian Broberg          ← den korrekte, allerede skrevet
 *
 * DET NYE NAVN ER IKKE ET SKØN. Det tages fra dokumentets EGEN frontmatter —
 * samme funktion som skrivevejen nu bruger (F256.1), så reparation og
 * forebyggelse ikke kan komme til at være uenige.
 *
 * KØR IKKE FØR F256.1 ER LIVE. Uden den skriver næste kompilering fejlen ind
 * igen, og oprydningen er brugt på ingenting — samme lære som F252.
 *
 *   bun run scripts/repair-neuron-names.ts <tenant> <kb-slug>          # tør
 *   bun run scripts/repair-neuron-names.ts <tenant> <kb-slug> --apply  # gør det
 */
import { neuronTitel, erSti } from '../packages/core/src/queue/neuron-name.js';
import { slugify } from '../packages/shared/src/index.js';

const API = process.env.TRAIL_CLOUD_API!;
const KEY = process.env.TRAIL_API_KEY!;
const tenant = process.argv[2];
const kbSlug = process.argv[3];
const apply = process.argv.includes('--apply');

if (!tenant || !kbSlug) {
  console.error('brug: bun run scripts/repair-neuron-names.ts <tenant> <kb-slug> [--apply]');
  process.exit(1);
}

const H = { Authorization: `Bearer ${KEY}`, 'X-Trail-Tenant': tenant };
const J = { ...H, 'Content-Type': 'application/json' };

interface Doc { id: string; path?: string; filename?: string; title?: string; archived?: boolean }

const kbs = (await (await fetch(`${API}/api/v1/knowledge-bases`, { headers: H })).json()) as
  Array<{ id: string; slug: string }>;
const kb = kbs.find((k) => k.slug === kbSlug);
if (!kb) { console.error(`ingen videnbase med slug "${kbSlug}"`); process.exit(1); }

const docs = ((await (await fetch(
  `${API}/api/v1/knowledge-bases/${kb.id}/documents?kind=wiki`, { headers: H },
)).json()) as Doc[]).filter((d) => !d.archived && erSti(d.title ?? ''));

console.log(`${docs.length} fejlfødt(e) Neuron(er) i ${kbSlug}\n`);

// Alle NUVÆRENDE filnavne, så en reparation ikke kan skrive oven i en anden
// Neuron. To fejlfødte kan udlede samme navn (fx en dansk og en engelsk
// udgave), og en tavs kollision ville sammenblande to Neuroner til én.
const optaget = new Set(
  ((await (await fetch(
    `${API}/api/v1/knowledge-bases/${kb.id}/documents?kind=wiki`, { headers: H },
  )).json()) as Doc[])
    .filter((d) => !d.archived && !erSti(d.title ?? ''))
    .map((d) => `${d.path ?? ''}${(d.filename ?? '').toLowerCase()}`),
);

let rettet = 0, sprunget = 0;
for (const d of docs) {
  const content = (await (await fetch(
    `${API}/api/v1/documents/${d.id}/content`, { headers: H },
  )).json()) as { content?: string };

  const nyTitel = neuronTitel(d.title ?? '', content.content ?? '');
  const nytFilnavn = `${slugify(nyTitel) || 'untitled'}.md`;
  const nøgle = `${d.path ?? ''}${nytFilnavn.toLowerCase()}`;

  if (nyTitel === d.title) { console.log(`  ⊘ ${d.filename} — intet bedre navn i indholdet`); sprunget += 1; continue; }
  if (optaget.has(nøgle)) { console.log(`  ⊘ ${d.filename} → ${nytFilnavn} OPTAGET af en anden Neuron`); sprunget += 1; continue; }
  optaget.add(nøgle);

  console.log(`  ${d.filename}`);
  console.log(`     → ${nytFilnavn}   titel: "${nyTitel}"`);

  if (apply) {
    const res = await fetch(`${API}/api/v1/documents/${d.id}`, {
      method: 'PATCH', headers: J,
      body: JSON.stringify({ filename: nytFilnavn, title: nyTitel }),
    });
    if (!res.ok) { console.error(`     ✗ ${res.status}: ${(await res.text()).slice(0, 140)}`); continue; }
    rettet += 1;
  }
}

console.log(`\n${apply ? `RETTET ${rettet}` : 'TØR-KØRSEL'}, sprunget over ${sprunget}${apply ? '' : ' — intet rørt'}`);
if (apply) {
  const r = await fetch(`${API}/api/v1/knowledge-bases/${kb.id}/link-check/rescan`, { method: 'POST', headers: J });
  console.log(`genscanning af links: ${r.ok ? 'kørt' : `FEJLEDE ${r.status}`}`);
}
