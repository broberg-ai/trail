/**
 * F235 — lifetimes that BOTH the code and the letter need to know.
 *
 * `MAGIC_LINK_TTL_MIN` lived in auth.ts, again as the free text "15 minutes"
 * in email.ts's letter, and a third time in the mail template submitted to
 * cardmem. Three copies of one fact — and the two a customer actually READS
 * were the ones nothing would ever catch. Change the TTL and the letter keeps
 * confidently stating the old number.
 *
 * Its own module rather than an export from auth.ts, because auth.ts imports
 * sendMagicLink from email.ts: reading the constant from there would close an
 * import cycle. It would happen to work today (the value is only read inside a
 * function, after both modules have evaluated) and break the first time
 * somebody reads it at module scope. A cycle that works by luck is worse than
 * one that fails, because nothing marks it.
 */

/** How long a magic link stays valid. Stated in the letter, enforced in auth. */
export const MAGIC_LINK_TTL_MIN = 15;
