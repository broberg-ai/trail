// F205.1 — what a 'partner' API key is allowed to do.
//
// WHY THIS FILE EXISTS. Until now `scope` had two meanings: 'full' (the column
// default — unrestricted) and 'ambient' (the capture device). The mint endpoint
// never set the column, so every key made in Settings → Developer was 'full'.
// The Developer page says what that means in the product's own words:
// "Personal bearer tokens that call the Trail API AS YOU". Handing one to an
// external partner hands them the tenant: every Neuron, every setting, source
// deletion, and the power to mint more keys.
//
// A partner gets a key that can do exactly one thing — upload a source document
// into exactly one knowledge base.
//
// WHY THE PACKAGE. `@broberg/apikey`'s authorize cascade is the fleet's shipped
// primitive for precisely this shape: permission × resource-filter. Hand-rolling
// a second regex allowlist next to `scopeAllows` would be re-rolling something
// that already exists (and drifting from it). `evaluateToken` is a pure,
// zero-dep function, so it slots in beside the existing auth without replacing
// any of it — the session and 'ambient' paths are untouched. Migrating 'ambient'
// onto the same cascade is a later, separate step: never a naked cutover of a
// working auth chain.
import { evaluateToken, type TokenGrant, type AuthContext } from '@broberg/apikey/authorize';

/** The scope value stored on a partner key. */
export const PARTNER_SCOPE = 'partner';

/** Resource scope name used in the grant — a partner is confined to one KB. */
const KB_RESOURCE = 'kb';

/** The only permission a partner key carries today. */
const UPLOAD_PERMISSION = 'source:upload';

/**
 * The endpoints a partner key may reach, and the permission each one demands.
 * Anything not listed here is refused — an allowlist, never a denylist, so a
 * new route is closed to partners until someone deliberately opens it.
 *
 * Note what is NOT here, and deliberately so: search, Neuron reads, the queue,
 * key minting, settings. A partner uploads and asks after its own upload; that
 * is the whole surface.
 */
const PARTNER_ROUTES: ReadonlyArray<{
  method: string;
  pattern: RegExp;
  permission: string;
}> = [
  // F205.2 — the upload itself. Note the path carries NO kbId: the target is
  // read from the key, so a partner cannot retarget by editing the URL.
  { method: 'POST', pattern: /^\/api\/v1\/partner\/sources$/, permission: UPLOAD_PERMISSION },
  // F205.3 — "did my document land?", by the partner's own external id.
  { method: 'GET', pattern: /^\/api\/v1\/partner\/sources\/[^/]+$/, permission: UPLOAD_PERMISSION },
];

/**
 * Build the stored grant for a partner key. Derived from (scope, kbId) rather
 * than persisted as JSON — there is exactly one grant shape today, and inventing
 * a column for grants we don't issue yet would be speculative. The derivation is
 * the single place to change when partners gain a second permission.
 */
export function partnerGrant(kbId: string): TokenGrant {
  return {
    permissions: [UPLOAD_PERMISSION],
    resources: [{ scope: KB_RESOURCE, effect: 'include', targets: [kbId] }],
  };
}

/**
 * Is this request allowed for a partner key bound to `kbId`?
 *
 * Returns a reason on refusal so the 403 can say WHY — an opaque denial sends a
 * partner integrator guessing, and they cannot read our source to find out.
 *
 * `kbId` null means the key is mis-provisioned (scope 'partner' with no KB
 * bound). That is refused outright rather than defaulting to something
 * permissive: a half-configured key must fail closed.
 */
export function partnerAllows(
  kbId: string | null,
  method: string,
  path: string,
): { allowed: boolean; reason?: string } {
  if (!kbId) {
    return { allowed: false, reason: 'partner key is not bound to a knowledge base' };
  }
  const route = PARTNER_ROUTES.find((r) => r.method === method && r.pattern.test(path));
  if (!route) {
    return { allowed: false, reason: 'partner keys may only upload sources' };
  }
  const ctx: AuthContext = {
    permission: route.permission,
    resource: { scope: KB_RESOURCE, target: kbId },
  };
  return evaluateToken(partnerGrant(kbId), ctx);
}
