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

/**
 * F285 — is THIS request the user navigating, or the browser fetching an
 * asset on its own?
 *
 * MEASURED ON PRODUCTION 20/9 2026, reported by the owner. He logged in and
 * landed on an in-app 404 at `/favicon.ico`:
 *
 *   GET /favicon.ico   (Sec-Fetch-Dest: image)
 *   → set-cookie: trail-return-to=%2Ffavicon.ico
 *
 * The SPA catch-all recorded EVERY unauthenticated path as "where the user was
 * headed", and the browser requests `/favicon.ico` by itself — no one clicked
 * it. Because that fetch rides alongside the document request, last-writer-wins
 * overwrote the real destination, and the post-login resume sent him to a path
 * with no route behind it.
 *
 * `safeReturnPath` could not catch this: it answers "is this path SAFE to
 * redirect to" (open-redirect defence), and `/favicon.ico` is perfectly safe.
 * The missing question is a different one — "did a HUMAN ask for this?" — and
 * it is answerable only from the request's own headers.
 *
 * `Sec-Fetch-Dest` is the direct answer and every current browser sends it:
 * `document` for a navigation, `image`/`style`/`script`/`font`/… for a
 * subresource. When it is absent (an old client, curl, a proxy that strips it)
 * we fall back to `Accept: text/html`, which a navigation sends and an image
 * fetch does not.
 *
 * FAIL-OPEN ON PURPOSE when NEITHER header is present: a request we cannot
 * classify is more likely a real navigation from an unusual client than a
 * stray asset fetch, and the cost of being wrong is asymmetric — a missed
 * deep-link is an inconvenience, while refusing every unclassifiable
 * navigation would silently break post-login resume for that client.
 */
export function isDocumentNavigation(headers: {
  secFetchDest?: string | null;
  accept?: string | null;
}): boolean {
  const dest = headers.secFetchDest?.trim().toLowerCase();
  if (dest) {
    // `empty` is fetch()/XHR — not a navigation. Everything that is not
    // explicitly a document is refused once the header is present, so a new
    // destination value added by some future browser cannot silently pass.
    return dest === 'document';
  }
  const accept = headers.accept?.trim().toLowerCase();
  if (accept) return accept.includes('text/html');
  return true; // neither header — see the fail-open note above
}

/**
 * The path to remember for post-login resume, or null.
 *
 * Both questions in one place, so a caller cannot answer one and forget the
 * other: is it SAFE (open-redirect), and did a HUMAN ask for it.
 */
export function returnPathForRequest(input: {
  pathWithSearch: string;
  secFetchDest?: string | null;
  accept?: string | null;
}): string | null {
  if (!isDocumentNavigation(input)) return null;
  return safeReturnPath(input.pathWithSearch);
}
