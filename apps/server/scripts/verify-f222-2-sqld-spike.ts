/**
 * F222.2 — sqld-spike: er motorens chat-sti hurtig nok mod en DB-maskine?
 *
 * Kør PÅ motormaskinen (samme region som DB-maskinen, arn):
 *   bun /app/apps/server/scripts/verify-f222-2-sqld-spike.ts
 *
 * Måler den ÆGTE kode, ikke en efterligning: searchChunks/searchDocuments
 * (adapterens egne metoder), loadNeuronConfidence (chat-servicen) og
 * createCandidateQueueAPI.write (den rigtige ingest-skrivesti med
 * FTS-triggere) — mod (a) lokal fil og (b) sqld over netværk, samme datasæt.
 *
 * Faser (env SPIKE_MODE=parity|read|ingest|all, default all):
 *   0 NEGATIV KONTROL — sammenligneren SKAL kunne melde mismatch.
 *   1 Paritet — rækketal + FTS MATCH-resultater identiske lokal vs remote.
 *   2 Chat-retrieval p50/p95 — fuld retrieveContext-sekvens pr. RIGTIG
 *     brugerforespørgsel fra chat_turns, lokal vs remote.
 *   3 Ingest — rigtige wiki-writes (create + append) mod remote og mod en
 *     lokal skrive-kopi, varighed pr. write.
 *
 * Afvigelser fra chat.ts' retrieveContext, navngivet: recordAccess/
 * reinforcement (fire-and-forget skrivninger) og billed-opslag udelades —
 * begge ligger EFTER søgningerne og er ens for begge konfigurationer.
 */
import { createClient } from '@libsql/client';
import { and, eq, like, inArray, desc } from 'drizzle-orm';
import {
  LibsqlTrailDatabase,
  documents,
  knowledgeBases,
  chatTurns,
  type TrailDatabase,
} from '@trail/db';
import { buildFtsQuery, HEURISTIC_PATH, computeConfidence, isPinned, isFaded } from '@trail/shared';
import { loadNeuronConfidence, isChatVisible, confidenceOf } from '../src/services/chat-confidence.js';
import { createCandidateQueueAPI } from '@trail/core';

const REMOTE_URL = process.env.SPIKE_REMOTE_URL ?? 'http://trail-db-001.internal:8080';
const LOCAL_PATH = process.env.SPIKE_LOCAL_PATH ?? '/tmp/sanne-spike.db';
const WRITE_COPY = process.env.SPIKE_WRITE_COPY ?? '/tmp/sanne-spike-write.db';
const MODE = process.env.SPIKE_MODE ?? 'all';

function openLocal(path: string, tenantId: string): TrailDatabase {
  return new LibsqlTrailDatabase({ path, tenantId }, createClient({ url: `file:${path}` }));
}
function openRemote(tenantId: string): TrailDatabase {
  return new LibsqlTrailDatabase({ path: REMOTE_URL, tenantId }, createClient({ url: REMOTE_URL }));
}

// Tenant + KB'er læses fra datasættet selv — aldrig hardkodet.
const probe = openLocal(LOCAL_PATH, 'probe');
const tenantRow = await probe.execute(`SELECT DISTINCT tenant_id AS t FROM documents LIMIT 2`);
if (tenantRow.rows.length !== 1) {
  console.error(`✗ forventede præcis 1 tenant i spike-kopien, fandt ${tenantRow.rows.length}`);
  process.exit(1);
}
const TENANT = String(tenantRow.rows[0].t);
await probe.close();

const local = openLocal(LOCAL_PATH, TENANT);
const remote = openRemote(TENANT);

const kbRows = await local.db
  .select({ id: knowledgeBases.id, name: knowledgeBases.name })
  .from(knowledgeBases)
  .where(eq(knowledgeBases.tenantId, TENANT))
  .all();
const KB_IDS = kbRows.map((k) => k.id);
console.log(`[spike] tenant=${TENANT} · ${KB_IDS.length} KB'er · remote=${REMOTE_URL}`);

// Rigtige brugerspørgsmål fra chathistorikken — det er dem chatten faktisk får.
const turnRows = await local.db
  .select({ content: chatTurns.content })
  .from(chatTurns)
  .where(eq(chatTurns.role, 'user'))
  .orderBy(desc(chatTurns.createdAt))
  .limit(40)
  .all();
const QUERIES = [...new Set(turnRows.map((r) => r.content.trim()).filter((q) => q.length > 3 && q.length < 300))].slice(0, 12);
if (QUERIES.length < 5) {
  console.error(`✗ kun ${QUERIES.length} rigtige forespørgsler fundet — for få til en måling`);
  process.exit(1);
}
console.log(`[spike] ${QUERIES.length} rigtige brugerforespørgsler fra chat_turns`);

// ── Den fulde retrieval-sekvens (spejler retrieveContext i chat.ts) ─────────
async function listFadedHeuristicIds(trail: TrailDatabase, kbId: string): Promise<Set<string>> {
  const rows = await trail.db
    .select({ id: documents.id, content: documents.content, updatedAt: documents.updatedAt })
    .from(documents)
    .where(
      and(
        eq(documents.knowledgeBaseId, kbId),
        eq(documents.tenantId, TENANT),
        eq(documents.kind, 'wiki'),
        eq(documents.archived, false),
        like(documents.path, `${HEURISTIC_PATH}%`),
      ),
    )
    .all();
  const faded = new Set<string>();
  for (const r of rows) {
    const pinned = isPinned(r.content);
    if (isFaded(computeConfidence(r.updatedAt, pinned))) faded.add(r.id);
  }
  return faded;
}

async function fullRetrieval(trail: TrailDatabase, query: string): Promise<string[]> {
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];
  const surfaced: string[] = [];
  for (const kbId of KB_IDS) {
    const faded = await listFadedHeuristicIds(trail, kbId);
    const chunkHits = await trail.searchChunks(ftsQuery, kbId, TENANT, 8);
    const docHits = await trail.searchDocuments(ftsQuery, kbId, TENANT, 4);
    const confMap = await loadNeuronConfidence(trail, TENANT, [
      ...chunkHits.map((h) => h.documentId),
      ...docHits.map((h) => h.id),
    ]);
    const seen = new Set<string>();
    for (const h of chunkHits) {
      if (h.kind !== 'wiki' || faded.has(h.documentId) || !isChatVisible(confMap.get(h.documentId))) continue;
      if (!seen.has(h.documentId)) { seen.add(h.documentId); surfaced.push(h.documentId); }
    }
    const ranked = docHits
      .filter((h) => h.kind === 'wiki' && !faded.has(h.id) && isChatVisible(confMap.get(h.id)))
      .sort((a, b) => confidenceOf(confMap, b.id) - confidenceOf(confMap, a.id));
    const needContent = ranked.filter((h) => !seen.has(h.id)).map((h) => h.id);
    if (needContent.length > 0) {
      await trail.db
        .select({ id: documents.id, content: documents.content, createdAt: documents.createdAt })
        .from(documents)
        .where(and(eq(documents.tenantId, TENANT), inArray(documents.id, needContent)))
        .all();
    }
    for (const h of ranked) if (!seen.has(h.id)) { seen.add(h.id); surfaced.push(h.id); }
    await trail.searchUserNotes(ftsQuery, kbId, TENANT, 4);
  }
  return surfaced;
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

let failed = false;

// ── Fase 0: NEGATIV KONTROL ─────────────────────────────────────────────────
// Sammenligneren skal kunne se en forskel, ellers beviser "identisk" intet.
{
  const a = await fullRetrieval(local, QUERIES[0]);
  const b = await fullRetrieval(local, QUERIES[1] ?? 'noget helt andet her');
  const differs = JSON.stringify(a) !== JSON.stringify(b);
  console.log(`${differs ? '✓' : '✗'} NEGATIV KONTROL: to forskellige forespørgsler giver forskellige resultater`);
  if (!differs) failed = true;
}

// ── Fase 1: Paritet ─────────────────────────────────────────────────────────
if (!failed && (MODE === 'all' || MODE === 'parity' || MODE === 'read')) {
  for (const sqlq of [
    `SELECT COUNT(*) AS n FROM documents`,
    `SELECT COUNT(*) AS n FROM document_chunks`,
    `SELECT COUNT(*) AS n FROM knowledge_bases`,
  ]) {
    const l = (await local.execute(sqlq)).rows[0].n;
    const r = (await remote.execute(sqlq)).rows[0].n;
    const ok = l === r;
    console.log(`${ok ? '✓' : '✗'} paritet ${sqlq.replace('SELECT COUNT(*) AS n FROM ', '')}: lokal=${l} remote=${r}`);
    if (!ok) failed = true;
  }
  let ftsMatch = 0;
  for (const q of QUERIES) {
    const l = await fullRetrieval(local, q);
    const r = await fullRetrieval(remote, q);
    if (JSON.stringify(l) === JSON.stringify(r)) ftsMatch++;
    else { console.log(`✗ FTS-paritet AFVIGER på: "${q.slice(0, 60)}" lokal=${l.length} remote=${r.length}`); failed = true; }
  }
  console.log(`${ftsMatch === QUERIES.length ? '✓' : '✗'} FTS-paritet: ${ftsMatch}/${QUERIES.length} forespørgsler identiske lokal vs remote`);
}

// ── Fase 2: Chat-retrieval p50/p95 ──────────────────────────────────────────
if (!failed && (MODE === 'all' || MODE === 'read')) {
  const ROUNDS = 5;
  for (const [name, trail] of [['lokal fil', local], ['sqld remote', remote]] as const) {
    // opvarmning (forbindelse + page cache)
    for (const q of QUERIES.slice(0, 3)) await fullRetrieval(trail, q);
    const times: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      for (const q of QUERIES) {
        const t0 = performance.now();
        await fullRetrieval(trail, q);
        times.push(performance.now() - t0);
      }
    }
    console.log(
      `[bench] ${name}: n=${times.length} · p50=${pct(times, 50).toFixed(1)}ms · p95=${pct(times, 95).toFixed(1)}ms · max=${Math.max(...times).toFixed(1)}ms`,
    );
  }
}

// ── Fase 3: Ingest-skrivesti ────────────────────────────────────────────────
if (!failed && (MODE === 'all' || MODE === 'ingest')) {
  const localWrite = openLocal(WRITE_COPY, TENANT);
  // userId er en FK til users-tabellen — brug en rigtig bruger fra datasættet.
  const userRow = await local.execute(`SELECT user_id AS u FROM documents WHERE user_id IS NOT NULL LIMIT 1`);
  const SPIKE_USER = String(userRow.rows[0]?.u ?? '');
  if (!SPIKE_USER) { console.error('✗ ingen bruger-id fundet i datasættet'); process.exit(1); }
  for (const [name, trail] of [['lokal fil', localWrite], ['sqld remote', remote]] as const) {
    const api = createCandidateQueueAPI({
      trail,
      tenantId: TENANT,
      tenantName: TENANT,
      userId: SPIKE_USER,
      connector: 'mcp:claude-code',
      ingestJobId: null,
      defaultKbId: KB_IDS[0],
    });
    const times: number[] = [];
    const nonce = Date.now();
    for (let i = 0; i < 8; i++) {
      const t0 = performance.now();
      const res = await api.write({
        knowledge_base: KB_IDS[0],
        command: 'create',
        path: '/neurons/sources/',
        title: `F222.2 spike-neuron ${nonce}-${i}`,
        content: `# Spike-måling ${nonce}-${i}\n\nDette er en F222.2 skrivesti-måling: dokument + FTS-indeksopdatering gennem den rigtige ingest-kode. Ord til indekset: zoneterapi massage åbningstider gavekort ${nonce}.`,
        tags: 'f222-spike',
      });
      times.push(performance.now() - t0);
      if (!res.ok) { console.log(`✗ ingest-write fejlede (${name}): ${JSON.stringify(res)}`); failed = true; break; }
    }
    if (!failed) {
      // læs-tilbage: den nye side SKAL kunne findes af FTS bagefter
      const hits = await trail.searchDocuments(buildFtsQuery(`spike ${nonce}`), KB_IDS[0], TENANT, 5);
      const found = hits.length > 0;
      console.log(
        `[ingest] ${name}: 8 writes · p50=${pct(times, 50).toFixed(0)}ms · max=${Math.max(...times).toFixed(0)}ms · FTS finder de nye: ${found ? 'JA' : 'NEJ'}`,
      );
      if (!found) failed = true;
    }
  }
  await localWrite.close();
}

await local.close();
await remote.close();
console.log(failed ? '\n✗ SPIKE FEJLEDE — se linjerne ovenfor' : '\n✓ SPIKE GRØN');
process.exit(failed ? 1 : 0);
