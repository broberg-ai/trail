import { client } from './db.js';
import type { PasskeyStore, StoredCredential, ChallengeRecord } from '@broberg/auth/passkey-ceremony';

/**
 * F249.1 — Trails PasskeyStore mod control.db.
 *
 * Ceremonien ejes af @broberg/auth/passkey-ceremony (components-F008.13). Den
 * svarer på ÉT spørgsmål — hvilken bruger beviste lige at have denne nøgle, og
 * verificerede enheden hvem der holdt den — og stopper der. Ingen session,
 * ingen cookie. Vi minter `trail-session` som vi altid har gjort, i auth.ts.
 *
 * Hvorfor det er den eneste vej: @better-auth/passkey's egen ceremoni kalder
 * UBETINGET createSession() + setSessionCookie(). Målt af components i
 * 1.6.23's dist. Havde vi brugt den, ville hvert passkey-login have lavet en
 * ANDEN session med en ANDEN cookie ved siden af vores egen.
 *
 * Interfacet har med vilje INGEN bruger-metode. Vores control_users.
 * organization_id er NOT NULL med FK, så en ceremoni kan ikke lovligt oprette
 * en bruger — og HVILKEN organisation er en forretningsbeslutning, ikke noget
 * et login udleder. Invite er den eneste vej ind (oauth.ts afviser ukendte
 * e-mails med email_not_registered).
 */

function rowToCredential(r: Record<string, unknown>): StoredCredential {
  const transports = r.transports as string | null;
  return {
    credentialId: r.credential_id as string,
    userId: r.user_id as string,
    publicKey: r.public_key as string,
    counter: Number(r.counter ?? 0),
    // Tom liste og "ingen liste" er to forskellige ting for browseren, så et
    // NULL-felt bliver til undefined frem for [] — sidstnævnte ville fortælle
    // authenticatoren at der ikke findes nogen transport, hvilket er en påstand
    // vi ikke har grundlag for.
    ...(transports ? { transports: JSON.parse(transports) as string[] } : {}),
  };
}

export const passkeyStore: PasskeyStore = {
  async putChallenge(record: ChallengeRecord): Promise<void> {
    await client.execute({
      sql: `INSERT INTO passkey_challenges (id, challenge, ceremony, user_id, expires_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [record.id, record.challenge, record.ceremony, record.userId ?? null, record.expiresAt],
    });
  },

  /**
   * LÆS OG SLET I SAMME OPERATION. Det er dét — og kun dét — der gør en
   * challenge til engangsbrug. Deler man det i et SELECT og et senere DELETE,
   * kan en opsnappet assertion genafspilles i vinduet imellem, og hver eneste
   * anden test i systemet forbliver grøn.
   */
  async takeChallenge(id: string): Promise<ChallengeRecord | null> {
    const res = await client.execute({
      sql: `DELETE FROM passkey_challenges WHERE id = ? RETURNING id, challenge, ceremony, user_id, expires_at`,
      args: [id],
    });
    const r = res.rows[0] as Record<string, unknown> | undefined;
    if (!r) return null;
    const userId = r.user_id as string | null;
    return {
      id: r.id as string,
      challenge: r.challenge as string,
      ceremony: r.ceremony as 'registration' | 'authentication',
      ...(userId ? { userId } : {}),
      expiresAt: Number(r.expires_at),
    };
  },

  async getCredential(credentialId: string): Promise<StoredCredential | null> {
    const res = await client.execute({
      sql: `SELECT credential_id, user_id, public_key, counter, transports
              FROM passkey_credentials WHERE credential_id = ?`,
      args: [credentialId],
    });
    const r = res.rows[0] as Record<string, unknown> | undefined;
    return r ? rowToCredential(r) : null;
  },

  async listCredentialsByUser(userId: string): Promise<StoredCredential[]> {
    const res = await client.execute({
      sql: `SELECT credential_id, user_id, public_key, counter, transports
              FROM passkey_credentials WHERE user_id = ? ORDER BY created_at`,
      args: [userId],
    });
    return (res.rows as unknown as Record<string, unknown>[]).map(rowToCredential);
  },

  async saveCredential(c: StoredCredential): Promise<void> {
    await client.execute({
      sql: `INSERT INTO passkey_credentials (credential_id, user_id, public_key, counter, transports)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        c.credentialId,
        c.userId,
        c.publicKey,
        c.counter,
        c.transports ? JSON.stringify(c.transports) : null,
      ],
    });
  },

  async updateCredentialCounter(credentialId: string, counter: number): Promise<void> {
    await client.execute({
      sql: `UPDATE passkey_credentials SET counter = ?, last_used_at = datetime('now')
             WHERE credential_id = ?`,
      args: [counter, credentialId],
    });
  },
};

/**
 * Udløbne challenges ryddes ved boot. De er kortlivede (5 min), men en række
 * der aldrig blev hentet — brugeren lukkede fanen midt i en registrering —
 * bliver ellers liggende for evigt. Ikke en sikkerhedssag; en oprydning.
 */
export async function purgeExpiredChallenges(now: number = Date.now()): Promise<number> {
  const res = await client.execute({
    sql: `DELETE FROM passkey_challenges WHERE expires_at < ?`,
    args: [now],
  });
  return res.rowsAffected;
}
