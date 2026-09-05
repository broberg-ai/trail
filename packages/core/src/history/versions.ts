/**
 * F253.2 — tag et mærke på hjernen.
 *
 * Ejerens spørgsmål: «kan vi lave en komplet Neurons versioning mellem hver
 * compilation så vi altid kan rulle tilbage?» — efterfulgt af «det fylder jo
 * ikke ret meget i databasen».
 *
 * Han har ret, og grunden er bedre end pladsforbruget: KOPIERNE FINDES
 * ALLEREDE. wiki_events har gemt en fuld content_snapshot ved hver skrivning
 * siden starten. Et mærke behøver derfor ikke kopiere noget — det skal bare
 * pege på et tidspunkt i den log.
 *
 * ÉT MÆRKE PR. OMGANG, IKKE PR. SIDE. «Mellem hver kompilering» taget bogstaveligt
 * giver ~100 mærker på én eftermiddag ved en site-synkronisering. Prisen er
 * ikke problemet (nogle hundrede bytes); NAVIGATIONEN er. En liste på hundrede
 * unavngivne mærker er ikke en fortrydelses-knap, det er en anden slags rod.
 */
import type { TrailDatabase } from '@trail/db';
import { auditEventLogCoverage, repairEventLogCoverage } from './coverage.js';

export interface BrainVersion {
  id: string;
  tenantId: string;
  knowledgeBaseId: string;
  label: string;
  reason: string;
  takenAt: string;
  highWaterEventId: string | null;
  coverageIntact: boolean;
  coverageGaps: number;
  neuronCount: number;
  createdBy: string | null;
  createdAt: string;
}

export type BrainVersionReason =
  | 'manual'
  | 'auto:ingest'
  | 'auto:lint'
  | 'auto:bulk-approve'
  | 'auto:restore';

function rowToVersion(r: Record<string, unknown>): BrainVersion {
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    knowledgeBaseId: String(r.knowledge_base_id),
    label: String(r.label),
    reason: String(r.reason),
    takenAt: String(r.taken_at),
    highWaterEventId: r.high_water_event_id == null ? null : String(r.high_water_event_id),
    coverageIntact: Number(r.coverage_intact) === 1,
    coverageGaps: Number(r.coverage_gaps),
    neuronCount: Number(r.neuron_count),
    createdBy: r.created_by == null ? null : String(r.created_by),
    createdAt: String(r.created_at),
  };
}

/**
 * Tag et mærke.
 *
 * MÆRKET RYDDER OP EFTER SIG SELV. Før grænsen sættes, køres
 * dæknings-invarianten og de revner den finder lukkes. Så er hvert mærke
 * komplet i det øjeblik det laves — frem for at en gendannelse om tre måneder
 * opdager at loggen havde et hul netop dér.
 *
 * `repair: false` slår reparationen fra (til en prøve der VIL have et mærke
 * over en ufuldstændig log). Mærket bærer da coverage_intact=0, så en
 * gendannelse kan nægte i stedet for at levere en halv hjerne der ser hel ud.
 */
export async function takeBrainVersion(
  db: TrailDatabase,
  args: {
    tenantId: string;
    knowledgeBaseId: string;
    label: string;
    reason?: BrainVersionReason;
    createdBy?: string | null;
    repair?: boolean;
  },
): Promise<BrainVersion> {
  const report = await auditEventLogCoverage(db, args.tenantId, args.knowledgeBaseId);
  let gaps = report.gaps.length;
  if (gaps > 0 && args.repair !== false) {
    await repairEventLogCoverage(db, args.tenantId, report.gaps);
    const after = await auditEventLogCoverage(db, args.tenantId, args.knowledgeBaseId);
    gaps = after.gaps.length;
  }

  // Grænsen. `taken_at` sættes fra SQLite's eget ur, samme kilde som
  // wiki_events.created_at's default — ellers kan mærket lande på den forkerte
  // side af en hændelse skrevet i samme sekund af en anden proces.
  const nowRow = (await db.execute(`SELECT datetime('now') AS now`)).rows[0] as { now: string };
  const takenAt = String(nowRow.now);

  const hw = (
    await db.execute(
      `SELECT e.id FROM wiki_events e
         JOIN documents d ON d.id = e.document_id
        WHERE e.tenant_id = ? AND d.knowledge_base_id = ?
        ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1`,
      [args.tenantId, args.knowledgeBaseId],
    )
  ).rows[0] as { id: string } | undefined;

  const id = `bv_${crypto.randomUUID().slice(0, 12)}`;
  await db.execute(
    `INSERT INTO brain_versions
       (id, tenant_id, knowledge_base_id, label, reason, taken_at,
        high_water_event_id, coverage_intact, coverage_gaps, neuron_count, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      args.tenantId,
      args.knowledgeBaseId,
      args.label,
      args.reason ?? 'manual',
      takenAt,
      hw?.id ?? null,
      gaps === 0 ? 1 : 0,
      gaps,
      report.neurons,
      args.createdBy ?? null,
    ],
  );

  const row = (await db.execute(`SELECT * FROM brain_versions WHERE id = ?`, [id])).rows[0]!;
  return rowToVersion(row);
}

export async function listBrainVersions(
  db: TrailDatabase,
  tenantId: string,
  knowledgeBaseId: string,
  limit = 50,
): Promise<BrainVersion[]> {
  const { rows } = await db.execute(
    `SELECT * FROM brain_versions WHERE tenant_id = ? AND knowledge_base_id = ?
      ORDER BY taken_at DESC, rowid DESC LIMIT ?`,
    [tenantId, knowledgeBaseId, limit],
  );
  return rows.map(rowToVersion);
}

export async function getBrainVersion(
  db: TrailDatabase,
  tenantId: string,
  id: string,
): Promise<BrainVersion | null> {
  const row = (
    await db.execute(`SELECT * FROM brain_versions WHERE id = ? AND tenant_id = ?`, [id, tenantId])
  ).rows[0];
  return row ? rowToVersion(row) : null;
}

/**
 * Tag et mærke KUN hvis der ikke allerede er et nyt et.
 *
 * HVORFOR AFDÆMPNING OG IKKE «ét mærke pr. kørsel»: der findes ingen
 * kørsels-grænse i koden. Hver kilde kompileres uafhængigt (processFileAsync
 * pr. fil), så «én ingest-omgang» er ikke et objekt nogen kan pege på — det er
 * et mønster i tiden. At opfinde et kørsels-objekt for at kunne mærke det ville
 * være en større ændring end selve funktionen, og den ville stadig ikke dække
 * en bunke-godkendelse eller en lint-kørsel.
 *
 * Afdæmpningen giver det samme resultat uden det: den FØRSTE skrivning i en
 * byge tager mærket, resten genbruger det. En synkronisering af 100 artikler
 * giver ét mærke, ikke hundrede — og pauser bygen i mere end vinduet, får den
 * næste sit eget mærke, hvilket er præcis dét man vil kunne pege på.
 *
 * Vinduet er bevidst groft (15 min). Et mærke for meget koster nogle hundrede
 * bytes; et mærke for lidt koster en tilbagerulning man ikke kan tage.
 */
export async function ensureRecentBrainVersion(
  db: TrailDatabase,
  args: {
    tenantId: string;
    knowledgeBaseId: string;
    label: string;
    reason?: BrainVersionReason;
    withinMinutes?: number;
  },
): Promise<{ version: BrainVersion; created: boolean }> {
  const minutes = args.withinMinutes ?? 15;
  const recent = (
    await db.execute(
      `SELECT * FROM brain_versions
        WHERE tenant_id = ? AND knowledge_base_id = ? AND reason = ?
          AND REPLACE(SUBSTR(taken_at, 1, 19), 'T', ' ') >= datetime('now', ?)
        ORDER BY taken_at DESC, rowid DESC LIMIT 1`,
      [args.tenantId, args.knowledgeBaseId, args.reason ?? 'auto:ingest', `-${minutes} minutes`],
    )
  ).rows[0];

  if (recent) return { version: rowToVersion(recent), created: false };
  return { version: await takeBrainVersion(db, args), created: true };
}
