/**
 * F254.1 — det kontinuerlige job: hold vektorerne i takt med teksten.
 *
 * Ejerens ordre: «lav et nyt kontinuerligt job der indekserer alt nyt der
 * rammer os.»
 *
 * EN FEJER, IKKE EN KROG. `storeChunks` kaldes fra seks steder, og en
 * indeksering hængt på hvert af dem ville være nattens fejl gentaget:
 * arkivering skrev ikke i hændelses-loggen fordi kun ÉN vej kendte reglen, og
 * 144 sider stod udokumenteret i fire måneder. Denne spørger DATABASEN
 * «hvilke tekststykker mangler en brugbar vektor?» og kan derfor ikke narres
 * af en krog nogen glemte at sætte, en migration der tilføjer chunks, eller et
 * script der skriver udenom.
 *
 * DEN GØR KUN NOGET FOR VIDENBASER DER HAR BEDT OM DET. Er hybrid slukket for
 * en videnbase, indekseres den ikke — så et flag der er slukket også betyder
 * «ingen regning». Ellers ville en kunde betale for en evne de ikke bruger.
 *
 * ALDRIG FATAL. Kaster en portion, tælles den som sprunget over og næste tick
 * tager den. En baggrundsopgave der kan vælte motoren er en ny fejlkilde, ikke
 * en forbedring.
 */
import type { TrailDatabase } from '@trail/db';
import { sweepKb } from './indexer.js';

const TICK_MINUTES = Number(process.env.TRAIL_INDEX_TICK_MINUTES ?? 10);
const INITIAL_DELAY_MS = 90_000; // lad motoren komme op først
/** Loft pr. tick, så en pludselig stor ingest ikke bliver ét kæmpe kald. */
const MAX_PER_TICK = Number(process.env.TRAIL_INDEX_MAX_PER_TICK ?? 500);

async function tick(trail: TrailDatabase): Promise<void> {
  const kbs = (await trail.execute(
    `SELECT id, tenant_id AS tenantId, slug FROM knowledge_bases WHERE hybrid_search_enabled = 1`,
  )).rows as Array<{ id: string; tenantId: string; slug: string }>;

  for (const kb of kbs) {
    try {
      const r = await sweepKb(trail, kb.tenantId, kb.id, { max: MAX_PER_TICK });
      if (r.embedded > 0 || r.skipped > 0) {
        console.log(
          `[F254] ${kb.slug}: indekseret ${r.embedded}, sprunget over ${r.skipped}, ` +
            `dækning ${(r.coverageAfter * 100).toFixed(1)}%, ` +
            `pris $${(r.costCents / 100).toFixed(4)}`,
        );
      }
    } catch (err) {
      console.error(`[F254] fejer fejlede for ${kb.slug}:`, err);
    }
  }
}

export function startIndexScheduler(trail: TrailDatabase): () => void {
  if (TICK_MINUTES <= 0) {
    console.log('  index-scheduler: disabled (TRAIL_INDEX_TICK_MINUTES=0)');
    return () => {};
  }
  let stopped = false;

  const first = setTimeout(() => { if (!stopped) void tick(trail); }, INITIAL_DELAY_MS);
  const interval = setInterval(() => { if (!stopped) void tick(trail); }, TICK_MINUTES * 60_000);

  console.log(
    `  index-scheduler: tick every ${TICK_MINUTES}min, max ${MAX_PER_TICK} chunks/tick, ` +
      `only KBs with hybrid_search_enabled=1`,
  );

  return () => { stopped = true; clearTimeout(first); clearInterval(interval); };
}
