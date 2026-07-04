/**
 * FTS5-backed search helpers. Kept as standalone functions so the
 * TrailDatabase adapter can dispatch to them without carrying a
 * class-method shape — and so tests can unit-test them with a plain
 * libSQL client without instantiating the full adapter.
 */
import type { Client as LibSqlClient } from '@libsql/client';
import type { DocumentSearchHit, ChunkSearchHit } from './interface.js';

// Recency boost on FTS ranking. A fresh, specific Neuron (e.g. a just-written
// decision) otherwise loses to many older rows that mention a ubiquitous term
// ("mistral" appears in thousands of rows), because BM25 has no notion of "new".
// We nudge recent rows up WITHOUT letting recency override a clearly stronger
// match. SQLite `rank` (bm25) is negative — more-negative = better — so we
// multiply by (1 + boost*recency) to push recent rows further negative. recency
// = 1 at age 0, 0.5 at one half-life, →0 for old rows (hyperbolic decay; no
// exp() needed). Fully reversible: SEARCH_RECENCY_BOOST=0 → pure BM25 (the
// pre-change behaviour).
const RECENCY_BOOST = Number(process.env.SEARCH_RECENCY_BOOST ?? '0.4');
const RECENCY_HALFLIFE_DAYS = Number(process.env.SEARCH_RECENCY_HALFLIFE_DAYS ?? '30');

/** ORDER BY clause: recency-boosted when configured (finite, positive), else
 *  plain bm25 `rank`. A malformed env (NaN) fails the `> 0` guard → safe
 *  fallback. `tsCol` is the created_at column to age against (in query scope). */
function rankOrderBy(tsCol: string): string {
  if (!(RECENCY_BOOST > 0) || !(RECENCY_HALFLIFE_DAYS > 0)) return 'ORDER BY rank';
  return `ORDER BY rank * (1.0 + ${RECENCY_BOOST} * (1.0 / (1.0 + (julianday('now') - julianday(${tsCol})) / ${RECENCY_HALFLIFE_DAYS})))`;
}

const DOCUMENTS_SQL = `
  SELECT d.id                                               AS id,
         d.knowledge_base_id                                AS knowledgeBaseId,
         d.filename                                         AS filename,
         d.title                                            AS title,
         d.path                                             AS path,
         d.kind                                             AS kind,
         d.seq                                              AS seq,
         highlight(documents_fts, 0, '<mark>', '</mark>')   AS highlight,
         rank                                               AS rank
    FROM documents_fts
    JOIN documents d ON d.rowid = documents_fts.rowid
   WHERE documents_fts MATCH ?
     AND d.knowledge_base_id = ?
     AND d.tenant_id = ?
     AND d.archived = 0
   ${rankOrderBy('d.created_at')}
   LIMIT ?
`;

const CHUNKS_SQL = `
  SELECT dc.id                                              AS id,
         dc.document_id                                     AS documentId,
         dc.knowledge_base_id                               AS knowledgeBaseId,
         dc.chunk_index                                     AS chunkIndex,
         dc.content                                         AS content,
         dc.header_breadcrumb                               AS headerBreadcrumb,
         pd.kind                                            AS kind,
         pd.created_at                                      AS docCreatedAt,
         highlight(chunks_fts, 0, '<mark>', '</mark>')      AS highlight,
         rank                                               AS rank
    FROM chunks_fts
    JOIN document_chunks dc ON dc.rowid = chunks_fts.rowid
    JOIN documents pd ON pd.id = dc.document_id
   WHERE chunks_fts MATCH ?
     AND dc.knowledge_base_id = ?
     AND dc.tenant_id = ?
     AND pd.archived = 0
   ${rankOrderBy('pd.created_at')}
   LIMIT ?
`;

export async function searchDocuments(
  client: LibSqlClient,
  query: string,
  kbId: string,
  tenantId: string,
  limit = 10,
): Promise<DocumentSearchHit[]> {
  const result = await client.execute({ sql: DOCUMENTS_SQL, args: [query, kbId, tenantId, limit] });
  return result.rows.map((row) => ({
    id: row.id as string,
    knowledgeBaseId: row.knowledgeBaseId as string,
    filename: row.filename as string,
    title: (row.title as string | null) ?? null,
    path: row.path as string,
    kind: row.kind as 'source' | 'wiki',
    highlight: row.highlight as string,
    rank: row.rank as number,
    seq: (row.seq as number | null) ?? null,
  }));
}

export async function searchChunks(
  client: LibSqlClient,
  query: string,
  kbId: string,
  tenantId: string,
  limit = 10,
): Promise<ChunkSearchHit[]> {
  const result = await client.execute({ sql: CHUNKS_SQL, args: [query, kbId, tenantId, limit] });
  return result.rows.map((row) => ({
    id: row.id as string,
    documentId: row.documentId as string,
    knowledgeBaseId: row.knowledgeBaseId as string,
    chunkIndex: row.chunkIndex as number,
    content: row.content as string,
    headerBreadcrumb: (row.headerBreadcrumb as string | null) ?? null,
    highlight: row.highlight as string,
    rank: row.rank as number,
    kind: row.kind as 'source' | 'wiki',
    docCreatedAt: (row.docCreatedAt as string | null) ?? '',
  }));
}

/**
 * F112.2 — search shared user-notes via LIKE.
 *
 * user_note isn't part of the FTS5 virtual table (would require a
 * migration + trigger rewrite). Notes are short (< 4000 chars) and
 * the share-gate filters out the vast majority, so a per-row LIKE
 * scan is plenty fast at single-tenant scale. If/when a tenant has
 * 10k+ shared notes we revisit and fold into documents_fts.
 *
 * Privacy gate: ONLY surfaces rows where user_note_share = 1. Private
 * notes never leak to the search-result list — same opt-in stance as
 * F112.1's chat + retrieve gates.
 *
 * The plain-text query is matched as a substring (case-insensitive
 * via LOWER(...)). Multiple words are split + AND'ed: each term must
 * appear somewhere in the note. Highlight is a manually-built
 * <mark>...</mark> wrap of the first matching term so the UI can
 * render it consistently with FTS hits.
 */
const USER_NOTES_SQL = `
  SELECT d.id                AS id,
         d.knowledge_base_id AS knowledgeBaseId,
         d.filename          AS filename,
         d.title             AS title,
         d.path              AS path,
         d.kind              AS kind,
         d.seq               AS seq,
         d.user_note         AS userNote
    FROM documents d
   WHERE d.tenant_id = ?
     AND d.knowledge_base_id = ?
     AND d.archived = 0
     AND d.user_note_share = 1
     AND d.user_note IS NOT NULL
`;

/**
 * Hit shape matches DocumentSearchHit + an extra `userNote` field
 * carrying the full note text. Chat retrieveContext consumes
 * `userNote` directly to build the LLM context block, avoiding a
 * per-hit follow-up SELECT (which contended with parallel writes
 * and produced "database is locked" errors).
 */
export interface UserNoteSearchHit extends DocumentSearchHit {
  userNote: string;
}

export async function searchUserNotes(
  client: LibSqlClient,
  query: string,
  kbId: string,
  tenantId: string,
  limit = 10,
): Promise<UserNoteSearchHit[]> {
  // Two-pass substring match on the user's query:
  //   1. Try the FULL query as a substring (handles literal lookups
  //      like "Obi-Wan Kenobi" or "VIP customer").
  //   2. Fall back to per-token OR (split on whitespace ONLY,
  //      preserves hyphenation like "Obi-Wan"). Each whitespace-
  //      separated token of length ≥ 3 is tried as a substring.
  //      "Kender Sanne Obi-Wan Kenobi" → tokens [kender, sanne,
  //      obi-wan, kenobi], "obi-wan" matches "obi-wan kenobi" in
  //      the note → hit.
  //
  // Punctuation is intentionally NOT stripped from tokens — that
  // bug-class (idx=-1 because dash was removed) was the source of
  // "Obi-" hitting but "Obi-Wan" not on 2026-05-06.
  const fullNeedle = query.trim().toLowerCase();
  if (fullNeedle.length < 2) return [];
  // Strip EDGE punctuation only (?, !, . at start/end). Preserves
  // intra-token hyphens like "Obi-Wan" so they still match the note's
  // "obi-wan kenobi". "jedi?" → "jedi"; "(noget)." → "noget";
  // "Star-Wars-stuff" → "Star-Wars-stuff" (untouched).
  const tokens = fullNeedle
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((t) => t.length >= 3);

  const result = await client.execute({ sql: USER_NOTES_SQL, args: [tenantId, kbId] });
  const matches: UserNoteSearchHit[] = [];
  for (const row of result.rows) {
    const note = (row.userNote as string | null) ?? '';
    const noteLower = note.toLowerCase();
    let matchedNeedle: string | null = null;
    if (noteLower.includes(fullNeedle)) {
      matchedNeedle = fullNeedle;
    } else {
      for (const tok of tokens) {
        if (noteLower.includes(tok)) {
          matchedNeedle = tok;
          break;
        }
      }
    }
    if (!matchedNeedle) continue;
    // Build a highlight snippet — wrap the matched substring + show
    // up to 80 chars surrounding context so the UI has something to
    // render alongside the title.
    const firstTerm = matchedNeedle;
    const idx = noteLower.indexOf(firstTerm);
    const start = Math.max(0, idx - 30);
    const end = Math.min(note.length, idx + firstTerm.length + 50);
    const before = start > 0 ? '…' : '';
    const after = end < note.length ? '…' : '';
    const slice = note.slice(start, end);
    const highlight =
      before +
      slice.slice(0, idx - start) +
      '<mark>' +
      slice.slice(idx - start, idx - start + firstTerm.length) +
      '</mark>' +
      slice.slice(idx - start + firstTerm.length) +
      after;
    matches.push({
      id: row.id as string,
      knowledgeBaseId: row.knowledgeBaseId as string,
      filename: row.filename as string,
      title: (row.title as string | null) ?? null,
      path: row.path as string,
      kind: row.kind as 'source' | 'wiki',
      highlight: `📝 ${highlight}`,
      // Synthetic rank: user-note hits rank slightly behind FTS hits
      // by default. The route can re-sort if it wants notes-first.
      rank: 0.5,
      seq: (row.seq as number | null) ?? null,
      userNote: note,
    });
    if (matches.length >= limit) break;
  }
  return matches;
}
