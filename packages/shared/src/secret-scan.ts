/**
 * F197 — secret-scan gate. Single source of truth for the credential patterns
 * Trail redacts before any Neuron is committed (the second-brain safeguard).
 *
 * `redactSecrets(text)` replaces every matched secret with `[REDACTED:<label>]`
 * and reports what it found. It is PURE + deterministic (regex/string only, no
 * deps) so the engine's write gate, a future admin preview UI, and any other
 * consumer all share the exact same detection.
 *
 * Design choices:
 * - Pattern-based, NOT entropy/generic-randomness — a redacted real fact would
 *   corrupt knowledge, so we accept missing an exotic token over false positives.
 * - Order matters: most-specific patterns run first (e.g. `sk-ant-` before the
 *   generic OpenAI `sk-`), because each match is consumed before the next runs.
 * - Redact, never reject — the surrounding knowledge survives; only the
 *   credential substring is neutralised.
 *
 * Adding a provider = append one entry below (F197.2 will add a self-service UI
 * so a sample key can be turned into a detector from Settings).
 */

export interface SecretPattern {
  /** stable id shown in the redaction marker + findings */
  label: string;
  /** human description of what this matches */
  description: string;
  /** global regex (used for replace-all + counting) */
  regex: RegExp;
}

/** Ordered most-specific → least. Every regex carries the `g` flag. */
export const SECRET_PATTERNS: SecretPattern[] = [
  {
    label: 'private-key',
    description: 'PEM private key block (RSA/EC/OPENSSH/DSA/PGP)',
    regex:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  {
    label: 'anthropic-api-key',
    description: 'Anthropic API key (sk-ant-…)',
    regex: /sk-ant-(?:api03-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    label: 'openai-api-key',
    description: 'OpenAI API key (sk-… / sk-proj-…)',
    regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    label: 'google-api-key',
    description: 'Google / Gemini API key (AIza…)',
    regex: /AIza[0-9A-Za-z_-]{35}/g,
  },
  {
    label: 'google-oauth-secret',
    description: 'Google OAuth client secret (GOCSPX-…)',
    regex: /GOCSPX-[A-Za-z0-9_-]{28}/g,
  },
  {
    label: 'aws-access-key-id',
    description: 'AWS access key id (AKIA…)',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    label: 'github-token',
    description: 'GitHub token (ghp_/gho_/ghs_/ghu_/ghr_…)',
    regex: /\bgh[posru]_[A-Za-z0-9]{36,}\b/g,
  },
  {
    label: 'gitlab-token',
    description: 'GitLab personal access token (glpat-…)',
    regex: /\bglpat-[A-Za-z0-9_-]{20,}/g,
  },
  {
    label: 'slack-token',
    description: 'Slack token (xox[baprs]-…)',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    label: 'stripe-secret-key',
    description: 'Stripe live secret/restricted key (sk_live_/rk_live_…)',
    regex: /\b[rs]k_live_[A-Za-z0-9]{20,}/g,
  },
  {
    // Resend email API key (re_…). Lookahead requires a digit in the body so
    // we don't redact long snake_case identifiers like re_compute_the_thing.
    label: 'resend-api-key',
    description: 'Resend API key (re_ + token)',
    regex: /\bre_(?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]{24,}\b/g,
  },
  {
    label: 'fly-api-token',
    description: 'Fly.io API token (FlyV1 fm2_… / fo1_…)',
    regex: /(?:FlyV1 fm2_[A-Za-z0-9+/=_-]{20,}|\bfo1_[A-Za-z0-9_-]{20,})/g,
  },
  {
    label: 'jwt',
    description: 'JSON Web Token (eyJ….eyJ….…)',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    // Tightened per upmetrics (#4325): genApiKey = randomBytes(24).hex → uk_ + exactly 48 lowercase hex.
    label: 'upmetrics-key',
    description: 'Upmetrics project key (uk_ + 48 hex)',
    regex: /\buk_[0-9a-f]{48}/g,
  },
  {
    label: 'cardmem-key',
    description: 'Cardmem personal/incident/project key (pa_/pi_/pk_…)',
    regex: /\bp[aik]_[A-Za-z0-9]{20,}/g,
  },
  {
    label: 'trail-key',
    description: 'Trail personal API key (trail_…)',
    regex: /\btrail_[A-Za-z0-9]{20,}/g,
  },
  {
    // Per cms (#4327): randomBytes(32).hex → wh_ + 64 lowercase hex (67 chars total).
    label: 'cms-access-token',
    description: 'webhouse.app CMS access token (wh_ + 64 hex)',
    regex: /\bwh_[0-9a-f]{64}/g,
  },
  {
    // Context-based catch for the prefix-less high-entropy service secrets that
    // cms + upmetrics flagged (CMS_JWT_SECRET, revalidateSecret, fleet
    // openssl-rand-hex secrets): a 40+ hex value assigned to a field whose name
    // contains secret/token/password/api-key. The name requirement keeps the
    // false-positive rate near zero (a bare 40/64-hex would hit shas/hashes).
    label: 'labeled-hex-secret',
    description: 'A 40+ hex value assigned to a secret/token/password/api-key-named field',
    regex: /\b[A-Za-z0-9_-]*(?:secret|token|password|api[_-]?key)\b\s*[:=]\s*["'`]?[0-9a-f]{40,}/gi,
  },
  {
    label: 'cloudflare-global-key',
    description: 'Cloudflare global API key (37-hex)',
    regex: /\b[0-9a-f]{37}\b/g,
  },
];

export interface RedactionFinding {
  label: string;
  count: number;
}

export interface RedactionResult {
  /** input with every secret replaced by `[REDACTED:<label>]` */
  redacted: string;
  /** per-pattern counts of what was redacted (empty = clean) */
  findings: RedactionFinding[];
}

/** Replacement marker for a redacted secret. */
export const redactionMarker = (label: string): string => `[REDACTED:${label}]`;

/**
 * Scan `text` and replace every detected secret with its redaction marker.
 * Pure: clean input returns byte-identical (`findings: []`).
 */
export function redactSecrets(text: string): RedactionResult {
  if (!text) return { redacted: text, findings: [] };
  let redacted = text;
  const findings: RedactionFinding[] = [];
  for (const p of SECRET_PATTERNS) {
    let count = 0;
    redacted = redacted.replace(p.regex, () => {
      count++;
      return redactionMarker(p.label);
    });
    if (count > 0) findings.push({ label: p.label, count });
  }
  return { redacted, findings };
}

/** True if `text` contains at least one detectable secret. */
export function hasSecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => {
    p.regex.lastIndex = 0;
    return p.regex.test(text);
  });
}
