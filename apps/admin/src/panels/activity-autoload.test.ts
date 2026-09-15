/**
 * F273.4 — spærren mod at Activity henter hele loggen uden at vise noget.
 *
 * Den bærende prøve er den næstsidste: en side FULD af rækker, hvor ingen af
 * dem slipper gennem gruppe-filteret, tæller som GOLD. Den er skrevet fordi
 * den nærliggende udgave — «kom der rækker tilbage?» — ville være grøn på
 * præcis det tilfælde spærren findes for.
 */
import { test, expect } from 'bun:test';
import { naesteAutoTilstand, MAX_GOLDE_RUNDER } from './activity-autoload.js';

const QUEUE = ['candidate.created', 'candidate.approved'];
const side = (...kinds: string[]) => kinds.map((kind) => ({ kind }));

test('en side med synlige rækker nulstiller tælleren', () => {
  const r = naesteAutoTilstand({
    items: side('candidate.created', 'auth.login'),
    groupKinds: QUEUE,
    goldeFoer: 4, // ét skridt fra at stoppe
  });
  expect(r.golde).toBe(0);
  expect(r.stop).toBe(false);
});

test('uden gruppe-filter er enhver hentet række synlig', () => {
  const r = naesteAutoTilstand({ items: side('auth.login'), groupKinds: null, goldeFoer: 3 });
  expect(r.golde).toBe(0);
  expect(r.stop).toBe(false);
});

test('en TOM side tæller som gold', () => {
  const r = naesteAutoTilstand({ items: [], groupKinds: null, goldeFoer: 0 });
  expect(r.golde).toBe(1);
  expect(r.stop).toBe(false);
});

test('DEN BÆRENDE: en FULD side hvor intet slipper gennem filteret er GOLD', () => {
  // 50 rækker tilbage fra motoren, 0 af dem synlige. En tæller der målte
  // «kom der rækker» ville nulstille her og lade hentningen løbe videre.
  const r = naesteAutoTilstand({
    items: side(...Array<string>(50).fill('auth.login')),
    groupKinds: QUEUE,
    goldeFoer: 0,
  });
  expect(r.golde).toBe(1);
  expect(r.stop).toBe(false);
});

test('fem golde sider i træk stopper auto-hentningen — og ikke før', () => {
  let golde = 0;
  const tomSide = () =>
    naesteAutoTilstand({ items: side('auth.login'), groupKinds: QUEUE, goldeFoer: golde });

  for (let i = 1; i < MAX_GOLDE_RUNDER; i++) {
    const r = tomSide();
    golde = r.golde;
    expect(r.golde).toBe(i);
    expect(r.stop).toBe(false); // NEGATIV KONTROL: den må ikke stoppe for tidligt
  }
  const sidste = tomSide();
  expect(sidste.golde).toBe(MAX_GOLDE_RUNDER);
  expect(sidste.stop).toBe(true);
});
