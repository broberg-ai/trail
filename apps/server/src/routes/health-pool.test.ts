/**
 * F259.5 — SUNDHEDSTJEKKET MÅ IKKE GØRE ÉN KUNDES PROBLEM TIL ALLES.
 *
 * Da F259.4 gjorde en syg kunde ufarlig for motoren, blev sundhedstjekket
 * pludselig farligt: det spurgte den PRIMÆRE base. Var den ude af drift mens
 * to andre kunder blev betjent fint, svarede ruten 503 → Fly erklærer motoren
 * død → genstart → de to raske kunder er nede af en grund der ikke har noget
 * med dem at gøre. Præcis det F259.4 fjernede, genindført ad bagdøren.
 */
import { test, expect } from 'bun:test';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibsqlDatabase, type TrailDatabase } from '@trail/db';
import { healthRoutes } from './health.js';

const dir = mkdtempSync(join(tmpdir(), 'f259-health-'));

async function rask(navn: string) {
  return createLibsqlDatabase({ path: join(dir, `${navn}.db`) });
}

/** En base der ligner en åben base men fejler på enhver forespørgsel. */
function syg(): TrailDatabase {
  return {
    db: { run: async () => { throw new Error('basen svarer ikke'); } },
  } as unknown as TrailDatabase;
}

function app(pool: Map<string, TrailDatabase>) {
  const a = new Hono();
  a.use('*', async (c, next) => { c.set('tenantPool' as never, pool as never); await next(); });
  a.route('/api', healthRoutes as never);
  return a;
}

test('to raske + én syg kunde ⇒ 200, ikke 503', async () => {
  const pool = new Map<string, TrailDatabase>([
    ['sanne-andersen', await rask('s')],
    ['fd-aalborg', await rask('f')],
    ['broberg-ai', syg()],
  ]);
  const res = await app(pool).request('/api/health');
  expect(res.status).toBe(200);
  const b = (await res.json()) as { status: string; tenants: { up: string[]; down: string[] } };
  expect(b.status).toBe('degraded'); // ærligt: ikke alt er godt
  expect(b.tenants.up.sort()).toEqual(['fd-aalborg', 'sanne-andersen']);
  expect(b.tenants.down).toEqual(['broberg-ai']);
});

test('NEGATIV KONTROL: ingen kunder kan svare ⇒ 503', async () => {
  // Uden denne ville «altid 200» også bestå — og så ville et dødt motor-svar
  // se sundt ud, hvilket er den værste af de to fejl.
  const pool = new Map<string, TrailDatabase>([['broberg-ai', syg()]]);
  const res = await app(pool).request('/api/health');
  expect(res.status).toBe(503);
  expect((await res.json() as { status: string }).status).toBe('down');
});

test('en TOM pulje ⇒ 503 — der er intet at holde i live', async () => {
  const res = await app(new Map()).request('/api/health');
  expect(res.status).toBe(503);
});

test('alt raskt ⇒ status ok, og ingen står som nede', async () => {
  const pool = new Map<string, TrailDatabase>([['sanne-andersen', await rask('ok')]]);
  const res = await app(pool).request('/api/health');
  expect(res.status).toBe(200);
  const b = (await res.json()) as { status: string; tenants: { down: string[] } };
  expect(b.status).toBe('ok');
  expect(b.tenants.down).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});
