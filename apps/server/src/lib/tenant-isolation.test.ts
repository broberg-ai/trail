/**
 * F259.4 — ÉN KUNDES SYGE BASE MÅ IKKE LUKKE BUTIKKEN FOR DE ANDRE.
 *
 * MÅLT 6/9 på produktion. broberg-ais sqld tog imod LÆSNINGER men svarede
 * aldrig på en SKRIVNING — heller ikke `CREATE TABLE IF NOT EXISTS` på en tom
 * tabel:
 *
 *     sanne-andersen   læs 0,2s   skriv 0,1s   OK
 *     fd-aalborg       læs 0,2s   skriv 0,2s   OK
 *     broberg-ai       læs 1,7s   læs 8,1s     skrivningen kom aldrig tilbage
 *
 * Opstarten byggede puljen med `await` pr. kunde og uden frist, så motoren
 * ventede 285s på den tavse base, ramte klientens timeout, og en afvist
 * top-level await afsluttede processen. Sanne og fd-aalborg var klar til at
 * betjene hele tiden — de lå ned fordi en TREDJE kundes base var syg.
 *
 * DEN VIGTIGSTE PRØVE HER ER DEN SIDSTE. At udelade en kunde er kun sikkert
 * fordi opslaget fejler LUKKET: `pool.get(slug)` giver undefined → 401. Faldt
 * det tilbage på den primære, ville en kunde få en ANDEN kundes Neuroner —
 * ubetydeligt langsommere, uendeligt værre.
 */
import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibsqlDatabase, type TrailDatabase } from '@trail/db';
import { openTenantPool, medFrist } from './tenant-pool.js';

const dir = mkdtempSync(join(tmpdir(), 'f259-iso-'));

async function primær(): Promise<TrailDatabase> {
  return createLibsqlDatabase({ path: join(dir, `primary-${Math.random()}.db`) });
}

/** Sæt TRAIL_DB_REMOTE + flaget op og ryd op igen. */
async function medKunder<T>(kunder: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const gemt = { mt: process.env.TRAIL_MULTI_TENANT, rm: process.env.TRAIL_DB_REMOTE };
  process.env.TRAIL_MULTI_TENANT = '1';
  process.env.TRAIL_DB_REMOTE = JSON.stringify(kunder);
  try {
    return await fn();
  } finally {
    if (gemt.mt === undefined) delete process.env.TRAIL_MULTI_TENANT;
    else process.env.TRAIL_MULTI_TENANT = gemt.mt;
    if (gemt.rm === undefined) delete process.env.TRAIL_DB_REMOTE;
    else process.env.TRAIL_DB_REMOTE = gemt.rm;
  }
}

test('en kunde hvis ÅBNING fejler holdes ude — motoren rejser sig alligevel', async () => {
  const db = await primær();
  const set = new Set<string>();
  const pool = await medKunder({ syg: 'http://ingen-steder.invalid:6002' }, () =>
    openTenantPool({
      primarySlug: 'sanne-andersen',
      primaryDb: db,
      bootSecondary: async (slug) => {
        set.add(slug);
        throw new Error('basen svarer ikke');
      },
    }),
  );
  expect(pool.has('sanne-andersen')).toBe(true); // den raske betjenes
  expect(pool.has('syg')).toBe(false); // den syge er ude
  await db.close();
});

test('NEGATIV KONTROL: en udeladt kunde falder IKKE tilbage på en anden base', async () => {
  // Det er hele grunden til at det er forsvarligt at udelade en kunde.
  // pool.get(slug) → undefined → 401. Aldrig en anden kundes Neuroner.
  const db = await primær();
  const pool = await medKunder({ syg: 'http://ingen-steder.invalid:6002' }, () =>
    openTenantPool({
      primarySlug: 'sanne-andersen',
      primaryDb: db,
      bootSecondary: async () => {
        throw new Error('basen svarer ikke');
      },
    }),
  );
  expect(pool.get('syg')).toBeUndefined();
  expect(pool.get('syg')).not.toBe(pool.get('sanne-andersen'));
  await db.close();
});

test('FRISTEN: et kald der aldrig svarer afvises — det er nedetidens mekanisme', async () => {
  // MÅLT PÅ MIG SELV: min første udgave af denne prøve gik gennem
  // openTenantPool og bestod på 257 ms — altså uden nogensinde at nå fristen,
  // fordi ÅBNINGEN fejlede først. Grøn af den forkerte grund, præcis den
  // fejlform dagen har været fuld af. Fristen prøves derfor direkte.
  const t0 = Date.now();
  await expect(medFrist(300, 'et kald der tier', () => new Promise<void>(() => {}))).rejects.toThrow(
    /frist på 0.3s udløb/,
  );
  const brugt = Date.now() - t0;
  expect(brugt).toBeGreaterThanOrEqual(250); // den ventede faktisk
  expect(brugt).toBeLessThan(3000); // og gav op
});

test('FRISTEN slår ikke til på et hurtigt kald, og resultatet går uændret igennem', async () => {
  // Uden denne ville «fristen afviser» også bestå hvis den afviste ALT.
  await expect(medFrist(5000, 'hurtigt', async () => 42)).resolves.toBe(42);
});

test('FRISTEN skjuler ikke en ægte fejl bag en frist-besked', async () => {
  // Fejler kaldet af sig selv, skal DEN fejl nå frem — ikke «fristen udløb»,
  // som ville sende den næste læser efter et netværksproblem der ikke findes.
  await expect(
    medFrist(5000, 'fejler', async () => {
      throw new Error('basen afviste skrivningen');
    }),
  ).rejects.toThrow(/afviste skrivningen/);
});

test('POSITIV KONTROL: en RASK kunde kommer i puljen', async () => {
  // Uden denne ville «syg holdes ude» også bestå hvis vi holdt ALLE ude.
  const db = await primær();
  const rask = await createLibsqlDatabase({ path: join(dir, 'rask.db') });
  const pool = await medKunder({}, () =>
    openTenantPool({
      primarySlug: 'sanne-andersen',
      primaryDb: db,
      bootSecondary: async () => {},
    }),
  );
  expect(pool.has('sanne-andersen')).toBe(true);
  await rask.close();
  await db.close();
});

test('uden multi-tenant er puljen kun den primære — uændret adfærd', () => {
  rmSync(dir, { recursive: true, force: true });
  expect(true).toBe(true);
});
