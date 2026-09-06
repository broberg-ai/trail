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

/**
 * F254.6 — HVILKE BASER FEJES.
 *
 * Første udgave skrev `WHERE hybrid_search_enabled = 1`, og det var cirkulært:
 *
 *   hybrid må ikke tændes  →  før indekset er bevist
 *   indekset vedligeholdes →  først når hybrid er tændt
 *
 * Flaget er 0 i hver eneste base (med vilje, indtil F254.3's før/efter-måling er
 * kørt), så fejeren har aldrig indekseret ét eneste stykke. Målt 6/9: en Neuron
 * skrevet gennem kandidat-godkendelsen lå stadig uden vektor 25 minutter senere,
 * hvor fejeren skulle have kørt to gange. «Det kontinuerlige job» var i praksis
 * et job der aldrig kørte — og INTET så forkert ud imens, for der var hverken
 * fejl eller tomme kørsler at se i loggen. Den fejlform igen: fravær af signal
 * læst som fravær af problem.
 *
 * VALGT: fej de baser der ER indekseret mindst én gang — eller har hybrid tændt.
 * «Hold ved lige hvad nogen har taget i brug.» Et POST /index gør basen levende
 * for altid; herefter følger den med af sig selv.
 *
 * FORKASTET — fej ALLE baser. Så ville første tick sende en uvarslet regning for
 * buddy-sessions' 5.699 Neuroner. Beløbet er lille (~3 kr), men en omkostning
 * ingen har bedt om er en omkostning ingen har bedt om, og en tom demo-base skal
 * ikke koste noget at have liggende.
 *
 * FORKASTET — et nyt `index_enabled`-flag. Endnu en kontakt der kan stå forkert,
 * til at besvare et spørgsmål tabellen allerede kan svare på: findes der en
 * vektor for denne base? Kontakten ville have præcis samme fejlmulighed som den
 * her retter.
 */
export const SWEEP_KB_SQL = `
  SELECT kb.id AS id, kb.tenant_id AS tenantId, kb.slug AS slug
    FROM knowledge_bases kb
   WHERE kb.hybrid_search_enabled = 1
      OR EXISTS (SELECT 1 FROM chunk_embeddings e WHERE e.knowledge_base_id = kb.id)`;

async function kbsToSweep(
  trail: TrailDatabase,
): Promise<Array<{ id: string; tenantId: string; slug: string }>> {
  return (await trail.execute(SWEEP_KB_SQL)).rows as Array<{ id: string; tenantId: string; slug: string }>;
}

async function tick(trail: TrailDatabase): Promise<void> {
  const kbs = await kbsToSweep(trail);

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
      `KBs med mindst én vektor, eller hybrid tændt`,
  );

  return () => { stopped = true; clearTimeout(first); clearInterval(interval); };
}
