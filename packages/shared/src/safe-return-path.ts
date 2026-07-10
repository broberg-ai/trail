/**
 * F201.17 — validate a post-login `returnTo` path.
 *
 * The Ambient app (and any deep-link) sends a logged-out user through the
 * `/login` gate; we preserve the intended path in a `trail-return-to` cookie and
 * navigate there once the SPA boots authenticated. That path is attacker-
 * influenceable (it rides in a cookie / query), so it MUST be validated before
 * use as a redirect target — otherwise it is a classic open-redirect.
 *
 * Accept ONLY a same-origin absolute path (starts with a single `/`). Reject:
 *   - non-strings / empty
 *   - protocol-relative `//host` and backslash tricks `/\host` (→ off-site)
 *   - absolute URLs (`http://`, any `scheme:`)
 *   - control characters / newlines (header/redirect splitting)
 *   - the login/api/auth surfaces (would loop or hit non-page routes)
 *   - absurdly long values
 *
 * Returns the path unchanged when safe, else null (caller falls back to its
 * default landing).
 */
const MAX_LEN = 1024;

/** True if the string contains any C0 control char or DEL (0x00–0x1f, 0x7f). */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const p = raw;
  if (p.length === 0 || p.length > MAX_LEN) return null;
  // Must be an absolute path, not a protocol-relative or backslash-smuggled URL.
  if (p[0] !== '/') return null;
  if (p[1] === '/' || p[1] === '\\') return null;
  // No control chars (incl. CR/LF/TAB) — blocks redirect/header splitting.
  if (hasControlChar(p)) return null;
  // No scheme anywhere (http://, javascript:, data:) and no stray backslashes.
  if (p.includes('\\') || p.includes('://') || /^\/[^/]*:/.test(p)) return null;
  // Don't bounce back into the login/api/auth surfaces (loop / non-page).
  const lower = p.toLowerCase();
  if (lower === '/login' || lower.startsWith('/login?') || lower.startsWith('/login/')) return null;
  if (lower.startsWith('/api/') || lower.startsWith('/api?') || lower === '/api') return null;
  if (lower.startsWith('/auth/') || lower.startsWith('/auth?') || lower === '/auth') return null;
  return p;
}
