/**
 * F259.5 — EN UDELADT KUNDE SKAL KOMME TILBAGE AF SIG SELV.
 *
 * F259.4 holdt en syg base ude så de raske kunder kunne betjenes. Men
 * udelukkelsen var PERMANENT indtil et menneske genstartede motoren.
 *
 * MÅLT 6/9: broberg-ais base var rask igen 20 minutter efter den blev
 * udeladt, og kunden var STADIG lukket ude. Ejeren måtte spørges om lov til
 * en genstart for at få sin egen Trail tilbage. En rettelse der kræver et
 * menneske klokken tre om natten er ikke en rettelse.
 */
import { test, expect } from 'bun:test';
import type { TrailDatabase } from '@trail/db';
import { startTenantRejoin } from './tenant-pool.js';

const attrap = (navn: string) => ({ path: navn }) as unknown as TrailDatabase;

async function medKonfig<T>(kunder: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const gemt = { mt: process.env.TRAIL_MULTI_TENANT, rm: process.env.TRAIL_DB_REMOTE };
  process.env.TRAIL_MULTI_TENANT = '1';
  process.env.TRAIL_DB_REMOTE = JSON.stringify(kunder);
  try { return await fn(); } finally {
    if (gemt.mt === undefined) delete process.env.TRAIL_MULTI_TENANT; else process.env.TRAIL_MULTI_TENANT = gemt.mt;
    if (gemt.rm === undefined) delete process.env.TRAIL_DB_REMOTE; else process.env.TRAIL_DB_REMOTE = gemt.rm;
  }
}

const vent = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('en rask kunde i puljen prøves ALDRIG igen', async () => {
  // Det er den vigtigste egenskab: løkken må ikke røre nogen der virker.
  const pool = new Map<string, TrailDatabase>([['rask', attrap('rask')]]);
  let forsøg = 0;
  const stop = await medKonfig({ rask: 'http://x.invalid' }, async () => {
    const s = startTenantRejoin({
      pool, intervalMs: 40,
      tilslut: async (slug) => { forsøg += 1; return attrap(slug); },
      onJoin: () => {},
    });
    await vent(200);
    return s;
  });
  stop();
  expect(forsøg).toBe(0);
});

test('løkken stopper når den bliver bedt om det', async () => {
  let forsøg = 0;
  const pool = new Map<string, TrailDatabase>();
  const stop = await medKonfig({ mangler: 'http://x.invalid' }, async () => {
    const s = startTenantRejoin({
      pool, intervalMs: 30,
      tilslut: async () => { forsøg += 1; throw new Error('nej'); },
      onJoin: () => {},
    });
    await vent(150);
    return s;
  });
  const vedStop = forsøg;
  stop();
  await vent(150);
  expect(forsøg).toBe(vedStop); // ingen nye forsøg efter stop
});

test('en manglende kunde prøves gentagne gange — ikke kun én gang', async () => {
  // Uden gentagelsen ville en base der bliver rask efter FØRSTE forsøg
  // være lukket ude for evigt, hvilket er præcis den fejl kortet retter.
  let forsøg = 0;
  const pool = new Map<string, TrailDatabase>();
  const stop = await medKonfig({ syg: 'http://x.invalid' }, async () => {
    const s = startTenantRejoin({
      pool, intervalMs: 30,
      tilslut: async () => { forsøg += 1; throw new Error('stadig syg'); },
      onJoin: () => {},
    });
    await vent(200);
    return s;
  });
  stop();
  expect(forsøg).toBeGreaterThan(1);
  expect(pool.has('syg')).toBe(false); // og den kom aldrig i puljen
});

test('POSITIV KONTROL: bliver basen rask, ryger kunden i puljen OG onJoin fyrer', async () => {
  let forsøg = 0;
  const tilsluttet: string[] = [];
  const pool = new Map<string, TrailDatabase>();
  const stop = await medKonfig({ senrask: 'http://x.invalid' }, async () => {
    const s = startTenantRejoin({
      pool, intervalMs: 30,
      // fejler to gange, lykkes på tredje — som en base der kommer sig
      tilslut: async (slug) => { forsøg += 1; if (forsøg < 3) throw new Error('endnu ikke'); return attrap(slug); },
      onJoin: (slug) => { tilsluttet.push(slug); },
    });
    await vent(400);
    return s;
  });
  stop();
  expect(pool.has('senrask')).toBe(true);
  expect(tilsluttet).toEqual(['senrask']);
});

test('onJoin fyrer PRÆCIS én gang — en kunde må ikke få dobbelte tjenester', async () => {
  // To sæt baggrunds-tjenester på samme base ville betyde dobbelt arbejde og
  // to job-kørere der slås om den samme kø.
  const tilsluttet: string[] = [];
  const pool = new Map<string, TrailDatabase>();
  const stop = await medKonfig({ en: 'http://x.invalid' }, async () => {
    const s = startTenantRejoin({
      pool, intervalMs: 30,
      tilslut: async (slug) => attrap(slug),
      onJoin: (slug) => { tilsluttet.push(slug); },
    });
    await vent(300);
    return s;
  });
  stop();
  expect(tilsluttet).toEqual(['en']);
});
