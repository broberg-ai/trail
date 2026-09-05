/**
 * F253.3 — vis forskellen, og rul hjernen tilbage.
 *
 * En gendannelse er et OPSLAG i hændelses-loggen, ikke en udpakning af en
 * kopi: for hver Neuron findes dens seneste hændelse til og med mærket, og
 * dens content_snapshot er svaret.
 *
 * TRE TILSTANDE, ikke én. En Neuron kan have været skrevet siden mærket
 * (sæt tilbage), være OPSTÅET siden mærket (arkivér — den fandtes ikke), eller
 * være blevet arkiveret siden mærket (gendan — den fandtes). Kun den første er
 * oplagt, og en gendannelse der kun kan den, efterlader hjernen med sider den
 * ikke havde.
 */
import type { TrailDatabase } from '@trail/db';
import { getBrainVersion, takeBrainVersion, type BrainVersion } from './versions.js';

/**
 * SAMMENLIGNING AF TIDSSTEMPLER ER DEN FARLIGE DEL, og det er samme fælde som
 * i dublet-oprydningen: basen bærer to formater side om side —
 *   "2026-09-04T19:51:23.528Z"  (drizzles $defaultFn)
 *   "2026-09-04 19:49:50"       (SQLites datetime('now'))
 * Som rene strenge sorterer "T" (0x54) EFTER mellemrum (0x20), så en ISO-række
 * vinder over en nyere plads-række. De første 19 tegn med "T" byttet til " "
 * er ens for begge former, og så er en simpel <=-sammenligning korrekt.
 */
const NORM = `REPLACE(SUBSTR(created_at, 1, 19), 'T', ' ')`;

/**
 * GRÆNSEN ER (TID, RÆKKEFØLGE) — ikke tid alene, og det er en MÅLT rettelse.
 *
 * `datetime('now')` har sekund-opløsning. Sikkerheds-mærket tages inde i
 * gendannelsen, altså i samme sekund som de hændelser gendannelsen selv
 * skriver — så en ren `created_at <= mærket`-grænse omfattede rulningens EGNE
 * hændelser. Sikkerheds-mærket så dermed tilstanden EFTER rulningen, og
 * «fortryd fortrydelsen» fandt intet at lave. Målt: to prøver røde, `applied`
 * = 0 hvor der var ændringer.
 *
 * Derfor er `high_water_event_id` ikke pynt ved siden af `taken_at`.
 * wiki_events.rowid er monotont voksende, så (normaliseret tid, rowid) er en
 * total orden — og mærket kan ligge mellem to hændelser i samme sekund.
 */
function boundary(highWaterRowid: number) {
  return {
    sql: (alias: string) =>
      `(REPLACE(SUBSTR(${alias}.created_at, 1, 19), 'T', ' ') < ?` +
      ` OR (REPLACE(SUBSTR(${alias}.created_at, 1, 19), 'T', ' ') = ? AND ${alias}.rowid <= ?))`,
    args: (takenAt: string) => [takenAt, takenAt, highWaterRowid],
  };
}

/** Rækkenummeret for mærkets højvands-hændelse. 0 = mærket ligger før alt. */
async function highWaterRowid(db: TrailDatabase, version: BrainVersion): Promise<number> {
  if (!version.highWaterEventId) return 0;
  const r = (await db.execute(`SELECT rowid AS rid FROM wiki_events WHERE id = ?`, [version.highWaterEventId]))
    .rows[0] as { rid: number } | undefined;
  return r ? Number(r.rid) : 0;
}

export interface RestoreChange {
  documentId: string;
  path: string | null;
  filename: string | null;
  /** 'revert' = sæt indhold tilbage · 'archive' = fandtes ikke · 'unarchive' = fandtes */
  action: 'revert' | 'archive' | 'unarchive';
  currentVersion: number;
  /** Kun for 'revert': længden af det indhold der ville blive gendannet. */
  restoredLength?: number;
}

export interface RestoreDiff {
  version: BrainVersion;
  changes: RestoreChange[];
  revert: number;
  archive: number;
  unarchive: number;
  /** Neuroner der IKKE ændrer sig. De røres ikke og får ingen hændelse. */
  unchanged: number;
}

/**
 * Beregn hvad en gendannelse ville gøre. RØRER INTET.
 *
 * En tilbagerulning man ikke kan se konsekvensen af, tør ingen bruge — og så
 * er funktionen værdiløs præcis den dag den skal bruges.
 */
export async function diffBrainVersion(
  db: TrailDatabase,
  tenantId: string,
  versionId: string,
): Promise<RestoreDiff> {
  const version = await getBrainVersion(db, tenantId, versionId);
  if (!version) throw new Error(`Ukendt hjerne-version: ${versionId}`);
  const hwRowid = await highWaterRowid(db, version);
  const B = boundary(hwRowid);

  // Alle wiki-Neuroner i basen — også de arkiverede, for en af dem kan have
  // været aktiv ved mærket.
  const { rows } = await db.execute(
    `SELECT
       d.id                        AS documentId,
       d.path                      AS path,
       d.filename                  AS filename,
       d.archived                  AS archived,
       COALESCE(d.version, 1)      AS version,
       d.content                   AS content,
       (SELECT e.content_snapshot FROM wiki_events e
         WHERE e.document_id = d.id AND ${B.sql('e')}
         ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1)  AS snapshotAtMark,
       (SELECT e.event_type FROM wiki_events e
         WHERE e.document_id = d.id AND ${B.sql('e')}
         ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1)  AS typeAtMark,
       (SELECT COUNT(*) FROM wiki_events e
         WHERE e.document_id = d.id AND ${B.sql('e')}) AS eventsAtMark
     FROM documents d
     WHERE d.tenant_id = ? AND d.knowledge_base_id = ? AND d.kind = 'wiki'`,
    [...B.args(version.takenAt), ...B.args(version.takenAt), ...B.args(version.takenAt),
     tenantId, version.knowledgeBaseId],
  );

  const changes: RestoreChange[] = [];
  let unchanged = 0;

  for (const raw of rows) {
    const r = raw as unknown as {
      documentId: string; path: string | null; filename: string | null;
      archived: number; version: number; content: string | null;
      snapshotAtMark: string | null; typeAtMark: string | null; eventsAtMark: number;
    };
    const isArchived = Number(r.archived) === 1;
    const existedAtMark = Number(r.eventsAtMark) > 0 && r.typeAtMark !== 'archived';

    if (!existedAtMark) {
      // Fandtes ikke (eller var arkiveret) ved mærket.
      if (!isArchived) {
        changes.push({ documentId: r.documentId, path: r.path, filename: r.filename,
          action: 'archive', currentVersion: Number(r.version) });
      } else unchanged += 1;
      continue;
    }

    if (isArchived) {
      changes.push({ documentId: r.documentId, path: r.path, filename: r.filename,
        action: 'unarchive', currentVersion: Number(r.version),
        restoredLength: (r.snapshotAtMark ?? '').length });
      continue;
    }

    // Aktiv i begge ender: kun sæt tilbage hvis teksten FAKTISK er en anden.
    // Ellers støjer hver rulning hele hjernen til med hændelser der intet siger.
    if ((r.content ?? '') !== (r.snapshotAtMark ?? '')) {
      changes.push({ documentId: r.documentId, path: r.path, filename: r.filename,
        action: 'revert', currentVersion: Number(r.version),
        restoredLength: (r.snapshotAtMark ?? '').length });
    } else unchanged += 1;
  }

  return {
    version,
    changes,
    revert: changes.filter((c) => c.action === 'revert').length,
    archive: changes.filter((c) => c.action === 'archive').length,
    unarchive: changes.filter((c) => c.action === 'unarchive').length,
    unchanged,
  };
}

export interface RestoreResult {
  versionId: string;
  applied: number;
  revert: number;
  archive: number;
  unarchive: number;
  /** Mærket der blev taget FØR rulningen, så den selv kan fortrydes. */
  safetyVersionId: string;
  chunksRebuilt: number;
  /** true når tekst blev ændret UDEN at søgeindekset blev bygget om. */
  searchIndexStale: boolean;
}

/**
 * Udfør gendannelsen.
 *
 * TO EGENSKABER DER IKKE ER TIL FORHANDLING:
 *
 * 1. DER TAGES ET MÆRKE FØRST. En fortrydelse man ikke kan fortryde er en
 *    envejsdør forklædt som en tovejsdør — og hele argumentet for at
 *    gendannelse er sikkert, er at den kan rulles tilbage igen.
 * 2. HVER RØRT SIDE FÅR SIN EGEN HÆNDELSE, med den gendannede tekst som kopi.
 *    En destruktiv overskrivning uden spor ville ødelægge netop den log den
 *    beskytter, og den næste dæknings-måling ville melde revner der ikke var
 *    der før rulningen.
 *
 * Et mærke med coverage_intact=0 AFVISES. En delvis rulning der ser vellykket
 * ud er værre end ingen rulning: den efterlader en hjerne der er næsten
 * rigtig, og ingen kan se hvilke sider der er forkerte.
 */
export async function restoreBrainVersion(
  db: TrailDatabase,
  tenantId: string,
  versionId: string,
  opts: {
    actorId?: string | null;
    /**
     * Byg søgeindekset om for en side hvis tekst blev ændret.
     *
     * SØGNINGEN ER EN SELVSTÆNDIG KOPI AF INDHOLDET (document_chunks + FTS5).
     * Rulles teksten tilbage uden at indekset følger med, svarer basen korrekt
     * og SØGER forkert — og en søgning der finder tekst der ikke længere står
     * nogen steder, er værre end en der ikke finder noget.
     *
     * Ligger som tilbagekald frem for et direkte kald, fordi chunker'en bor i
     * apps/server og kernen ikke må importere opad. Udelades den, springes
     * genopbygningen over — og DET SIGES i svarets `chunksRebuilt`, så en
     * kalder ikke kan tro indekset er friskt uden at have bedt om det.
     */
    rebuildChunks?: (documentId: string, content: string) => Promise<void>;
  } = {},
): Promise<RestoreResult> {
  const diff = await diffBrainVersion(db, tenantId, versionId);

  if (!diff.version.coverageIntact) {
    throw new Error(
      `Mærket "${diff.version.label}" blev taget over en hændelses-log med ` +
        `${diff.version.coverageGaps} revne(r). En gendannelse kunne ikke blive fuldstændig, ` +
        `og en delvis rulning der ser vellykket ud er værre end ingen. Luk revnerne først ` +
        `(POST /api/v1/history/coverage/repair) og tag et nyt mærke.`,
    );
  }

  const B2 = boundary(await highWaterRowid(db, diff.version));

  const safety = await takeBrainVersion(db, {
    tenantId,
    knowledgeBaseId: diff.version.knowledgeBaseId,
    label: `Før tilbagerulning til "${diff.version.label}"`,
    reason: 'auto:restore',
    createdBy: opts.actorId ?? null,
  });

  for (const ch of diff.changes) {
    const doc = (
      await db.execute(`SELECT COALESCE(version, 1) AS version FROM documents WHERE id = ?`, [ch.documentId])
    ).rows[0] as { version: number };
    const prevVersion = Number(doc.version);
    const nextVersion = prevVersion + 1;

    const prevEvent = (
      await db.execute(
        `SELECT id FROM wiki_events WHERE document_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        [ch.documentId],
      )
    ).rows[0] as { id: string } | undefined;

    let snapshot = '';
    if (ch.action === 'archive') {
      await db.execute(
        `UPDATE documents SET archived = 1, status = 'archived', version = ?, updated_at = ? WHERE id = ?`,
        [nextVersion, new Date().toISOString(), ch.documentId],
      );
      snapshot =
        ((await db.execute(`SELECT content FROM documents WHERE id = ?`, [ch.documentId])).rows[0] as
          { content: string | null }).content ?? '';
    } else {
      // revert OG unarchive henter begge teksten fra mærket.
      const snap = (
        await db.execute(
          `SELECT e.content_snapshot AS s FROM wiki_events e
            WHERE e.document_id = ? AND ${B2.sql('e')}
            ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1`,
          [ch.documentId, ...B2.args(diff.version.takenAt)],
        )
      ).rows[0] as { s: string | null } | undefined;
      snapshot = snap?.s ?? '';
      await db.execute(
        `UPDATE documents SET content = ?, file_size = ?, archived = 0, status = 'ready',
                              version = ?, updated_at = ? WHERE id = ?`,
        [snapshot, snapshot.length, nextVersion, new Date().toISOString(), ch.documentId],
      );
    }

    await db.execute(
      `INSERT INTO wiki_events
         (id, tenant_id, document_id, event_type, actor_id, actor_kind,
          previous_version, new_version, summary, metadata, prev_event_id,
          source_candidate_id, content_snapshot)
       VALUES (?, ?, ?, ?, ?, 'system', ?, ?, ?, ?, ?, NULL, ?)`,
      [
        `evt_${crypto.randomUUID().slice(0, 12)}`,
        tenantId,
        ch.documentId,
        ch.action === 'archive' ? 'archived' : ch.action === 'unarchive' ? 'restored' : 'edited',
        opts.actorId ?? null,
        prevVersion,
        nextVersion,
        `Tilbagerulning til "${diff.version.label}" (${diff.version.takenAt})`,
        JSON.stringify({ restore: versionId, action: ch.action, safetyVersion: safety.id }),
        prevEvent?.id ?? null,
        snapshot,
      ],
    );
  }

  let chunksRebuilt = 0;
  if (opts.rebuildChunks) {
    for (const ch of diff.changes) {
      if (ch.action === 'archive') {
        // En arkiveret side må ikke kunne findes: tom tekst rydder dens chunks.
        await opts.rebuildChunks(ch.documentId, '');
        chunksRebuilt += 1;
        continue;
      }
      const row = (await db.execute(`SELECT content FROM documents WHERE id = ?`, [ch.documentId]))
        .rows[0] as { content: string | null } | undefined;
      await opts.rebuildChunks(ch.documentId, row?.content ?? '');
      chunksRebuilt += 1;
    }
  }

  return {
    versionId,
    applied: diff.changes.length,
    revert: diff.revert,
    archive: diff.archive,
    unarchive: diff.unarchive,
    safetyVersionId: safety.id,
    chunksRebuilt,
    searchIndexStale: !opts.rebuildChunks && diff.changes.length > 0,
  };
}
