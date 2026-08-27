/**
 * F210.4 — the repo owner's identities. THE single source; nothing else may
 * name one of these addresses as a literal.
 *
 * Christian, 2026-08-27, verbatim and not open to discussion:
 *   "JEG KAN og SKAL og MÅ være admin i ALLE tenants uanset hvilken mail jeg
 *    anvender - ikke til diskussion."
 *
 * He is the person who onboards every customer and who supplies the source
 * material their Neurons are compiled from. If he is locked out of a tenant
 * there is no second human who can administer it.
 *
 * WHY THIS LIVES IN GIT AND NOT IN AN ENV VAR: an env var that fails to load
 * — a renamed secret, a new base image, a typo — would silently strip his
 * access from his own system, and the symptom would look like a permissions
 * bug rather than a missing value. A constant in the repo cannot go missing
 * between deploys.
 *
 * Enforcement is ADDITIVE ONLY. These identities are raised to `owner`; no
 * code path here ever demotes or deletes a membership row.
 *
 * NOT an owner identity: the Lens principal minted by
 * apps/admin-server/src/lens-session.ts. It is deliberately read-only and
 * must never appear in this list.
 */

/** Every address the owner may sign in with. Lower-case; compare folded. */
export const OWNER_IDENTITIES = [
  'cb@webhouse.dk',
  'christian@broberg.dk',
  'christian@broberg.ai',
] as const;

export type OwnerIdentity = (typeof OWNER_IDENTITIES)[number];

/**
 * True when `email` is one of the owner's identities.
 *
 * Case- and whitespace-insensitive: an OAuth provider may hand back
 * `CB@Webhouse.DK`, and a case-sensitive compare would lock him out on a
 * detail he cannot see or control.
 */
export function isOwnerIdentity(email: string | null | undefined): boolean {
  if (!email) return false;
  const folded = email.trim().toLowerCase();
  return (OWNER_IDENTITIES as readonly string[]).includes(folded);
}

/**
 * The identities as a SQL literal list, e.g. `'a@b.dk','c@d.dk'`.
 *
 * For the boot-time backfill, which runs raw SQL against control.db before
 * any ORM is available. Safe by construction: the values are compile-time
 * constants in this file, never user input — but the assertion below refuses
 * to build a fragment from anything containing a quote, so a future edit that
 * pastes in a hostile string fails loudly instead of silently.
 */
export function ownerIdentitiesSqlList(): string {
  for (const id of OWNER_IDENTITIES) {
    if (/['"\;]/.test(id)) {
      throw new Error(`owner identity contains a quote and cannot be inlined: ${id}`);
    }
  }
  return OWNER_IDENTITIES.map((e) => `'${e}'`).join(',');
}
