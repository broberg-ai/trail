/**
 * F263.1 — jobkøen for lokal kompilering.
 *
 * INDTIL NU VAR DET ET FLAG, IKKE EN KØ. `awaiting_local_compile` sagde at en
 * kilde ventede, og en arbejder ryddede flaget når den var færdig. Det har
 * virket fejlfrit — fordi der har været præcis ÉN arbejder (en åben cc-session
 * der fik en intercom fra buddy hvert 120. sekund). Det er en egenskab ved
 * antallet, ikke ved designet:
 *
 *   · to arbejdere ville tage SAMME kilde og kompilere den to gange
 *   · skyen kunne ikke svare på «er der nogen hjemme?» — der er ingen identitet
 *   · en arbejder der dør midt i et job efterlod flaget stående FOR EVIGT
 *
 * Det sidste er ikke teoretisk: fem testfiler fra 4. juni 2026 har ligget
 * parkeret i tre måneder, fordi ingenting nogensinde tager et job tilbage.
 *
 * LEASEN ER EN TID, IKKE EN LÅS. En lås skal frigives af den der tog den —
 * og en arbejder der er væk, frigiver ingenting. En frist behøver ingen at
 * være i live for at udløbe. Derfor er «ledigt» defineret som *lease_until er
 * tom ELLER ligger i fortiden*, og en død arbejder koster højst én lease-længde.
 */
import type { TrailDatabase } from '@trail/db';

/**
 * Hvor længe en reservation holder uden hjerteslag.
 *
 * ÉN KILDE TIL TALLET — ruterne og prøverne læser denne konstant. Fem minutter
 * er valgt så den er længere end en typisk kompilering (målt 10–90 sekunder)
 * og kort nok til at en død arbejder ikke spærrer en kilde en hel aften.
 */
export const COMPILE_LEASE_MS = 5 * 60_000;

export interface CompileJob {
  id: string;
  filename: string;
  fileType: string;
  knowledgeBaseId: string;
  leaseUntil: string;
}

/** Rå række fra claim-forespørgslen. */
interface ClaimRow {
  id: unknown;
  filename: unknown;
  file_type: unknown;
  knowledge_base_id: unknown;
}

/**
 * Tag op til `limit` ledige jobs, ATOMISK.
 *
 * Hele udvælgelsen og reservationen sker i ÉN sætning. To arbejdere der kalder
 * samtidig kan derfor ikke få samme job: SQLite serialiserer skrivninger, så
 * den anden sætnings underforespørgsel kører FØRST når den første har committet
 * — og ser da rækkerne som reserverede. Deles det i et SELECT efterfulgt af et
 * UPDATE, findes der et vindue imellem dem hvor begge har set samme række, og
 * det vindue er hele fejlen kortet handler om.
 */
export async function claimCompileJobs(
  db: TrailDatabase,
  tenantId: string,
  args: { worker: string; limit?: number; leaseMs?: number; now?: Date },
): Promise<CompileJob[]> {
  const limit = Math.min(Math.max(args.limit ?? 1, 1), 25);
  const nu = args.now ?? new Date();
  const leaseUntil = new Date(nu.getTime() + (args.leaseMs ?? COMPILE_LEASE_MS)).toISOString();

  const res = await db.execute(
    `UPDATE documents
        SET compile_claimed_by = ?, compile_lease_until = ?
      WHERE id IN (
        SELECT id FROM documents
         WHERE tenant_id = ?
           AND awaiting_local_compile = 1
           AND kind = 'source'
           AND archived = 0
           AND (compile_lease_until IS NULL OR compile_lease_until < ?)
         ORDER BY created_at
         LIMIT ?
      )
      RETURNING id, filename, file_type, knowledge_base_id`,
    [args.worker, leaseUntil, tenantId, nu.toISOString(), limit],
  );

  return (res.rows as unknown as ClaimRow[]).map((r) => ({
    id: String(r.id),
    filename: String(r.filename ?? ''),
    fileType: String(r.file_type ?? ''),
    knowledgeBaseId: String(r.knowledge_base_id ?? ''),
    leaseUntil,
  }));
}

/**
 * Forlæng reservationen på et job man selv har.
 *
 * KRÆVER AT MAN ER EJEREN. Uden `compile_claimed_by = ?` kunne en arbejder
 * holde et job i live som en anden havde overtaget efter en udløbet lease —
 * og så ville to arbejdere være i gang med samme kilde med systemets
 * velsignelse. Returnerer false når jobbet ikke (længere) er ens eget, så
 * kalderen kan opdage overtagelsen frem for at arbejde videre i blinde.
 */
export async function heartbeatCompileJob(
  db: TrailDatabase,
  tenantId: string,
  args: { docId: string; worker: string; leaseMs?: number; now?: Date },
): Promise<{ ok: boolean; leaseUntil: string }> {
  const nu = args.now ?? new Date();
  const leaseUntil = new Date(nu.getTime() + (args.leaseMs ?? COMPILE_LEASE_MS)).toISOString();
  const res = await db.execute(
    `UPDATE documents
        SET compile_lease_until = ?
      WHERE id = ? AND tenant_id = ? AND compile_claimed_by = ?
        AND awaiting_local_compile = 1`,
    [leaseUntil, args.docId, tenantId, args.worker],
  );
  return { ok: (res.rowsAffected ?? 0) > 0, leaseUntil };
}

/**
 * Slip reservationen. Kaldes når jobbet er færdigt eller opgivet.
 *
 * Rydder KUN lease-felterne — flaget selv ejes af `/local-compiled`, som er
 * den vej der også skriver resultatet. To steder der rydder samme flag er
 * hvordan man får et job der ser færdigt ud uden at være det.
 */
export async function releaseCompileJob(
  db: TrailDatabase,
  tenantId: string,
  docId: string,
): Promise<void> {
  await db.execute(
    `UPDATE documents SET compile_claimed_by = NULL, compile_lease_until = NULL
      WHERE id = ? AND tenant_id = ?`,
    [docId, tenantId],
  );
}

/** Hvad køen indeholder lige nu — ventende, i arbejde, og hvem der arbejder. */
export async function compileQueueStatus(
  db: TrailDatabase,
  tenantId: string,
  now: Date = new Date(),
): Promise<{ waiting: number; working: number; workers: string[] }> {
  const iso = now.toISOString();
  const r = (await db.execute(
    `SELECT
       SUM(CASE WHEN compile_lease_until IS NULL OR compile_lease_until < ? THEN 1 ELSE 0 END) AS waiting,
       SUM(CASE WHEN compile_lease_until >= ? THEN 1 ELSE 0 END) AS working
     FROM documents
     WHERE tenant_id = ? AND awaiting_local_compile = 1 AND kind = 'source' AND archived = 0`,
    [iso, iso, tenantId],
  )).rows[0] as { waiting?: unknown; working?: unknown } | undefined;

  const w = (await db.execute(
    `SELECT DISTINCT compile_claimed_by AS worker FROM documents
      WHERE tenant_id = ? AND awaiting_local_compile = 1 AND compile_lease_until >= ?
        AND compile_claimed_by IS NOT NULL`,
    [tenantId, iso],
  )).rows as Array<{ worker: unknown }>;

  return {
    waiting: Number(r?.waiting ?? 0),
    working: Number(r?.working ?? 0),
    workers: w.map((x) => String(x.worker)),
  };
}
