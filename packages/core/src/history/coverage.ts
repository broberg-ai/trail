/**
 * F253.1 — er hændelses-loggen komplet nok til at rulle hjernen tilbage?
 *
 * Trail har gemt en FULD kopi af hver Neuron ved hver skrivning siden starten
 * (`wiki_events.content_snapshot`). Målt i broberg-ai 6. september 2026:
 * 8.393 hændelser, 43 MB, og NUL uden kopi. Tidsrejsen er altså allerede
 * betalt — det der manglede var et håndtag.
 *
 * MEN ET HÅNDTAG ER KUN SÅ GODT SOM LOGGEN UNDER DET, og loggen havde en
 * revne. Samme måling:
 *
 *     aktive Neuroner                              6.741
 *     hvis nyeste kopi == nuværende indhold        6.739
 *     hvis den IKKE gør                                2   ← revnen
 *
 * De to (`nada-protokol.md`, `behandlingseksempler.md`) blev begge rettet
 * 24. april kl. 18:30:15 — to millisekunder fra hinanden, altså af et script
 * der skrev direkte i databasen udenom appen. Samme længde før og efter, så
 * det var en tekst-erstatning, ikke en omskrivning.
 *
 * DET ER DEN FARLIGSTE SLAGS FEJL I EN TILBAGERULNING: den fejler i den GRØNNE
 * retning. Restaureringen ville melde succes og give en hjerne der er NÆSTEN
 * rigtig — og ingen ville kunne se hvilke to sider der var forkerte.
 *
 * HVORFOR DET HER ER EN RUNTIME-INVARIANT OG IKKE EN KILDETEKST-VAGT.
 * Den oplagte spærre er at scanne koden for skrivninger der ikke logger. Den
 * er værdiløs her, af to grunde vi har målt før: en regex over kildetekst
 * tæller en kommentar som adfærd, og — afgørende — de to sider der FAKTISK
 * skred blev ikke skrevet af appen overhovedet. De blev skrevet af et script.
 * En vagt der kun kan se `apps/server/src` ville have været grøn hele vejen
 * gennem præcis den hændelse den skulle fange.
 *
 * Invarianten herunder kigger på DATABASEN. Den er ligeglad med hvem der skrev
 * og hvordan, den kan ikke narres af formatering, og den fanger også en
 * skrivevej der ikke findes endnu.
 *
 * TO INVARIANTER, IKKE ÉN — og den anden er den stærke:
 *
 *   1. `content == nyeste snapshot`. Fanger den SENESTE skrivning der sprang
 *      loggen over. Svag alene: skrives en side udenom loggen og bagefter
 *      normalt, er sporet visket ud.
 *   2. `version == antal hændelser`. Hver skrivning bumper version OG lægger
 *      en hændelse. Er der flere versioner end hændelser, er der sket en
 *      skrivning uden log — også en der senere blev overskrevet. Målt: 3.
 *
 * Nummer 1 alene er et underkantsskøn. Det siges her, så ingen læser et
 * grønt svar på nummer 1 som "loggen er komplet".
 */
import type { TrailDatabase } from '@trail/db';

/** Én Neuron hvor loggen ikke stemmer, med grunden. */
export interface CoverageGap {
  documentId: string;
  path: string | null;
  filename: string | null;
  /** Dokumentets version-tæller. */
  version: number;
  /** Hvor mange hændelser der faktisk findes for det. */
  eventCount: number;
  /** Nuværende indhold afviger fra nyeste snapshot. */
  contentDrift: boolean;
  /** version > antal hændelser — mindst én skrivning blev aldrig logget. */
  versionDrift: boolean;
}

export interface CoverageReport {
  /** Aktive wiki-Neuroner undersøgt. */
  neurons: number;
  /** Neuroner UDEN nogen hændelse overhovedet — kan slet ikke tidsrejses. */
  withoutHistory: number;
  gaps: CoverageGap[];
  /** true når begge invarianter holder for alle. */
  intact: boolean;
}

/**
 * Mål begge invarianter for én tenants aktive Neuroner.
 *
 * Kun `kind='wiki'` og `archived=0`: de rå kilde-filer har med vilje ingen
 * hændelses-log (334 af dem i broberg-ai). De er råvarer man kan uploade igen,
 * ikke hukommelse — at tælle dem med ville rapportere et hul der ikke findes.
 */
export async function auditEventLogCoverage(
  db: TrailDatabase,
  tenantId: string,
  knowledgeBaseId?: string,
): Promise<CoverageReport> {
  const args: Array<string> = [tenantId];
  let kbFilter = '';
  if (knowledgeBaseId) {
    kbFilter = 'AND d.knowledge_base_id = ?';
    args.push(knowledgeBaseId);
  }

  const { rows } = await db.execute(
    `SELECT
       d.id                      AS documentId,
       d.path                    AS path,
       d.filename                AS filename,
       COALESCE(d.version, 1)    AS version,
       (SELECT COUNT(*) FROM wiki_events e WHERE e.document_id = d.id) AS eventCount,
       CASE WHEN d.content IS NOT (
         SELECT x.content_snapshot FROM wiki_events x
          WHERE x.document_id = d.id
          ORDER BY x.created_at DESC, x.rowid DESC LIMIT 1
       ) THEN 1 ELSE 0 END       AS contentDrift
     FROM documents d
     WHERE d.tenant_id = ?
       AND d.kind = 'wiki'
       AND d.archived = 0
       ${kbFilter}`,
    args,
  );

  const gaps: CoverageGap[] = [];
  let withoutHistory = 0;

  for (const raw of rows) {
    const r = raw as unknown as {
      documentId: string; path: string | null; filename: string | null;
      version: number; eventCount: number; contentDrift: number;
    };
    if (Number(r.eventCount) === 0) withoutHistory += 1;
    // `version > eventCount` — IKKE `!==`. Flere hændelser end versioner er
    // ikke et hul: en omdøbning eller en arkivering lægger en hændelse uden at
    // bumpe version. Kun den anden vej rundt betyder en tabt skrivning.
    const versionDrift = Number(r.version) > Number(r.eventCount);
    const contentDrift = Number(r.contentDrift) === 1;
    if (versionDrift || contentDrift) {
      gaps.push({
        documentId: r.documentId,
        path: r.path,
        filename: r.filename,
        version: Number(r.version),
        eventCount: Number(r.eventCount),
        contentDrift,
        versionDrift,
      });
    }
  }

  return { neurons: rows.length, withoutHistory, gaps, intact: gaps.length === 0 };
}

/**
 * Luk revnen: læg en indhentnings-hændelse for hver Neuron der er skredet, så
 * dens nuværende indhold ER i loggen og et fremtidigt mærke kan pege på den.
 *
 * DEN OPFINDER IKKE EN FORTID. Vi kan ikke vide hvad de to sider indeholdt
 * mellem den sidste ægte hændelse og scriptets skrivning — den mellemtilstand
 * findes ingen steder. Hændelsen der lægges bærer derfor NUVÆRENDE indhold og
 * siger i sin summary hvad den er: en indhentning, ikke en redigering nogen
 * foretog. En log der lyver om sin egen fortid er værre end en med et hul, for
 * hullet kan man se.
 *
 * `actorKind='system'` af samme grund: der var intet menneske og ingen model.
 */
export async function repairEventLogCoverage(
  db: TrailDatabase,
  tenantId: string,
  gaps: CoverageGap[],
): Promise<number> {
  let repaired = 0;
  for (const gap of gaps) {
    const doc = (
      await db.execute(`SELECT content, COALESCE(version, 1) AS version FROM documents WHERE id = ?`, [
        gap.documentId,
      ])
    ).rows[0] as { content: string | null; version: number } | undefined;
    if (!doc) continue;

    const prev = (
      await db.execute(
        `SELECT id FROM wiki_events WHERE document_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        [gap.documentId],
      )
    ).rows[0] as { id: string } | undefined;

    await db.execute(
      `INSERT INTO wiki_events
         (id, tenant_id, document_id, event_type, actor_id, actor_kind,
          previous_version, new_version, summary, metadata, prev_event_id,
          source_candidate_id, content_snapshot)
       VALUES (?, ?, ?, 'edited', NULL, 'system', ?, ?, ?, ?, ?, NULL, ?)`,
      [
        `evt_${crypto.randomUUID().slice(0, 12)}`,
        tenantId,
        gap.documentId,
        gap.eventCount > 0 ? Number(doc.version) - 1 : null,
        Number(doc.version),
        'Indhentning: indholdet blev skrevet udenom hændelses-loggen. Denne hændelse bærer det indhold der FAKTISK står nu, ikke en rekonstruktion af mellemtilstanden.',
        JSON.stringify({ repair: 'F253.1', contentDrift: gap.contentDrift, versionDrift: gap.versionDrift }),
        prev?.id ?? null,
        doc.content ?? '',
      ],
    );
    repaired += 1;
  }
  return repaired;
}
