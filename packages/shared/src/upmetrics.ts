/**
 * Single source of truth for the Upmetrics DSN (fleet error-telemetry).
 *
 * This is a PUBLIC Sentry-style DSN — it ships inside the browser bundle and
 * is safe to commit. Per the "én kilde, trickle ned" rule it lives in exactly
 * ONE file and is imported by every consumer (admin SPA, admin-server, every
 * engine) instead of being hard-coded into fly.toml [env] / .env files. Every
 * app — and every future engine-NNN — inherits it automatically by compiling
 * this constant in; there is no per-app/per-engine config or secret to set.
 */
export const UPMETRICS_DSN = 'https://473187ffbb6aa1bee4eb3d60e469f525@upmetrics.org/trail';

/** Public base for upmetrics' HTTP API (cost read-API, deploy-observe, …). */
export const UPMETRICS_BASE_URL = 'https://upmetrics.org';

/**
 * F196 — self-report a successful deploy to upmetrics' deploy-observe API
 * (one terminal `success` POST per app, fired on boot). Fire-and-forget +
 * fail-soft: it never throws into a boot path and no-ops when the key or site
 * is unset (so local dev never POSTs).
 *
 * Why on-boot and not from the ship script: `UPMETRICS_API_KEY` lives only as a
 * prod Fly secret (write-only) and our deploys run locally without it — so the
 * deployed app, which already has the key in its env, reports itself. No secret
 * leaves prod.
 *
 * Contract locked with upmetrics (#4223): `site` = the deployed surface,
 * `deploy_id = ${sha}-${site}` (idempotent; upmetrics merges on (project,
 * deploy_id) so a re-POST on restart never resets sha/originator),
 * `originator = "trail"` so the relay can ping this session when a deploy goes
 * green. Verify via `GET {base}/release/{site}`.
 *
 * Env (set per-app in fly.toml [env] + the UPMETRICS_API_KEY Fly secret):
 *   UPMETRICS_API_KEY    — per-project key. Unset → no-op.
 *   UPMETRICS_SITE       — this app's surface (e.g. app.trailmem.com). Unset → no-op.
 *   GIT_SHA              — baked at build time via build-arg. Defaults to "unknown".
 *   UPMETRICS_ORIGINATOR — defaults to "trail".
 *   UPMETRICS_BASE_URL   — overrides the constant above.
 */
export async function reportDeploy(): Promise<void> {
  // Read env via globalThis so this stays dependency-free (no @types/node in
  // the runtime-agnostic shared package); it runs on Bun where process exists.
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const key = env.UPMETRICS_API_KEY;
  const site = env.UPMETRICS_SITE;
  if (!key || !site) return; // dormant until both are configured

  const sha = env.GIT_SHA ?? 'unknown';
  const base = env.UPMETRICS_BASE_URL ?? UPMETRICS_BASE_URL;
  const originator = env.UPMETRICS_ORIGINATOR ?? 'trail';

  // F196.5 — say it out loud when this deploy cannot name its own commit.
  //
  // Every piece of F196 works, but the ONE path where it silently does not
  // looks exactly like the path where it does: `flyctl deploy` by hand is the
  // same command as `pnpm ship:*` minus `--build-arg GIT_SHA`, with the same
  // green output and the same successful report. The Dockerfile's
  // `ARG GIT_SHA=unknown` default then wins and the register records a deploy
  // that cannot be traced to a commit.
  //
  // Measured 2026-08-29: the engine sat on sha="unknown" for four hours, and
  // when a fix had to be proven live on production the register — the only
  // outside view of what is running, since /health and /version both 404 —
  // could not answer. The fix WAS live; it could not be shown to be.
  //
  // The report still goes out. A deploy that happened must always be recorded:
  // trading a vague row for NO row is strictly worse, and this is telemetry, so
  // it may degrade but must never block or vanish. The warning is the part that
  // reaches a human.
  if (!env.GIT_SHA || sha === 'unknown') {
    console.warn(
      `[deploy] WARN ${site}: GIT_SHA is unset — reporting sha="unknown", so this ` +
        `deploy cannot be traced to a commit. Deploy with \`pnpm ship:*\` (it passes ` +
        `--build-arg GIT_SHA), not a bare \`flyctl deploy\`.`,
    );
  }

  try {
    await fetch(`${base}/api/deploys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upmetrics-Key': key },
      body: JSON.stringify({
        site,
        deploy_id: `${sha}-${site}`,
        status: 'success',
        sha,
        originator,
        provider: 'fly',
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // boot must never fail on telemetry — swallow timeout/network/parse
  }
}
