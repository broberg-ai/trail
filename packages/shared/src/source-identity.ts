/**
 * F275.1 — what IS a source, across its editions?
 *
 * The owner's rule: "if the source — a URL on a website — stays the same, then
 * the latest edition should be canon." The rule can only be built once we can say
 * WHICH source two editions are editions OF.
 *
 * ## The prefix is not decoration
 *
 * `url:` · `path:` · `fp:` keep three identity SPACES apart. Without them a file
 * path and a URL could collide, and the collision would look like "same source" —
 * that is, the one error this whole feature exists to avoid, produced by its own
 * field.
 *
 * ## Why not just the filename
 *
 * Because it is wrong in BOTH directions, measured as an argument rather than
 * asserted:
 *
 *   same file, new name      filename: new source ✗   identity: same ✓
 *   two files, same name     filename: same ✗         identity: different ✓
 *
 * Two sites can both serve `index.md`.
 *
 * ## The third state
 *
 * `null` means "we do not know" — NEVER "there is no source". The caller must be
 * able to tell them apart, because a supersession rule that reads "unknown" as
 * "new source" would stay silent about exactly the cases it exists for.
 */

/** Identity spaces. New spaces are added here, never ad hoc at a call site. */
export const IDENTITY_SPACES = ['url', 'path', 'fp'] as const;
export type IdentitySpace = (typeof IDENTITY_SPACES)[number];

/**
 * Build a source identity. Returns `null` when the value is empty — an empty
 * identity is not an identity, and a prefix in front of nothing would look valid
 * in every single comparison.
 */
export function sourceIdentity(space: IdentitySpace, value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  return `${space}:${space === 'url' ? normaliseUrl(v) : v}`;
}

/**
 * Bring a URL to ONE form, so two spellings of the same page are one identity.
 *
 * MEASURED 17 Sept in broberg.ai, inside the feature's own key: the same page was
 * stored under TWO identities —
 *
 *   url:https://broberg.ai/indsigter/design-i-højere-luftlag
 *   url:https://broberg.ai/indsigter/design-i-h%C3%B8jere-luftlag
 *
 * — one written by the source side, one by the Neuron side. As strings they
 * differ, so supersession would have treated an edit of that page as a foreign
 * source: precisely the error all of F275 exists to remove, occurring in the very
 * field meant to remove it. 1 of 114 today — but that page was the one the owner
 * asked to have recompiled, so the rate says nothing about how much it matters.
 *
 * WE USE THE BROWSER'S OWN RULE (`new URL().href`) rather than our own decoding.
 * It does exactly the right thing, and — more importantly — it refrains from
 * doing the wrong thing: `%2F` does NOT become `/`, because that would change the
 * meaning of the path. The host is lowercased (hosts are case-insensitive) while
 * the path keeps its capitals (paths ARE case-sensitive). A hand-rolled
 * `unquote()` would have got both halves wrong.
 *
 * IF IT THROWS, WE KEEP THE STRING AS IT IS. A value that is not a URL is still
 * an identity — just not one we can normalise. Dropping it would turn "could not
 * be normalised" into "has no source", and those two must never be confusable.
 */
export function normaliseUrl(v: string): string {
  try {
    return new URL(v).href;
  } catch {
    return v;
  }
}

/** Split an identity back apart. `null` when the string carries no known space. */
export function readIdentity(id: string | null | undefined): { space: IdentitySpace; value: string } | null {
  if (!id) return null;
  const i = id.indexOf(':');
  if (i <= 0) return null;
  const space = id.slice(0, i) as IdentitySpace;
  if (!IDENTITY_SPACES.includes(space)) return null;
  const value = id.slice(i + 1);
  return value ? { space, value } : null;
}

/**
 * Derive a source's identity from its metadata.
 *
 * MEASURED 16 Sept: 66 of 70 raw sources in broberg.ai already carry
 * `metadata.sourceUrl` — the identity EXISTED, it simply had no field to live in.
 * The remaining 4 are uploads and belong to F275.6's fingerprint; until then they
 * get `null`, which is true rather than guessed.
 */
export function identityFromMetadata(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const p = JSON.parse(metadata) as { sourceUrl?: unknown };
    if (typeof p?.sourceUrl === 'string') return sourceIdentity('url', p.sourceUrl);
  } catch { /* not JSON — then it carries no identity */ }
  return null;
}
