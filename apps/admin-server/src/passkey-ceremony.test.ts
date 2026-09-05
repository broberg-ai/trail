import { test, expect, beforeAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * F249.1 / components-AC#6 — ceremonien koblet til VORES store mod control.db.
 *
 * Det components ikke kan måle: at deres pakke virker mod vores skema, og at
 * vores egen sessionsvej står uberørt bagved. Krypto-halvdelen er deres
 * (ægte COSE-nøgle, 12 mutationer dræbt); det her er integrationen.
 */

const dir = mkdtempSync(join(tmpdir(), 'trail-pkc-'));
process.env.TRAIL_ADMIN_CONTROL_DB = join(dir, 'control.db');

let client: typeof import('./db.js').client;
let pk: ReturnType<typeof import('@broberg/auth/passkey-ceremony').createPasskeyCeremony>;
let PasskeyCeremonyError: typeof import('@broberg/auth/passkey-ceremony').PasskeyCeremonyError;

const USER = 'u-11223344';

beforeAll(async () => {
  client = (await import('./db.js')).client;
  await (await import('./migrations.js')).runMigrations();
  await client.execute({
    sql: `INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)`,
    args: ['org-x', 'X', 'org-x'],
  });
  await client.execute({
    sql: `INSERT INTO control_users (id, organization_id, email) VALUES (?, ?, ?)`,
    args: [USER, 'org-x', 'u@test.dk'],
  });
  const { createPasskeyCeremony, PasskeyCeremonyError: E } = await import(
    '@broberg/auth/passkey-ceremony'
  );
  PasskeyCeremonyError = E;
  pk = createPasskeyCeremony({
    rpID: 'app.trailmem.com',
    rpName: 'Trail',
    origin: 'https://app.trailmem.com',
    requireUserVerification: true,
    store: (await import('./passkey-store.js')).passkeyStore,
  });
});

test('registration.begin skriver sin challenge i control.db — ikke i hukommelsen', async () => {
  const { options, challengeId } = await pk.registration.begin({
    userId: USER,
    userName: 'u@test.dk',
  });
  expect(options.rp.id).toBe('app.trailmem.com');
  // UV-kravet skal stå i det browseren får at vide, ikke kun i vores config.
  expect(options.authenticatorSelection?.userVerification).toBe('required');

  const row = await client.execute({
    sql: `SELECT ceremony, user_id FROM passkey_challenges WHERE id = ?`,
    args: [challengeId],
  });
  expect(row.rows.length).toBe(1);
  expect((row.rows[0] as Record<string, unknown>).ceremony).toBe('registration');
  expect((row.rows[0] as Record<string, unknown>).user_id).toBe(USER);
});

test('authentication.begin uden userId virker — usernameless-flowet', async () => {
  const begun = await pk.authentication.begin();
  expect(typeof begun.challengeId).toBe('string');
  const row = await client.execute({
    sql: `SELECT ceremony, user_id FROM passkey_challenges WHERE id = ?`,
    args: [begun.challengeId],
  });
  expect((row.rows[0] as Record<string, unknown>).ceremony).toBe('authentication');
  // Ingen bruger endnu — det er hele pointen med usernameless.
  expect((row.rows[0] as Record<string, unknown>).user_id).toBeNull();
});

test('en challenge kan ikke bruges to gange — genafspilning afvises', async () => {
  const begun = await pk.authentication.begin();
  // Første finish fejler på et opdigtet svar (forventet) …
  await expect(
    pk.authentication.finish({ challengeId: begun.challengeId, response: {} as never }),
  ).rejects.toThrow();
  // … men challengen er VÆK bagefter, så et andet forsøg ikke engang når krypto.
  const row = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM passkey_challenges WHERE id = ?`,
    args: [begun.challengeId],
  });
  expect(Number((row.rows[0] as Record<string, unknown>).n)).toBe(0);
});

test('ukendt challenge-id afvises med CHALLENGE_NOT_FOUND', async () => {
  try {
    await pk.authentication.finish({ challengeId: 'findes-ikke', response: {} as never });
    throw new Error('skulle have kastet');
  } catch (e) {
    expect(e).toBeInstanceOf(PasskeyCeremonyError);
    expect((e as InstanceType<typeof PasskeyCeremonyError>).code).toBe('CHALLENGE_NOT_FOUND');
  }
});

test('UV-kravet når HELE vejen ud i det browseren instrueres med', async () => {
  // Den negative kontrol der betyder noget: sætter man requireUserVerification
  // til false, må options IKKE længere sige "required". Består begge grene med
  // samme værdi, beviser en grøn test intet om indstillingen.
  const { createPasskeyCeremony } = await import('@broberg/auth/passkey-ceremony');
  const lax = createPasskeyCeremony({
    rpID: 'app.trailmem.com',
    rpName: 'Trail',
    origin: 'https://app.trailmem.com',
    requireUserVerification: false,
    store: (await import('./passkey-store.js')).passkeyStore,
  });
  const strict = await pk.registration.begin({ userId: USER, userName: 'u@test.dk' });
  const loose = await lax.registration.begin({ userId: USER, userName: 'u@test.dk' });
  expect(strict.options.authenticatorSelection?.userVerification).toBe('required');
  expect(loose.options.authenticatorSelection?.userVerification).not.toBe('required');
});
