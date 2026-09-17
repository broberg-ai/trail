/**
 * F275.5 — supersession has to PROPAGATE.
 *
 * ## The measured case
 *
 * On the night of 15–16 September, FIVE pages said "being built now" after the
 * source said "launched": `overview.md`, `glossary.md`, `flagskib.md`, the source
 * Neuron and the entity Neuron. **Only ONE of them carries the source's URL as
 * its own identity.** The other four cite the source without being compiled FROM
 * it.
 *
 * If supersession only touches the source Neuron, the queue goes clean while the
 * brain still answers from yesterday's text — **and that is worse than today,
 * because it no longer looks like a problem.**
 *
 * ## The link is LOOKED UP, never guessed
 *
 * Two ways in, both id-based:
 *
 *   compiled-from   `documents.source_identity` on the Neuron (F275.1/F275.3)
 *   cites           `document_references.source_document_id` → the source row
 *
 * No text comparison. A Neuron that happens to mention the same words without
 * deriving from the source must NOT be touched — otherwise an edit to one page
 * tidies up pages that have nothing to do with it, which would be greater damage
 * than the one the feature removes.
 *
 * ## We do not rewrite. We make it VISIBLE.
 *
 * The card's own constraint: *"No automatic rewriting of a Neuron without it
 * being visible. A silent mass edit of the brain is worse than a visible list of
 * what needs looking at."* So this module stamps a timestamp on each dependent
 * page and hands the list back; the call site reports it into the queue.
 */
import { documents, documentReferences, type TrailDatabase } from '@trail/db';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';

/** How a Neuron hangs off the source. */
export type LinkKind = 'compiled-from' | 'cites';

export interface DependentNeuron {
  documentId: string;
  filename: string;
  title: string | null;
  path: string;
  link: LinkKind;
}

/**
 * Which Neurons hang off the source identity `identity` in this Brain?
 *
 * `except` is the Neuron that has just been recompiled — by definition it is up
 * to date and must not be reported as lagging behind.
 *
 * Empty identity ⇒ empty list. `null` means "we do not know which source this is"
 * (see source-identity.ts), and an unknown identity must NEVER be able to match
 * another unknown one and drag arbitrary pages along with it.
 */
export async function dependentsOf(
  trail: TrailDatabase,
  tenantId: string,
  kbId: string,
  identity: string | null,
  except: string | null = null,
): Promise<DependentNeuron[]> {
  if (!identity) return [];

  // 1. The SOURCE rows carrying this identity. There can be several: every upload
  //    of the same file is its own row, and a citation edge points at ONE of them.
  const sources = await trail.db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        eq(documents.knowledgeBaseId, kbId),
        eq(documents.kind, 'source'),
        eq(documents.sourceIdentity, identity),
      ),
    )
    .all();

  const found = new Map<string, DependentNeuron>();

  // 2. COMPILED-FROM: Neurons that carry the identity themselves.
  const own = await trail.db
    .select({
      id: documents.id,
      filename: documents.filename,
      title: documents.title,
      path: documents.path,
    })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        eq(documents.knowledgeBaseId, kbId),
        ne(documents.kind, 'source'),
        eq(documents.archived, false),
        eq(documents.sourceIdentity, identity),
      ),
    )
    .all();
  for (const n of own) {
    if (n.id === except) continue;
    found.set(n.id, { documentId: n.id, filename: n.filename, title: n.title, path: n.path, link: 'compiled-from' });
  }

  // 3. CITES: Neurons with a citation edge to one of the source rows. These are
  //    the four pages that stood wrong that night, and that no other mechanism
  //    finds.
  if (sources.length > 0) {
    const citing = await trail.db
      .select({
        id: documents.id,
        filename: documents.filename,
        title: documents.title,
        path: documents.path,
      })
      .from(documentReferences)
      .innerJoin(documents, eq(documents.id, documentReferences.wikiDocumentId))
      .where(
        and(
          eq(documentReferences.tenantId, tenantId),
          inArray(documentReferences.sourceDocumentId, sources.map((k) => k.id)),
          eq(documents.archived, false),
          ne(documents.kind, 'source'),
        ),
      )
      .all();
    for (const n of citing) {
      if (n.id === except) continue;
      // 'compiled-from' wins: it is the stronger link, and a Neuron can both be
      // compiled from the source and cite it.
      if (found.has(n.id)) continue;
      found.set(n.id, { documentId: n.id, filename: n.filename, title: n.title, path: n.path, link: 'cites' });
    }
  }

  return [...found.values()];
}

/**
 * Stamp "the source changed" on every dependent page.
 *
 * The mark is the only intervention. We do not rewrite the pages: a silent mass
 * edit of the brain is worse than a visible list of what needs looking at — and
 * rewriting `overview.md` without anyone seeing it would be exactly the failure
 * this card exists to prevent.
 */
export async function markDependents(
  trail: TrailDatabase,
  dependents: DependentNeuron[],
  at: number,
): Promise<number> {
  if (dependents.length === 0) return 0;
  await trail.db
    .update(documents)
    .set({ sourceChangedAt: at })
    .where(inArray(documents.id, dependents.map((a) => a.documentId)))
    .run();
  // READ IT BACK. A stamp that never landed looks identical to no dependents.
  const after = await trail.db
    .select({ n: sql<number>`COUNT(*)` })
    .from(documents)
    .where(
      and(
        inArray(documents.id, dependents.map((a) => a.documentId)),
        eq(documents.sourceChangedAt, at),
      ),
    )
    .get();
  return after?.n ?? 0;
}

/** Clear the mark — the page has been rewritten and so has been reviewed since
 *  the source changed. */
export async function clearSourceMark(trail: TrailDatabase, documentId: string): Promise<void> {
  await trail.db
    .update(documents)
    .set({ sourceChangedAt: null })
    .where(eq(documents.id, documentId))
    .run();
}
