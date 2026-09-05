import { test, expect, beforeAll } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * F249.1 — PasskeyStore mod en RIGTIG control.db, ikke en stub.
 *
 * components' mutations-harness fandt at "afkort den gemte offentlige nøgle med
 * én byte" OVERLEVEDE alle 22 af deres stub-tests, fordi intet kørte en ægte
 * nøgle gennem hele løkken. Den lektie gælder også her, ét lag nede: en
 * store-test mod et Map beviser at MIN kode kalder de rigtige metoder, ikke at
 * SQL'en gør det den siger. Derfor kører alt nedenfor mod en ægte libsql-fil
 * med de ægte migrationer.
 */

const dir = mkdtempSync(join(tmpdir(), 'trail-passkey-'));
process.env.TRAIL_ADMIN_CONTROL_DB = join(dir, 'control.db');

// Dynamiske imports: db.ts læser env på modul-load, så stien SKAL stå før.
let client: typeof import('./db.js').client;
let store: typeof import('./passkey-store.js').passkeyStore;
let purge: typeof import('./passkey-store.js').purgeExpiredChallenges;

// Begge id-formater der findes i drift. usr_lens_ er Lens-principalen —
// den ene bruger ingen tester med, og præcis den en UUID-validering ville
// have afvist.
const USER_INVITE = 'u-a1b2c3d4';
const USER_LENS = 'usr_lens_deadbeef';

beforeAll(async () => {
  client = (await import('./db.js')).client;
  const mod = await import('./passkey-store.js');
  store = mod.passkeyStore;
  purge = mod.purgeExpiredChallenges;
  await (await import('./migrations.js')).runMigrations();
  await client.execute({
    sql: `INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)`,
    args: ['org-test', 'Test', 'test-org'],
  });
  for (const [id, email] of [[USER_INVITE, 'a@test.dk'], [USER_LENS, 'lens@test.dk']]) {
    await client.execute({
      sql: `INSERT INTO control_users (id, organization_id, email) VALUES (?, ?, ?)`,
      args: [id, 'org-test', email],
    });
  }
});

test('begge id-formater i drift kan bære en credential — ingen formatantagelse', async () => {
  for (const userId of [USER_INVITE, USER_LENS]) {
    await store.saveCredential({
      credentialId: `cred-${userId}`,
      userId,
      publicKey: `pk-${userId}`,
      counter: 0,
      transports: ['internal'],
    });
    const back = await store.getCredential(`cred-${userId}`);
    expect(back?.userId).toBe(userId);
    expect(back?.publicKey).toBe(`pk-${userId}`);
    expect(back?.transports).toEqual(['internal']);
  }
});

test('takeChallenge er ENGANGS — anden gang giver null', async () => {
  const rec = {
    id: 'chal-once',
    challenge: 'abc',
    ceremony: 'authentication' as const,
    expiresAt: Date.now() + 60_000,
  };
  await store.putChallenge(rec);

  const first = await store.takeChallenge('chal-once');
  expect(first?.challenge).toBe('abc');

  // DEN BÆRENDE ASSERT. Læser store'et kun, i stedet for at læse-og-slette,
  // kan en opsnappet assertion genafspilles — og hver anden test her ville
  // stadig være grøn. Beviset er at rækken er VÆK i databasen, ikke at
  // funktionen returnerede noget.
  const second = await store.takeChallenge('chal-once');
  expect(second).toBeNull();

  const rows = await client.execute({
    sql: `SELECT COUNT(*) AS n FROM passkey_challenges WHERE id = ?`,
    args: ['chal-once'],
  });
  expect(Number((rows.rows[0] as Record<string, unknown>).n)).toBe(0);
});

test('en challenge uden userId round-tripper som undefined, ikke som null', async () => {
  // authentication.begin() uden userId er usernameless-flowet. Kommer feltet
  // tilbage som null i stedet for undefined, ser pakken en userId der er sat.
  await store.putChallenge({
    id: 'chal-anon',
    challenge: 'x',
    ceremony: 'authentication',
    expiresAt: Date.now() + 60_000,
  });
  const back = await store.takeChallenge('chal-anon');
  expect(back).not.toBeNull();
  expect('userId' in back!).toBe(false);
});

test('listCredentialsByUser giver KUN brugerens egne', async () => {
  const mine = await store.listCredentialsByUser(USER_INVITE);
  expect(mine.map((c) => c.credentialId)).toEqual([`cred-${USER_INVITE}`]);
  // Negativ kontrol: uden den ville en implementering der returnerer ALT
  // bestå den forrige assert lige så grønt på en database med én bruger.
  expect(mine.some((c) => c.userId === USER_LENS)).toBe(false);
});

test('tælleren opdateres og last_used_at sættes', async () => {
  await store.updateCredentialCounter(`cred-${USER_INVITE}`, 42);
  const back = await store.getCredential(`cred-${USER_INVITE}`);
  expect(back?.counter).toBe(42);
  const row = await client.execute({
    sql: `SELECT last_used_at FROM passkey_credentials WHERE credential_id = ?`,
    args: [`cred-${USER_INVITE}`],
  });
  expect((row.rows[0] as Record<string, unknown>).last_used_at).not.toBeNull();
});

test('ukendt credential giver null, ikke et kast', async () => {
  expect(await store.getCredential('findes-ikke')).toBeNull();
});

test('oprydning fjerner UDLØBNE og kun dem', async () => {
  await store.putChallenge({ id: 'gammel', challenge: 'a', ceremony: 'registration', expiresAt: 1000 });
  await store.putChallenge({ id: 'frisk', challenge: 'b', ceremony: 'registration', expiresAt: Date.now() + 600_000 });
  const n = await purge(Date.now());
  expect(n).toBeGreaterThanOrEqual(1);
  expect(await store.takeChallenge('gammel')).toBeNull();
  // Negativ kontrol — en oprydning der tager alt ville bestå linjen ovenfor.
  expect(await store.takeChallenge('frisk')).not.toBeNull();
});

test('sletning af brugeren tager credentials med (FK cascade)', async () => {
  await client.execute({ sql: `DELETE FROM control_users WHERE id = ?`, args: [USER_LENS] });
  expect(await store.getCredential(`cred-${USER_LENS}`)).toBeNull();
});
