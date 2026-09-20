/**
 * F210.1 — ONE source for "who am I and which tenants can I reach".
 *
 * `/api/auth/me` used to be fetched twice, into two independent useState
 * copies: the shell in app.tsx (which feeds the top-bar tenant switcher) and
 * the Tenants panel. Creating a tenant refreshed only the panel's copy, so
 * Lens measured the two surfaces disagreeing on screen — the table listed
 * three tenants and marked the new one CURRENT while the switcher pill still
 * said "Broberg.ai" and its dropdown still counted 2.
 *
 * That is worse than a stale list: the switcher is where a user READS which
 * customer they are working in, so two answers on one screen invites doing
 * work in the wrong tenant.
 *
 * A signal instead of a fetch-per-consumer, so a refresh anywhere reaches
 * every reader. Mirrors lib/jobs-store.ts.
 */
import { signal } from '@preact/signals';
import { fetchAuthMe, type AuthMe } from '../api';

/** null = not loaded yet (or not signed in). */
export const authMe = signal<AuthMe | null>(null);

/**
 * Re-read from the server and publish to every reader.
 *
 * Deliberately NOT a local merge of the new tenant: the switcher must show
 * what the server actually stored, which is the only thing that proves the
 * create persisted.
 */
export async function refreshAuthMe(): Promise<AuthMe> {
  const fresh = await fetchAuthMe();
  authMe.value = fresh;
  return fresh;
}
