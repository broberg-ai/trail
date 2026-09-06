import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppBindings } from '../app.js';

/**
 * Health endpoint for Fly.io's HTTP checks + human-readable smoke test.
 * Pinger hver kunde i puljen med et billigt `SELECT 1`, så en fejlet
 * volume-mount eller en libsql-åbning der ikke lykkedes faktisk viser sig
 * som usund — frem for et grønt flueben på en motor der ikke kan svare.
 *
 * `version` is pulled from env at boot (Fly sets FLY_MACHINE_VERSION on
 * release; TRAIL_VERSION is the escape hatch for non-Fly deploys).
 * Falls back to "dev" locally.
 */
export const healthRoutes = new Hono<AppBindings>();

const VERSION = process.env.FLY_MACHINE_VERSION ?? process.env.TRAIL_VERSION ?? 'dev';

/**
 * F259.5 — SUND = «JEG KAN BETJENE NOGEN», IKKE «DEN PRIMÆRE LEVER».
 *
 * Ruten spurgte den PRIMÆRE base. Da F259.4 gjorde en syg kunde ufarlig,
 * blev netop dét farligt: er den primære ude af drift mens to andre kunder
 * betjenes fint, svarede den 503 — Fly ville erklære motoren død og
 * genstarte den, og så var de to raske kunder nede af en grund der ikke
 * havde noget med dem at gøre. Sundhedstjekket ville gøre én kundes problem
 * til alles, hvilket er præcis det F259.4 fjernede.
 *
 * Så: mindst én kunde i puljen der svarer = 200. Ingen = 503, for da er der
 * intet at holde i live.
 *
 * `tenants` viser hvem der er oppe og nede, så et menneske kan se en delvis
 * nedetid frem for at skulle udlede den af et grønt flueben.
 */
healthRoutes.get('/health', async (c) => {
  const pool = c.get('tenantPool');
  const oppe: string[] = [];
  const nede: string[] = [];

  for (const [slug, db] of pool ?? []) {
    try {
      await db.db.run(sql`SELECT 1`);
      oppe.push(slug);
    } catch {
      nede.push(slug);
    }
  }

  const kanBetjene = oppe.length > 0;
  return c.json(
    {
      status: kanBetjene ? (nede.length === 0 ? 'ok' : 'degraded') : 'down',
      service: 'trail-server',
      // Bevaret for bagudkompatibilitet: de gamle vagter læser `db`.
      db: kanBetjene ? 'ok' : 'error',
      tenants: { up: oppe, down: nede },
      version: VERSION,
    },
    kanBetjene ? 200 : 503,
  );
});
