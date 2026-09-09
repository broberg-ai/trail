import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppBindings } from '../app.js';
import { telemetriTab } from '../lib/ai.js';
import { cacheStatus } from '@trail/core';

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
 * F265.9 — maskinens samlede hukommelse, så cachens loft kan læses MOD noget.
 * Fly sætter FLY_VM_MEMORY_MB; uden den er tallet ukendt frem for gættet —
 * et forkert nævner er værre end ingen, fordi det ser ud som en måling.
 */
const MASKINE_BYTES = process.env.FLY_VM_MEMORY_MB
  ? Number(process.env.FLY_VM_MEMORY_MB) * 1024 * 1024
  : null;

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
      // F263.3 — hvor mange omkostnings-stempler der er GÅET TABT siden boot.
      // Nul er det forventede svar; er det ikke nul, er der kørsler der fandt
      // sted uden at blive talt, og så er «gratis-volumen» underrapporteret.
      // Står her frem for i en tabel, fordi et tal der forhåbentlig er nul
      // ikke skal koste en migration før målingen siger at det er nødvendigt.
      telemetry: {
        lostStamps: telemetriTab.antal,
        lastError: telemetriTab.sidsteFejl,
        lastErrorAt: telemetriTab.sidsteTidspunkt,
      },
      // F265.9 — vektor-cachen. Uden tallene er «virker cachen?» et gæt, og
      // en cache man ikke kan se er en cache man ikke kan fejlsøge: et fald i
      // træf-raten er den tidligste advarsel om at noget rydder for meget.
      vektorCache: cacheStatus(),
      // F265.9 — PROCESSENS FAKTISKE FORBRUG, ved siden af cachens eget tal.
      // Cachens `bytes` er dens egen bogføring; den beviser ikke at
      // hukommelsen faktisk blev brugt. Står de to tal ikke side om side,
      // kan et loft på 200 MB ikke afgøres mod en maskine på 1024 MB, og
      // «cachen fylder 58 MB» bliver en påstand frem for en måling.
      // rss = alt processen har i fysisk hukommelse; heapUsed = det JS'en
      // faktisk holder på.
      //
      // JEG FORUDSAGDE AT DE TO IKKE VILLE FØLGES AD, og målingen modbeviste
      // det. Float32Array ligger uden for heap'en i mange runtimes, men i Bun
      // tælles bagvedliggende buffer med i heapUsed — målt på prod med
      // buddy-sessions (11.017 vektorer):
      //
      //   tom cache   rss 195,4 MB   heap  46,9 MB   cache  0 MB
      //   ét opslag   rss 255,0 MB   heap  90,8 MB   cache 44,2 MB
      //                   +59,6           +43,9            +44,2
      //
      // heap fulgte cachens eget tal næsten præcist. rss voksede MERE, fordi
      // indlæsningen selv allokerer undervejs — og fortsatte med at vokse over
      // de næste tre søgninger (281,3 MB) mens cachens tal stod helt stille.
      //
      // Derfor står begge alligevel: cachens tal er det stabile, rss er det
      // ærlige loft mod maskinen. Bruges rss til at måle cachens størrelse,
      // måler man GC-forsinkelse.
      processHukommelse: {
        rssBytes: process.memoryUsage.rss(),
        heapUsedBytes: process.memoryUsage().heapUsed,
        maskineBytes: MASKINE_BYTES,
      },
      version: VERSION,
    },
    kanBetjene ? 200 : 503,
  );
});
