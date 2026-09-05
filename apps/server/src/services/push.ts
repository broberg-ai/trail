/**
 * F247.3 — Web-push til Trail admin-PWA'en, via @broberg/webpush (flådens
 * primitiv — aldrig en håndrullet web-push-integration, F217).
 *
 * Ship-dark: uden VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT i env er
 * senderen inert (status !== 'ready') — ingen crash, config-endpointet svarer
 * { publicKey: null } og UI'et viser "ikke sat op".
 *
 * Fire typer (ejeren delegerede valget, dokumenteret på trail-F247.3):
 *   queue  — ny kandidat landet PENDING i køen
 *   ingest — en kilde færdig-kompileret eller fejlet
 *   lint   — lint-pass med nye fund
 *   system — drift (backup-fejl o.l.)
 *
 * Prefs er pr. BRUGER (én række pr. bruger i tenant-DB'en); abonnementer pr.
 * enhed. Prune-kontrakten fra @broberg/webpush: slet KUN `dead`-endpoints
 * (404/410) — aldrig `failed` (forkert VAPID ville ellers slette alle).
 */
import { createPushSender, type PushMessage } from '@broberg/webpush';
import { pushSubscriptions, pushPrefs, type TrailDatabase } from '@trail/db';
import { eq, and, inArray } from 'drizzle-orm';

export type PushType = 'queue' | 'ingest' | 'lint' | 'system';

export interface PushPrefsShape {
  queue: boolean;
  ingest: boolean;
  lint: boolean;
  system: boolean;
}

/** Alle typer til pr. default — en ny abonnent har bedt om notifikationer. */
export const DEFAULT_PUSH_PREFS: PushPrefsShape = {
  queue: true,
  ingest: true,
  lint: true,
  system: true,
};

type Sender = ReturnType<typeof createPushSender>;

let cachedSender: Sender | null | undefined;

/** Én sender pr. proces. `null` = ikke konfigureret (ship dark). */
export function getPushSender(): Sender | null {
  if (cachedSender !== undefined) return cachedSender;
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  const subject = process.env.VAPID_SUBJECT ?? '';
  if (!publicKey || !privateKey || !subject) {
    console.log('[push] VAPID-nøgler ikke sat — web-push er slukket (ship dark)');
    cachedSender = null;
    return null;
  }
  const sender = createPushSender({ publicKey, privateKey, subject });
  if (sender.status !== 'ready') {
    console.error(`[push] sender ikke klar: ${sender.statusReason ?? sender.status} — web-push slukket`);
    cachedSender = null;
    return null;
  }
  cachedSender = sender;
  return sender;
}

/** Test-hook: nulstil sender-cachen (env kan være ændret i en test). */
export function resetPushSenderForTest(): void {
  cachedSender = undefined;
}

export function parsePrefs(raw: string | null | undefined): PushPrefsShape {
  if (!raw) return { ...DEFAULT_PUSH_PREFS };
  try {
    const p = JSON.parse(raw) as Partial<PushPrefsShape>;
    return {
      queue: p.queue !== false,
      ingest: p.ingest !== false,
      lint: p.lint !== false,
      system: p.system !== false,
    };
  } catch {
    return { ...DEFAULT_PUSH_PREFS };
  }
}

export async function readPrefs(trail: TrailDatabase, userId: string): Promise<PushPrefsShape> {
  const row = await trail.db
    .select({ prefs: pushPrefs.prefs })
    .from(pushPrefs)
    .where(eq(pushPrefs.userId, userId))
    .get();
  return parsePrefs(row?.prefs);
}

/**
 * Find modtagerne for én hændelses-type i én tenant: alle abonnerede enheder
 * hvis EJERS prefs har typen slået til (ingen prefs-række = alle typer til).
 */
export async function recipientsFor(
  trail: TrailDatabase,
  tenantId: string,
  type: PushType,
): Promise<Array<{ endpoint: string; keys: { p256dh: string; auth: string } }>> {
  const subs = await trail.db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      userId: pushSubscriptions.userId,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.tenantId, tenantId))
    .all();
  if (subs.length === 0) return [];

  const userIds = [...new Set(subs.map((s) => s.userId))];
  const prefRows = await trail.db
    .select({ userId: pushPrefs.userId, prefs: pushPrefs.prefs })
    .from(pushPrefs)
    .where(inArray(pushPrefs.userId, userIds))
    .all();
  const prefsByUser = new Map(prefRows.map((r) => [r.userId, parsePrefs(r.prefs)]));

  return subs
    .filter((s) => (prefsByUser.get(s.userId) ?? DEFAULT_PUSH_PREFS)[type])
    .map((s) => ({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }));
}

/** Distinkte tenant-id'er med mindst ét abonnement i denne DB (til system-beskeder). */
export async function distinctSubscriptionTenants(trail: TrailDatabase): Promise<string[]> {
  const rows = await trail.db
    .select({ tenantId: pushSubscriptions.tenantId })
    .from(pushSubscriptions)
    .all();
  return [...new Set(rows.map((r) => r.tenantId))];
}

/**
 * Send en push til alle relevante abonnenter i tenanten. Fire-and-forget-
 * venlig: fejler aldrig ud til kaldestedet, pruner døde endpoints.
 */
export async function notifyPush(
  trail: TrailDatabase,
  tenantId: string,
  type: PushType,
  message: PushMessage,
): Promise<void> {
  try {
    const sender = getPushSender();
    if (!sender) return;
    const recipients = await recipientsFor(trail, tenantId, type);
    if (recipients.length === 0) return;
    const result = await sender.send(recipients, { tag: `trail-${type}`, ...message });
    if (result.dead.length > 0) {
      // KUN dead (404/410) må slettes — aldrig failed.
      await trail.db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.tenantId, tenantId),
            inArray(pushSubscriptions.endpoint, result.dead),
          ),
        )
        .run();
      console.log(`[push] prunede ${result.dead.length} døde abonnement(er)`);
    }
    if (result.allFailed && result.failed.length > 0) {
      console.error(
        `[push] ALLE ${result.failed.length} sendinger fejlede (${result.failed[0]?.kind}): ${result.failed[0]?.reason}`,
      );
    }
  } catch (err) {
    console.error('[push] send-fejl (ignoreret — push må aldrig vælte kaldestedet):', err);
  }
}
