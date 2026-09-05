/**
 * F247.3 — web-push: prefs-round-trip + modtager-filter, mod RIGTIG SQL.
 *
 * Det bærende: recipientsFor er den funktion der afgør HVEM der bliver
 * afbrudt af HVAD. En mutation der ignorerer prefs (sender til alle) skal
 * gøre den navngivne negative test rød — ikke bare "noget fejlede".
 */
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  createLibsqlDatabase,
  tenants,
  users,
  pushSubscriptions,
  pushPrefs,
  type TrailDatabase,
} from '@trail/db';
import {
  recipientsFor,
  readPrefs,
  parsePrefs,
  DEFAULT_PUSH_PREFS,
  distinctSubscriptionTenants,
} from './push.js';

const TENANT = 't-push-test';
const USER_A = 'u-push-a'; // prefs: lint slået FRA
const USER_B = 'u-push-b'; // ingen prefs-række → alle typer til

let trail!: TrailDatabase;
const dbPath = join(process.env.TMPDIR ?? '/tmp', `push-test-${process.pid}.db`);

beforeAll(async () => {
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* fresh */ }
  }
  trail = await createLibsqlDatabase({ path: dbPath });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: TENANT, slug: 'push-test', name: 'Push', plan: 'hobby' }).run();
  for (const id of [USER_A, USER_B]) {
    await trail.db.insert(users).values({
      id,
      tenantId: TENANT,
      email: `${id}@test.local`,
    }).run();
  }
  // A: to enheder. B: én enhed.
  await trail.db.insert(pushSubscriptions).values([
    { endpoint: 'https://push.example/a1', p256dh: 'k', auth: 'a', tenantId: TENANT, userId: USER_A },
    { endpoint: 'https://push.example/a2', p256dh: 'k', auth: 'a', tenantId: TENANT, userId: USER_A },
    { endpoint: 'https://push.example/b1', p256dh: 'k', auth: 'a', tenantId: TENANT, userId: USER_B },
  ]).run();
  // A slår lint fra.
  await trail.db.insert(pushPrefs).values({
    userId: USER_A,
    tenantId: TENANT,
    prefs: JSON.stringify({ queue: true, ingest: true, lint: false, system: true }),
  }).run();
});

afterAll(async () => {
  await trail.close?.();
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(f, { force: true }); } catch { /* fine */ }
  }
});

test('prefs round-trip: det der læses tilbage er præcis det der blev skrevet', async () => {
  const p = await readPrefs(trail, USER_A);
  expect(p).toEqual({ queue: true, ingest: true, lint: false, system: true });
});

test('ingen prefs-række = alle typer til (default)', async () => {
  const p = await readPrefs(trail, USER_B);
  expect(p).toEqual(DEFAULT_PUSH_PREFS);
});

test('korrupt prefs-JSON degraderer til default, aldrig et crash', () => {
  expect(parsePrefs('{ikke json')).toEqual(DEFAULT_PUSH_PREFS);
  expect(parsePrefs(null)).toEqual(DEFAULT_PUSH_PREFS);
});

test('NEGATIV KONTROL: lint-push når IKKE brugeren der slog lint fra', async () => {
  const recipients = await recipientsFor(trail, TENANT, 'lint');
  const endpoints = recipients.map((r) => r.endpoint).sort();
  // Kun B's enhed — A's TO enheder er begge filtreret fra, fordi prefs er
  // pr. BRUGER. En mutation der sender til alle gør denne rød.
  expect(endpoints).toEqual(['https://push.example/b1']);
});

test('queue-push når begge brugere (A har queue slået til)', async () => {
  const recipients = await recipientsFor(trail, TENANT, 'queue');
  expect(recipients.map((r) => r.endpoint).sort()).toEqual([
    'https://push.example/a1',
    'https://push.example/a2',
    'https://push.example/b1',
  ]);
});

test('forkert tenant giver TOMT modtagersæt — aldrig en anden tenants enheder', async () => {
  const recipients = await recipientsFor(trail, 't-en-anden-tenant', 'queue');
  expect(recipients).toEqual([]);
});

test('distinctSubscriptionTenants ser præcis vores tenant', async () => {
  expect(await distinctSubscriptionTenants(trail)).toEqual([TENANT]);
});
