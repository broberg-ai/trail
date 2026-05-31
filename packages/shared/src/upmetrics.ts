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
