/**
 * F275.5 — afløsningen skal FORPLANTE sig.
 *
 * ## Den målte sag
 *
 * Natten mellem 15. og 16. september sagde FEM sider «bygges nu» after kilden
 * sagde «lanceret»: `overview.md`, `glossary.md`, `flagskib.md`, source-Neuronen
 * og entitets-Neuronen. **Kun ÉN af dem bærer kildens URL som sin egen
 * identitet.** De fire andre citerer kilden uden at være kompileret AF den.
 *
 * Rammer afløsningen kun source-Neuronen, bliver køen ren mens hjernen stadig
 * svarer på gårsdagens tekst — **og det er værre end i dag, fordi det ikke
 * længere ligner et problem.**
 *
 * ## Koblingen SLÅS OP, den gættes ikke
 *
 * To veje ind, begge id-baserede:
 *
 *   kompileret-fra   `documents.source_identity` på Neuronen (F275.1/F275.3)
 *   citerer          `document_references.source_document_id` → source-rækken
 *
 * Ingen tekstsammenligning. En Neuron der tilfældigvis nævner de samme ord uden
 * at stamme fra kilden skal IKKE røres — ellers rydder en rettelse på én side op
 * i sider der intet har med den at gøre, og det ville være en større skade end
 * den featuren fjerner.
 *
 * ## Vi skriver ikke om. Vi gør det SYNLIGT.
 *
 * Kortets egen betingelse: *«Ingen automatisk omskrivning af en Neuron uden at
 * det kan ses. En stille masse-rettelse af hjernen er værre end en synlig liste
 * over hvad der skal ses på.»* Derfor stempler modulet et tidspunkt på hver
 * afhængig side og leverer listen tilbage; kaldestedet melder den i køen.
 */
import { documents, documentReferences, type TrailDatabase } from '@trail/db';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';

/** Hvordan en Neuron hænger på kilden. */
export type LinkKind = 'kompileret-fra' | 'citerer';

export interface DependentNeuron {
  documentId: string;
  filename: string;
  title: string | null;
  path: string;
  kobling: LinkKind;
}

/**
 * Hvilke Neuroner hænger på source-identityen `identitet` i denne Brain?
 *
 * `undtagen` er den Neuron der netop ER blevet kompileret om — den er per
 * definition ajour og skal ikke meldes som bagefter.
 *
 * Tom identitet ⇒ tom liste. `null` betyder «vi ved ikke hvilken source det er»
 * (se source-identity.ts), og en ukendt identitet må ALDRIG kunne matche en
 * anden ukendt og trække tilfældige sider med.
 */
export async function dependentsOf(
  trail: TrailDatabase,
  tenantId: string,
  kbId: string,
  identitet: string | null,
  undtagen: string | null = null,
): Promise<DependentNeuron[]> {
  if (!identitet) return [];

  // 1. KILDE-rækkerne med denne identitet. Der kan være flere: hver upload af
  //    samme fil er sin egen række, og en citat-kant peger på ÉN af dem.
  const kilder = await trail.db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        eq(documents.knowledgeBaseId, kbId),
        eq(documents.kind, 'source'),
        eq(documents.sourceIdentity, identitet),
      ),
    )
    .all();

  const fundet = new Map<string, DependentNeuron>();

  // 2. KOMPILERET-FRA: Neuroner der selv bærer identiteten.
  const egne = await trail.db
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
        eq(documents.sourceIdentity, identitet),
      ),
    )
    .all();
  for (const n of egne) {
    if (n.id === undtagen) continue;
    fundet.set(n.id, { documentId: n.id, filename: n.filename, title: n.title, path: n.path, kobling: 'kompileret-fra' });
  }

  // 3. CITERER: Neuroner med en citat-kant til en af source-rækkerne. Det er de
  //    fire sider der stod forkert i nat, og som ingen anden mekanisme finder.
  if (kilder.length > 0) {
    const citerende = await trail.db
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
          inArray(documentReferences.sourceDocumentId, kilder.map((k) => k.id)),
          eq(documents.archived, false),
          ne(documents.kind, 'source'),
        ),
      )
      .all();
    for (const n of citerende) {
      if (n.id === undtagen) continue;
      // 'kompileret-fra' vinder: den er den stærkere kobling, og en Neuron kan
      // både være kompileret af kilden og citere den.
      if (fundet.has(n.id)) continue;
      fundet.set(n.id, { documentId: n.id, filename: n.filename, title: n.title, path: n.path, kobling: 'citerer' });
    }
  }

  return [...fundet.values()];
}

/**
 * Stempl «kilden er ændret» på hver afhængig side.
 *
 * Mærket er det eneste indgreb. Vi skriver ikke siderne om: en stille
 * masse-rettelse af hjernen er værre end en synlig liste over hvad der skal ses
 * på — og en omskrivning af `overview.md` uden at nogen så det ville være
 * præcis den fejl dette kort findes for.
 */
export async function markDependents(
  trail: TrailDatabase,
  afhaengige: DependentNeuron[],
  tidspunkt: number,
): Promise<number> {
  if (afhaengige.length === 0) return 0;
  await trail.db
    .update(documents)
    .set({ sourceChangedAt: tidspunkt })
    .where(inArray(documents.id, afhaengige.map((a) => a.documentId)))
    .run();
  // LÆS TILBAGE. Et stempel der ikke landede ser ud som ingen afhængige.
  const after = await trail.db
    .select({ n: sql<number>`COUNT(*)` })
    .from(documents)
    .where(
      and(
        inArray(documents.id, afhaengige.map((a) => a.documentId)),
        eq(documents.sourceChangedAt, tidspunkt),
      ),
    )
    .get();
  return after?.n ?? 0;
}

/** Ryd mærket — siden er skrevet om og er dermed set after kilden ændrede sig. */
export async function clearSourceMark(trail: TrailDatabase, documentId: string): Promise<void> {
  await trail.db
    .update(documents)
    .set({ sourceChangedAt: null })
    .where(eq(documents.id, documentId))
    .run();
}
