import { Hono } from 'hono';
import { documents, knowledgeBases, sikkertUddrag, type TrailDatabase } from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { requireAuth, getTenant, getTrail } from '../middleware/auth.js';
import { parseTags, canonicaliseTag, parseSeqId, kbPrefix, redactSecrets, buildFtsQuery } from '@trail/shared';
import { resolveKbId, rangerKandidater } from '@trail/core';
import { vectorSearch, hybridEnabled } from '../services/hybrid-search.js';
import { exactTitleMatches } from '@trail/core';
import {
  effectiveAudience,
  isVisibleToAudience,
  type Audience,
} from '../services/audience.js';
import type { AppBindings } from '../app.js';

export const searchRoutes = new Hono<AppBindings>();

searchRoutes.use('*', requireAuth);

/**
 * F265.8 — HELE NEURONEN, KUN NÅR NOGEN BEDER OM DEN.
 *
 * cms målte at Aidan fik 7 % af en artikel: 337 tegn af 4.441. Årsagen var
 * min egen ændring samme dag. Indtil F265.3 var `highlight` HELE dokumentet
 * (SQLites highlight() giver hele kolonnen), og cms læste feltet som
 * indholdet — hvilket virkede, netop fordi fejlen gav dem hele artiklen.
 *
 * At rulle tilbage ville genindføre ~3.770 tokens pr. opslag for enhver
 * agent, og dét tal er hele grunden til at flåden holdt op med at søge. Den
 * rigtige rettelse er ikke at give uddraget indholdets betydning tilbage —
 * det er at der FINDES en måde at bede om indholdet på.
 *
 * OPT-IN med vilje: buddys agenter kalder samme rute. Blev indhold standard,
 * ville de betale for noget de netop har målt sig fri af.
 *
 * Hentes EFTER publikums-filteret, så flaget aldrig kan bruges til at nå en
 * Neuron man ikke måtte se uddraget af — og redaktøren kører på det, fordi
 * 5.000 tegn er en større angrebsflade for en lækket hemmelighed end 300.
 */
export async function hentIndhold(
  trail: TrailDatabase,
  tenantId: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = (await trail.execute(
    `SELECT id, content FROM documents
      WHERE tenant_id = ? AND archived = 0 AND id IN (${ids.map(() => '?').join(',')})`,
    [tenantId, ...ids],
  )).rows as Array<{ id: unknown; content: unknown }>;
  return new Map(rows.map((r) => [String(r.id), String(r.content ?? '')]));
}

searchRoutes.get('/knowledge-bases/:kbId/search', async (c) => {
  const trail = getTrail(c);
  const tenant = getTenant(c);
  const kbId = await resolveKbId(trail, tenant.id, c.req.param('kbId'));
  if (!kbId) return c.json({ error: 'Not found' }, 404);
  const query = c.req.query('q') ?? '';
  const limit = Math.min(Number(c.req.query('limit') ?? 10), 50);
  // F160 — audience-filter. External Bearer integrations default to
  // `tool` (heuristics + internal-tagged docs hidden). Admin session
  // gets `curator` (everything visible). Caller can override via
  // ?audience=. Garbage values silently fall back to default rather
  // than erroring — saves a round-trip when a typo'd param shows up.
  const authType = c.get('authType');
  // F255 — kalderen må INDSNÆVRE, aldrig UDVIDE. Se effectiveAudience.
  const audience: Audience = effectiveAudience(authType, c.req.query('audience'));
  // F265.8 — opt-in: hele Neuronen i stedet for kun uddraget.
  const medIndhold = c.req.query('includeContent') === 'true';
  // F92 — repeated ?tag= params narrow the hit list to Neurons whose
  // `tags` column contains every tag (AND-semantics). Canonicalise
  // here so `Ops`, `ops`, and `OPS` all collapse to the same filter
  // and match a case-insensitive DB value. An empty/non-canonicalisable
  // tag is dropped silently — same rule as the write path.
  const rawTags = c.req.queries('tag') ?? [];
  const tagFilters = rawTags
    .map((raw) => canonicaliseTag(raw))
    .filter((t): t is string => !!t);

  if (!query.trim()) {
    return c.json({ documents: [], chunks: [] });
  }

  // F145 — `#`-prefixed queries are seqId lookups, not FTS. Three shapes:
  //   #buddy_00000219 → exact hit if this KB's prefix matches "buddy"
  //   #00000219 / #219 → plain digits, look up seq in current KB
  //   anything else after `#` → fall through to FTS
  // No tag filter interaction: seqId uniquely identifies a row, so tags
  // would just narrow away the intended result.
  if (query.trim().startsWith('#')) {
    const hit = await lookupBySeqId(trail, tenant.id, kbId, query.trim());
    // F160 — apply audience filter even on direct seqId hits. An
    // external Bearer caller probing `#sanne_00000017` shouldn't get a
    // heuristic Neuron back just because they guessed the right seq.
    if (hit && isVisibleToAudience(audience, hit.path, hit.tags)) {
      // F197 — egress guardrail: scrub any leaked credential from the title.
      return c.json({
        documents: [{ ...hit, title: hit.title == null ? hit.title : redactSecrets(hit.title).redacted }],
        chunks: [],
      });
    }
    // Unknown #id (or audience-filtered) — return empty rather than
    // silently fall through so the curator knows the id didn't resolve
    // (not that "nothing looks like that word either"). Matches how
    // #tag searches behave elsewhere.
    return c.json({ documents: [], chunks: [] });
  }

  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return c.json({ documents: [], chunks: [] });

  // F112.2 — also search shared user-notes (LIKE on user_note column).
  // Notes opted-in via F112.1's share-flag are surfaced as
  // document-level hits, deduplicated against FTS hits below so a
  // Neuron whose body AND note both match shows once with the FTS
  // hit (richer highlight) rather than twice.
  const [documents, chunks, noteHits] = await Promise.all([
    trail.searchDocuments(ftsQuery, kbId, tenant.id, limit),
    trail.searchChunks(ftsQuery, kbId, tenant.id, limit),
    trail.searchUserNotes(query, kbId, tenant.id, limit),
  ]);

  // Merge note-hits with FTS document-hits, dropping duplicates by id.
  // FTS hits keep their slot (better highlight) — note-only hits append.
  const seenIds = new Set(documents.map((d) => d.id));
  for (const note of noteHits) {
    if (seenIds.has(note.id)) continue;
    documents.push(note);
    seenIds.add(note.id);
    if (documents.length >= limit) break;
  }

  // ── F261 — ET NAVN ER ET OPSLAG ─────────────────────────────────────────
  //
  // Ejeren: «hvis jeg søger efter "Cardmem" så leder jeg i min hjerne efter om
  // der er en præcis reference (en neuron) med det navn.»
  //
  // En TITEL er en anden slags bevis end en ordtælling, og den skal derfor
  // ikke konkurrere på score — den skal ligge FØRST. Målt før reglen: søgning
  // på «Christian Broberg» gav hans egen Neuron som nr. 17, under seksten
  // sider der blot nævnte «broberg».
  //
  // Træffet ERSTATTER ikke resten. Man vil have sin Neuron først OG stadig se
  // hvad der ellers nævner navnet.
  const præcise = await exactTitleMatches(trail, tenant.id, kbId, query);
  if (præcise.length > 0) {
    const ids = præcise.map((p) => p.id).filter((id) => !seenIds.has(id));
    if (ids.length > 0) {
      const rows = (await trail.execute(
        `SELECT id, filename, path, title, seq AS seqId, '' AS highlight
           FROM documents
          WHERE tenant_id = ? AND knowledge_base_id = ? AND archived = 0
            AND id IN (${ids.map(() => '?').join(',')})`,
        [tenant.id, kbId, ...ids],
      )).rows as Array<Record<string, unknown>>;
      const byId = new Map(rows.map((r) => [String(r.id), r]));
      for (const id of ids) {
        const row = byId.get(id);
        if (row) { documents.unshift(row as never); seenIds.add(id); }
      }
    }
    // Allerede fundet af ordsøgningen? Så flyt det op i stedet for at tilføje
    // det igen — dét var hele fejlen: dokumentet VAR der, bare på plads 17.
    const præciseIds = new Set(præcise.map((p) => p.id));
    // Stabil sortering: kun præcise træf flyttes frem, resten beholder sin
    // indbyrdes orden fra ordsøgningen.
    documents.sort((a, b) => {
      const A = præciseIds.has(String((a as { id: unknown }).id)) ? 0 : 1;
      const B = præciseIds.has(String((b as { id: unknown }).id)) ? 0 : 1;
      return A - B;
    });
  }

  // ── F254.2 — hybrid: betydning ved siden af ord ──────────────────────────
  //
  // KANDIDATERNE FØDES IND HER, ØVERST I TRAGTEN — ikke i en parallel svarvej.
  // Alt nedenfor (F92 tag-filter, F160 publikums-filter, F197 scrubning) gælder
  // derfor automatisk for vektor-træf. En anden vej ud med sine egne kopier af
  // de spærrer er præcis hvordan man lækker en intern Neuron til en ekstern
  // nøgle: kopien glemmer ét filter, og den gamle vej er stadig rigtig, så
  // ingen opdager det.
  //
  // Slukket som standard. `hybrid_search_enabled` sættes pr. videnbase, og
  // FTS5-vejen ovenfor er uændret når den er slukket — også hvis alt dette
  // fejler.
  let hybridInfo: { used: boolean; coverage: number; unavailable?: string } | null = null;
  if (await hybridEnabled(trail, kbId)) {
    const vec = await vectorSearch(trail, tenant.id, kbId, query, limit);
    hybridInfo = { used: vec.hits.length > 0, coverage: vec.coverage, ...(vec.unavailable ? { unavailable: vec.unavailable } : {}) };

    if (vec.hits.length > 0) {
      // Hent de dokumenter vektor-halvdelen fandt, som ordmatchningen ikke
      // allerede har. Samme projektion som searchDocuments, så alt nedenfor
      // ikke kan se forskel på hvor en kandidat kom fra.
      const nye = vec.hits.map((h: { documentId: string }) => h.documentId).filter((id: string) => !seenIds.has(id));
      if (nye.length > 0) {
        const placeholders = nye.map(() => '?').join(',');
        // F265.5 — UDDRAGET FOR ET VEKTOR-TRÆF ER DET STYKKE DER MATCHEDE.
        //
        // Stod før som `'' AS highlight`. Målt 9/9, minutter efter at indekset
        // blev fyldt: hvert eneste vektor-fundne dokument kom tilbage med
        // TOMT uddrag. Agenten fik en titel og ingen kontekst — den kunne se
        // HVAD der blev fundet og aldrig HVORFOR, og måtte hente hele
        // dokumentet for at afgøre om træffet var brugbart.
        //
        // Stykket var kendt hele vejen: vectorSearch finder det bedste stykke
        // pr. dokument og kasserede id'et to linjer senere. Nu bæres det med,
        // og teksten hentes herfra. Ordmatch-stien har sit eget uddrag fra
        // snippet() og røres ikke.
        const stykkeFor = new Map(vec.hits.map((h: { documentId: string; chunkId: string }) => [h.documentId, h.chunkId]));
        const rows = (await trail.execute(
          `SELECT d.id, d.filename, d.path, d.title, d.seq AS seqId,
                  c.id AS matchChunkId, c.content AS matchContent
             FROM documents d
             LEFT JOIN document_chunks c
               ON c.document_id = d.id
            WHERE d.tenant_id = ? AND d.knowledge_base_id = ? AND d.archived = 0
              AND d.id IN (${placeholders})`,
          [tenant.id, kbId, ...nye],
        )).rows as Array<Record<string, unknown>>;
        // Behold KUN det stykke vektor-søgningen pegede på. JOIN'en giver én
        // række pr. stykke; uden dette filter ville en Neuron med ti stykker
        // optræde ti gange.
        const byId = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          const id = String(r.id);
          if (String(r.matchChunkId ?? '') !== stykkeFor.get(id)) continue;
          byId.set(id, r);
        }
        for (const id of nye) {
          const row = byId.get(id);
          if (!row) continue;
          const tekst = String(row.matchContent ?? '').trim();
          // Samme længde som snippet()-vinduet på ordmatch-stien, så de to
          // slags træf ikke ser forskellige ud i en liste.
          // F265.7 — ANDEN DØR. Ordmatch-vejens uddrag escapes inde i @trail/db,
          // men DENNE tekst er rå indhold fra et stykke, og den lander i samme
          // felt — som admin sætter ind med dangerouslySetInnerHTML. Rettedes
          // kun den ene vej, var et vektor-træf stadig en åben vej for HTML
          // fra en clippet side. Målt på prod: ordmatch-vejen var lukket og
          // denne stod åben.
          const rået = tekst.length > 300 ? `${tekst.slice(0, 300)}…` : tekst;
          const uddrag = sikkertUddrag(rået);
          documents.push({
            id: row.id, filename: row.filename, path: row.path,
            title: row.title, seqId: row.seqId, highlight: uddrag,
          } as never);
          seenIds.add(id);
        }
      }

      // Flet på PLADS, ikke på score: bm25 er negativ og ubegrænset, cosinus
      // ligger i [-1,1]. De to tal kan ikke sammenlignes.
      //
      // F262.3 — DET PRÆCISE NAVN OVERLEVER FLETNINGEN. Den gamle sortering
      // her overskrev den F261 lavede tyve linjer længere oppe, så «Cardmem»
      // mistede sin garanti for at Neuronen der HEDDER Cardmem lå nr. 1, i
      // samme øjeblik hybrid blev tændt. Det kunne ikke ses før: hybridEnabled()
      // svarede altid nej (F262.2), så anden halvdel af sorteringen kørte
      // aldrig, og en død kodegren kan ikke være i konflikt med noget.
      //
      // Rangeringen ligger FØR afkortningen nedenfor — ellers kunne et præcist
      // træf blive skåret væk inden det blev flyttet frem.
      const rangeret = rangerKandidater(documents as Array<{ id: string }>, {
        præcise: new Set(præcise.map((p) => p.id)),
        ord: documents.map((d: { id: string }) => ({ id: d.id })),
        vektor: vec.hits.map((h: { documentId: string }) => ({ id: h.documentId })),
      });
      documents.length = 0;
      documents.push(...(rangeret as never[]));
      documents.length = Math.min(documents.length, limit);
    }
  }

  // F92 tag facet. searchDocuments returns a narrow projection that
  // doesn't include the tags column, so we re-hydrate tags here for
  // just the doc IDs in the hit list, then filter + decorate.
  // F160 — for non-curator audience we ALSO need tags to apply the
  // audience-filter (drops Neurons tagged 'internal'), so always
  // load them when there's a hit list. The tag-load cost is one
  // small IN-query against an indexed PK list — cheap.
  if (documents.length > 0) {
    const tagMap = await loadTagsForDocIds(
      trail,
      tenant.id,
      documents.map((d) => d.id),
    );
    let filtered = documents;
    // F92 explicit tag filter (AND-semantics).
    if (tagFilters.length > 0) {
      filtered = filtered.filter((d) => {
        const docTags = parseTags(tagMap.get(d.id) ?? null).map((t) => t.toLowerCase());
        return tagFilters.every((t) => docTags.includes(t));
      });
    }
    // F160 audience-filter. curator path is a no-op (isVisibleToAudience
    // returns true unconditionally), so admin-UI behaviour is unchanged.
    if (audience !== 'curator') {
      filtered = filtered.filter((d) =>
        isVisibleToAudience(audience, d.path, tagMap.get(d.id) ?? null),
      );
    }
    // F197 — egress guardrail: redact any leaked credential out of the hits
    // (title/highlight/userNote + chunk content) before they leave the API, so
    // a secret that slipped into a Neuron can't surface in search results.
    // F265.8 — hentes EFTER filtrene, aldrig før: et dokument der er filtreret
    // væk må ikke kunne hentes hjem af flaget.
    const indhold = medIndhold
      ? await hentIndhold(trail, tenant.id, filtered.map((d) => d.id))
      : new Map<string, string>();

    return c.json({
      documents: filtered.map((d) => {
        const un = (d as { userNote?: unknown }).userNote;
        const fuldt = indhold.get(d.id);
        return {
          ...d,
          tags: tagMap.get(d.id) ?? null,
          title: d.title == null ? d.title : redactSecrets(d.title).redacted,
          highlight: redactSecrets(d.highlight).redacted,
          ...(fuldt !== undefined ? { content: redactSecrets(fuldt).redacted } : {}),
          ...(typeof un === 'string' ? { userNote: redactSecrets(un).redacted } : {}),
        };
      }),
      chunks: chunks.map((ch) => ({
        ...ch,
        content: redactSecrets(ch.content).redacted,
        highlight: redactSecrets(ch.highlight).redacted,
      })),
    });
  }

  return c.json({
    documents,
    chunks: chunks.map((ch) => ({
      ...ch,
      content: redactSecrets(ch.content).redacted,
      highlight: redactSecrets(ch.highlight).redacted,
    })),
  });
});

/**
 * One-shot tags lookup for the hit list. Single IN query — the hit
 * list is capped at `limit` (max 50) so the parameter list never
 * exceeds SQLite's 999-param ceiling.
 */
async function loadTagsForDocIds(
  trail: ReturnType<typeof getTrail>,
  tenantId: string,
  ids: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await trail.execute(
    `SELECT id, tags FROM documents
      WHERE tenant_id = ?
        AND id IN (${placeholders})`,
    [tenantId, ...ids],
  );
  for (const row of rows.rows as Array<{ id: string; tags: string | null }>) {
    map.set(row.id, row.tags);
  }
  return map;
}

/**
 * F145 — resolve a `#`-prefixed seqId query to a single document row.
 * Accepts the full `#prefix_digits` form or a bare `#digits` that defaults
 * to the current KB. Returns null when the id doesn't match anything in
 * the current tenant.
 */
async function lookupBySeqId(
  trail: ReturnType<typeof getTrail>,
  tenantId: string,
  currentKbId: string,
  query: string,
): Promise<{ id: string; title: string | null; path: string; kind: string; tags: string | null; seq: number } | null> {
  const parsed = parseSeqId(query);
  let seq: number;
  let targetKbId = currentKbId;
  if (parsed) {
    seq = parsed.seq;
    // Verify the parsed prefix matches the current KB. If not, resolve to
    // whichever KB in this tenant has a matching prefix.
    const kbs = await trail.db
      .select({ id: knowledgeBases.id, name: knowledgeBases.name })
      .from(knowledgeBases)
      .where(eq(knowledgeBases.tenantId, tenantId))
      .all();
    const match = kbs.find((kb) => kbPrefix(kb.name) === parsed.prefix);
    if (!match) return null;
    targetKbId = match.id;
  } else {
    // `#<digits>` shorthand — look up in current KB.
    const digits = query.trim().replace(/^#/, '');
    const parsedDigits = Number.parseInt(digits, 10);
    if (!Number.isFinite(parsedDigits) || parsedDigits < 0) return null;
    seq = parsedDigits;
  }
  const row = await trail.db
    .select({
      id: documents.id,
      title: documents.title,
      path: documents.path,
      kind: documents.kind,
      tags: documents.tags,
      seq: documents.seq,
    })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        eq(documents.knowledgeBaseId, targetKbId),
        eq(documents.seq, seq),
      ),
    )
    .get();
  if (!row || row.seq === null) return null;
  return { ...row, seq: row.seq };
}
