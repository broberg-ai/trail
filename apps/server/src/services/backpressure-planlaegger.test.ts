/**
 * F281.2 — den periodiske planlægger skal køre for HVER kunde, ikke kun den første.
 *
 * `startBackpressureScheduler` blev kaldt én gang pr. kunde ved opstart, men
 * vogtede på en modul-global timer-variabel: den anden kunde og alle derefter
 * fik et tavst no-op. Kaldestedet i index.ts påstod ordret «one timer per
 * tenant so jobs in tenant A never wait on tenant B's rate cap». Det var
 * usandt, og koden — ikke kommentaren — er den der er rettet.
 *
 * DET BLEV BÆRENDE MED F281.1. Før den holdt et tilbageholdt job sig selv i
 * gang ved at kalde sig selv i ring: dyrt og larmende, men det blev taget når
 * der kom plads. F281.1 fjernede ringen og gjorde den periodiske planlægger
 * til den der prøver igen. For kunde nummer to fandtes den ikke — så jeg
 * ville have byttet en CPU der brænder ud med et job der aldrig bliver kørt.
 */
import { test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase } from '@trail/db';
import { startBackpressureScheduler, stopBackpressureScheduler } from './ingest.js';

async function friskBase(navn: string) {
  const p = join(process.env.TMPDIR ?? '/tmp', `plan-${navn}-${process.pid}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  const t = await createLibsqlDatabase({ path: p });
  await t.runMigrations();
  return t;
}

/** Tæller de timere der er i live lige nu — Bun holder regnskab med dem. */
function aktiveTimere(): number {
  // `setInterval` returnerer et Timeout-objekt; vi tæller i stedet via en
  // tælle-indpakning, fordi Bun ikke eksponerer en global liste. Se nedenfor.
  return tællerAfTimere;
}

let tællerAfTimere = 0;
const ægteSetInterval = globalThis.setInterval;
const ægteClearInterval = globalThis.clearInterval;

afterEach(() => {
  globalThis.setInterval = ægteSetInterval;
  globalThis.clearInterval = ægteClearInterval;
  stopBackpressureScheduler();
  tællerAfTimere = 0;
});

test('DEN BÆRENDE: to kunder giver to tikkere, ikke én', async () => {
  const a = await friskBase('a');
  const b = await friskBase('b');

  // Tæl hvor mange intervaller planlæggeren faktisk opretter.
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    tællerAfTimere++;
    return ægteSetInterval(...args);
  }) as typeof setInterval;

  startBackpressureScheduler(a);
  startBackpressureScheduler(b);

  // Før rettelsen: 1. Kunde nummer to fik et tavst no-op, og dens køede
  // jobs blev aldrig forsøgt igen af nogen.
  expect(aktiveTimere()).toBe(2);
});

test('IDEMPOTENS BEVARET: samme kunde to gange giver stadig ÉN tikker', async () => {
  const a = await friskBase('c');

  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    tællerAfTimere++;
    return ægteSetInterval(...args);
  }) as typeof setInterval;

  startBackpressureScheduler(a);
  startBackpressureScheduler(a);

  // POSITIV KONTROL for at rettelsen ikke bare fjernede vagten: opstart
  // kalder én gang pr. kunde, men en gentagelse må ikke lægge en timer oveni.
  expect(aktiveTimere()).toBe(1);
});

test('STOP LUKKER DEM ALLE: ingen tikker overlever en nedlukning', async () => {
  const a = await friskBase('d');
  const b = await friskBase('e');

  let ryddede = 0;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    tællerAfTimere++;
    return ægteSetInterval(...args);
  }) as typeof setInterval;
  globalThis.clearInterval = ((h: Parameters<typeof clearInterval>[0]) => {
    ryddede++;
    return ægteClearInterval(h);
  }) as typeof clearInterval;

  startBackpressureScheduler(a);
  startBackpressureScheduler(b);
  stopBackpressureScheduler();

  // En tikker der overlever nedlukningen skriver videre til en lukket
  // database. Begge skal ryddes, ikke kun den første.
  expect(ryddede).toBe(2);

  // Og en ny opstart bagefter skal kunne lave dem igen — ellers ville en
  // genstartet kunde stå uden planlægger resten af processens levetid.
  tællerAfTimere = 0;
  startBackpressureScheduler(a);
  expect(aktiveTimere()).toBe(1);
});
