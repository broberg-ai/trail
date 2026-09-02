/**
 * F217 — how big is a Trail?
 *
 * Owner, 2026-09-02: "Du skal sætte en MB størrelse på hver trail så det er til
 * at se hvor meget den fylder, inkl. alt i dens DB og kilderne og billederne."
 *
 * THE DESIGN IS DECIDED BY ONE MEASUREMENT, not by the feature request.
 * Sampled on production the same day, in broberg-ai's DB:
 *
 *     document_images rows claim   501.3 MB
 *     bytes actually on disk         0.0 MB
 *     rows whose file exists         0 of 400
 *
 * Their `storage_path` begins `t-christian/…` — a tenant prefix that no longer
 * exists under /data. Orphans, most likely from the 2026-05-14 `rm -rf`
 * incident. A plain SUM(size_bytes) would tell the owner a Trail holds 604 MB
 * of images that are gone, and he would plan storage — or delete something —
 * against a phantom.
 *
 * So this never reports ONE number. It reports what the database CLAIMS and
 * what is PRESENT, and the caller can see when they disagree. Merging them is
 * the failure this repo met five times in the same week; here it would be
 * merging a true number with a false one.
 *
 * `du` on the tenant folder is not an alternative: every upload lives under
 * /data/sanne-andersen/uploads/ regardless of tenant, so measuring a tenant
 * directory does not measure that tenant.
 */
import { sql } from 'drizzle-orm';
import type { TrailDatabase } from '@trail/db';

export interface KbSize {
  knowledgeBaseId: string;
  /** Bytes of uploaded source files, from documents.file_size. */
  sourceBytes: number;
  sourceCount: number;
  /** Bytes of extracted images AS THE DATABASE RECORDS THEM. */
  imageBytesClaimed: number;
  /** Of those, the bytes whose file was found on disk. */
  imageBytesPresent: number;
  imageCount: number;
  /** Image rows whose file is missing — the phantom megabytes. */
  imageMissingCount: number;
  /** Characters of compiled Neuron text. Small per page, large in aggregate. */
  knowledgeBytes: number;
  knowledgeCount: number;
  /** sourceBytes + imageBytesPresent + knowledgeBytes — what is really there. */
  totalBytes: number;
  /** totalBytes + the missing image bytes — what a naive sum would have said. */
  totalBytesClaimed: number;
}

/** Does this storage path resolve to a real file? Injected so tests need no disk. */
export type FileProbe = (storagePath: string) => number | null;

interface RawRow {
  kb: string;
  srcBytes: number; srcCount: number;
  imgCount: number; imgBytes: number;
  knowBytes: number; knowCount: number;
}

/**
 * Size for every KB in a tenant.
 *
 * `probe` returns the file's size in bytes, or null when it is not there. It is
 * called ONLY for image rows — sources are counted from `file_size`, which is
 * populated on every row (measured: 161 of 161 sources, zero at the 0 default),
 * and Neuron text lives in the database itself. So the number of filesystem
 * calls is bounded by the image count, not by the size of the volume.
 */
export async function kbSizes(
  trail: TrailDatabase,
  tenantId: string,
  probe: FileProbe,
): Promise<KbSize[]> {
  const agg = (await trail.execute(
    `SELECT kb.id AS kb,
            COALESCE((SELECT SUM(d.file_size) FROM documents d
                       WHERE d.knowledge_base_id = kb.id AND d.kind = 'source'
                         AND d.archived = 0), 0) AS srcBytes,
            (SELECT COUNT(*) FROM documents d
              WHERE d.knowledge_base_id = kb.id AND d.kind = 'source'
                AND d.archived = 0) AS srcCount,
            COALESCE((SELECT SUM(LENGTH(d.content)) FROM documents d
                       WHERE d.knowledge_base_id = kb.id AND d.kind <> 'source'
                         AND d.archived = 0), 0) AS knowBytes,
            (SELECT COUNT(*) FROM documents d
              WHERE d.knowledge_base_id = kb.id AND d.kind <> 'source'
                AND d.archived = 0) AS knowCount,
            COALESCE((SELECT SUM(i.size_bytes) FROM document_images i
                       WHERE i.knowledge_base_id = kb.id), 0) AS imgBytes,
            (SELECT COUNT(*) FROM document_images i
              WHERE i.knowledge_base_id = kb.id) AS imgCount
       FROM knowledge_bases kb
      WHERE kb.tenant_id = ?`,
    [tenantId],
  )) as unknown as { rows: RawRow[] };

  // One pass over image rows, grouped by KB. Only rows that exist are probed,
  // and each row is probed once.
  const present = new Map<string, number>();
  const missing = new Map<string, number>();
  const imgs = (await trail.execute(
    `SELECT knowledge_base_id AS kb, storage_path AS p, size_bytes AS b
       FROM document_images
      WHERE tenant_id = ?`,
    [tenantId],
  )) as unknown as { rows: Array<{ kb: string; p: string; b: number }> };

  for (const row of imgs.rows) {
    const onDisk = probe(row.p);
    if (onDisk === null) {
      missing.set(row.kb, (missing.get(row.kb) ?? 0) + 1);
    } else {
      // The FILE's size, not the row's claim — they can disagree, and the file
      // is the one the volume actually pays for.
      present.set(row.kb, (present.get(row.kb) ?? 0) + onDisk);
    }
  }

  return agg.rows.map((r) => {
    const imageBytesPresent = present.get(r.kb) ?? 0;
    const totalBytes = Number(r.srcBytes) + imageBytesPresent + Number(r.knowBytes);
    return {
      knowledgeBaseId: r.kb,
      sourceBytes: Number(r.srcBytes),
      sourceCount: Number(r.srcCount),
      imageBytesClaimed: Number(r.imgBytes),
      imageBytesPresent,
      imageCount: Number(r.imgCount),
      imageMissingCount: missing.get(r.kb) ?? 0,
      knowledgeBytes: Number(r.knowBytes),
      knowledgeCount: Number(r.knowCount),
      totalBytes,
      totalBytesClaimed: Number(r.srcBytes) + Number(r.imgBytes) + Number(r.knowBytes),
    };
  });
}

/** MB with one decimal — the unit the owner asked for. */
export function toMB(bytes: number): number {
  return Math.round((bytes / 1_048_576) * 10) / 10;
}
