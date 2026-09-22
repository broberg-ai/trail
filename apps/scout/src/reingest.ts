/**
 * F286.9 — byg en Scout Training-brain ved at køre EKSISTERENDE kilder gennem
 * den NYE pipeline, så sporet kilde → kandidat → Neuron findes begge veje.
 *
 * Kør:
 *   bun run apps/scout/src/reingest.ts --from trail-research --to "Scout Training 0001"
 *   bun run apps/scout/src/reingest.ts --from trail-research --to "..." --limit 1   # røgprøve
 *   bun run apps/scout/src/reingest.ts --from trail-research --to "..." --dry-run
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HVORFOR DET HER VIRKER, OG HVORFOR DET IKKE ER EN KOPI
 *
 * F269.1 landede 10. september og satte pegeren kilde → kø-kandidat → Neuron.
 * Alt ingesteret FØR den dato har indholdet men ikke forbindelsen, og den kan
 * ikke genskabes bagud: trail-research har 80 kilder og 100 Neuroner og NUL
 * sporbare par.
 *
 * Vi kopierer derfor ikke Neuronerne. Vi tager de samme KILDER og lader den nye
 * pipeline kompilere dem forfra, så parret opstår mens det bliver til. De nye
 * Neuroner bliver ikke identiske med de gamle — og det er meningen. Målet er
 * PAR, ikke gengivelse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DE TO TING SCRIPTET ALDRIG MÅ GØRE
 *
 * 1. RØRE KILDE-BRAINEN. Den er i drift og er ejerens egen. Her læses kun.
 *    Scriptet har ingen DELETE og ingen PATCH — og det er en egenskab ved
 *    koden, ikke en hensigt: søg efter 'DELETE' i denne fil, der er ingen.
 *
 * 2. KOMPILERE I SKYEN. Hver upload sætter ?localCompile=true, så kilden PARKER
 *    og venter på den interaktive session. Uden det flag ville motoren
 *    kompilere den med en betalt sky-model — og hele pointen med kortet er at
 *    det sker på Max-abonnementet til 0 kr. med Opus 5 som lærer.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = process.env.TRAIL_CLOUD_API ?? process.env.TRAIL_API_URL ?? 'https://app.trailmem.com';
const TENANT = 'broberg-ai';
const DATA = join(import.meta.dir, '..', 'data');

/** Nøglen hedder TRAIL_API_KEY i .env.local-ingest — målt, ikke gættet.
 *  TRAIL_INGEST_TOKEN accepteres som alternativ, fordi CLAUDE.md nævner det
 *  navn for den ikke-interaktive kandidat-rute; de to peger på samme slags
 *  nøgle, og et 401 på et forkert variabelnavn ligner en spærret nøgle. */
function token(): string {
  const t = process.env.TRAIL_API_KEY ?? process.env.TRAIL_INGEST_TOKEN;
  if (!t) throw new Error('TRAIL_API_KEY mangler — den ligger i repoets .env.local-ingest');
  return t;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token()}`, 'X-Trail-Tenant': TENANT, ...extra };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

interface SourceRow {
  id: string;
  filename: string;
  title: string | null;
  path: string | null;
  archived?: boolean;
  fileSize?: number | null;
}

/** Listen bærer IKKE indholdet — det skal hentes pr. dokument. Målt 22/9:
 *  /knowledge-bases/:kb/documents har content:'' på hver række, mens
 *  /documents/:id bærer den fulde tekst. */
async function sourceList(kb: string): Promise<SourceRow[]> {
  const rows = await api<SourceRow[]>(`/api/v1/knowledge-bases/${kb}/documents?kind=source`);
  return rows.filter((r) => !r.archived);
}

async function sourceBody(id: string): Promise<string> {
  const doc = await api<{ content?: string }>(`/api/v1/documents/${id}`);
  return doc.content ?? '';
}

async function createKb(name: string): Promise<{ id: string; slug: string }> {
  return api<{ id: string; slug: string }>('/api/v1/knowledge-bases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, language: 'da', description: `F286.9 — Scout-træningsmateriale, re-ingesteret gennem den nye pipeline.` }),
  });
}

/**
 * DET VI HAR ER TEKSTEN, IKKE FILEN — og derfor skal navnet følge med.
 *
 * `documents.content` bærer den UDTRUKNE tekst, også for en PDF: målt 22/9 er
 * Zoneterapibogen_2026.pdf gemt som 206.046 tegn der begynder `## Page 1`, ikke
 * som PDF-bytes. Uploader man den tekst under sit `.pdf`-navn, ser motoren
 * endelsen, sender den til PDF-pipelinen, og parseren går ned:
 *
 *     InvalidPDFException: Invalid PDF structure
 *
 * Præcis dét skete for 3 af de første 80 — min fejl, ikke materialets. Teksten
 * er alligevel det der kompileres, så en binær endelse omdøbes til `.md`.
 * Originalnavnet bevares i manifestet, så sporet tilbage ikke går tabt.
 *
 * SIDEGEVINSTEN ER STOR: en re-ingest af PDF-materiale koster ikke OCR, fordi
 * udtrækket allerede ER sket én gang. Sannes 52 PDF'er kan derfor køres for
 * 0 kr. — det modsiger det jeg først skrev på F286.9.
 */
const BINARY_EXT = /\.(pdf|docx|pptx|xlsx|png|jpe?g|mp3|m4a|wav)$/i;

export function uploadName(filename: string): string {
  return BINARY_EXT.test(filename) ? `${filename.replace(BINARY_EXT, '')}.md` : filename;
}

async function upload(kbId: string, row: SourceRow, body: string): Promise<void> {
  const form = new FormData();
  form.append('file', new File([body], uploadName(row.filename), { type: 'text/markdown' }));
  form.append('path', row.path ?? '/');
  const res = await fetch(`${API}/api/v1/knowledge-bases/${kbId}/documents/upload?localCompile=true`, {
    method: 'POST',
    headers: headers(),
    body: form,
  });
  if (!res.ok) throw new Error(`upload ${row.filename} → ${res.status} ${await res.text()}`);
}

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (n: string): string | undefined => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const from = arg('--from');
  const to = arg('--to');
  const limit = Number(arg('--limit') ?? 0);
  const dryRun = args.includes('--dry-run');
  if (!from || !to) throw new Error('brug: --from <kilde-kb-slug> --to "<nyt brain-navn>"');

  process.stderr.write(`${from} → "${to}"  (tenant ${TENANT})${dryRun ? '  [TØRLØB]' : ''}\n`);

  let rows = await sourceList(from);
  process.stderr.write(`  ${rows.length} aktive kilder i ${from}\n`);
  if (limit > 0) rows = rows.slice(0, limit);

  // HENT ALT FØRST, UPLOAD BAGEFTER. En halvt oprettet brain er værre end
  // ingen: en kilde der fejler midt i ville efterlade en brain hvor tallet
  // ser rigtigt ud indtil nogen tæller efter.
  const fetched: Array<{ row: SourceRow; body: string; hash: string }> = [];
  for (const [i, row] of rows.entries()) {
    const body = await sourceBody(row.id);
    if (!body.trim()) {
      process.stderr.write(`  ! ${row.filename}: tomt indhold — springes over\n`);
      continue;
    }
    fetched.push({ row, body, hash: sha(body) });
    if ((i + 1) % 20 === 0) process.stderr.write(`  hentet ${i + 1}/${rows.length}\n`);
  }
  process.stderr.write(`  ${fetched.length} kilder hentet med indhold\n`);

  if (dryRun) {
    process.stderr.write('TØRLØB — intet oprettet, intet uploadet.\n');
    console.log(JSON.stringify({ from, to, wouldUpload: fetched.length }, null, 2));
    return;
  }

  // --kb-id gør kørslen GENOPTAGELIG. 80 uploads over netværket fejler før
  // eller siden midtvejs, og uden den ville en genkørsel oprette en ANDEN
  // brain med samme navn og et suffiks — to halve i stedet for én hel.
  const existing = arg('--kb-id');
  const kb = existing
    ? { id: existing, slug: existing }
    : await createKb(to);
  process.stderr.write(`  brain ${existing ? 'genbrugt' : 'oprettet'}: ${kb.slug} (${kb.id})\n`);

  // Ved genoptagelse springes de filnavne over der allerede ligger i
  // mål-brainen. En upload af samme fil igen ville lave en DUBLET-kilde og
  // dermed et forkert par-tal — det tal hele kortet skal aflæses på.
  let already = new Set<string>();
  if (existing) {
    already = new Set((await sourceList(kb.id)).map((r) => r.filename));
    process.stderr.write(`  ${already.size} kilder findes allerede — de springes over\n`);
  }

  let ok = 0;
  const failed: Array<{ filename: string; error: string }> = [];
  for (const [i, f] of fetched.entries()) {
    if (already.has(uploadName(f.row.filename))) continue;
    try {
      await upload(kb.id, f.row, f.body);
      ok += 1;
    } catch (err) {
      failed.push({ filename: f.row.filename, error: err instanceof Error ? err.message : String(err) });
      process.stderr.write(`  ! ${f.row.filename}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    if ((i + 1) % 10 === 0) process.stderr.write(`  uploadet ${i + 1}/${fetched.length}\n`);
  }

  // MANIFESTET ER BEVISET for AC#2: hash pr. kilde, så «nåede alt frem, og er
  // det det SAMME indhold» kan besvares med en sammenligning frem for en
  // optælling. To filer med samme navn og forskelligt indhold ville ellers se
  // ens ud i en tælling.
  const manifest = {
    at: new Date().toISOString(),
    atCopenhagen: new Intl.DateTimeFormat('da-DK', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Copenhagen',
    }).format(new Date()),
    tenant: TENANT,
    from,
    to: { name: to, slug: kb.slug, id: kb.id },
    sourcesInOrigin: rows.length,
    uploaded: ok,
    failed,
    sources: fetched.map((f) => ({
      filename: f.row.filename,
      uploadedAs: uploadName(f.row.filename),
      bytes: f.body.length,
      sha256: f.hash,
    })),
  };
  const out = join(DATA, `reingest-${kb.slug}.json`);
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\n${from} → ${kb.slug}`);
  console.log(`  kilder i original     ${rows.length}`);
  console.log(`  uploadet              ${ok}`);
  console.log(`  fejlet                ${failed.length}`);
  console.log(`\nAlle ${ok} PARKER nu og venter på local ingest — de er IKKE kompileret endnu.`);
  console.log(`Manifest: ${out}`);
}

if (import.meta.main) await main();
