/**
 * F212.3 — "a component that has not been restarted in a long time is not
 * stable, it is UNMEASURED" (the sanne session, 2026-08-27).
 *
 * Every deploy from 23 August onward failed in the Docker build on a
 * missing script, for two months, and nobody noticed — because a failed
 * deploy leaves the PREVIOUS version running, and a running app looks
 * exactly like a deployed app. The engine had been up since 4 July.
 *
 * IT MEASURES TIME SINCE LAST SUCCESS, NEVER SINCE LAST ATTEMPT. That
 * distinction is the whole card: attempts were happening daily the entire
 * time the deploy was broken, so an attempt-based check would have been
 * green throughout. F196's register makes this structural rather than
 * careful — `reportDeploy()` only ever POSTs `status: 'success'`, and it
 * is fired from the BOOTED app, so a row can only exist if a build
 * shipped and started.
 *
 * Measured 2026-09-20: `GET upmetrics.org/release/<site>` answers
 * `{site, sha, deployedAt}` for a known site and `{error:"no_release"}`
 * for an unknown one — and it needs no key, so the read cannot fail on a
 * missing secret.
 */
import { captureException } from '@upmetrics/sdk';
import { UPMETRICS_BASE_URL } from '@trail/shared';

/** Fourteen days — the epic's threshold. */
export const MAX_DEPLOY_AGE_DAYS = 14;

const TICK_INTERVAL_MS = Number(process.env.TRAIL_DEPLOY_FRESHNESS_INTERVAL_SECONDS ?? 86_400) * 1000;
const INITIAL_DELAY_MS = Number(process.env.TRAIL_DEPLOY_FRESHNESS_INITIAL_DELAY_SECONDS ?? 300) * 1000;

export interface ReleaseReading {
  /** ISO timestamp of the last SUCCESSFUL deploy, or null when none is known. */
  deployedAt: string | null;
  sha: string | null;
  /** Set when the register could not be read at all — UNKNOWN, not "fresh". */
  unreachable?: string;
}

export type DeployVerdict =
  | { state: 'fresh'; ageDays: number }
  | { state: 'stale'; ageDays: number; message: string }
  | { state: 'never'; message: string }
  | { state: 'unknown'; message: string };

/**
 * Judge a reading. Pure, so both the boundary (13.9 vs 14.1 days) and the
 * two "cannot tell" cases can be driven without a network.
 *
 * `unknown` is deliberately its OWN state and still alarms: a register we
 * cannot reach is not evidence that the deploy is fine, and treating it as
 * fine is how a check goes silently green when its own dependency breaks.
 */
export function judgeRelease(
  reading: ReleaseReading,
  opts: { site: string; now?: Date; maxAgeDays?: number } = { site: 'unknown' },
): DeployVerdict {
  const now = opts.now ?? new Date();
  const maxAgeDays = opts.maxAgeDays ?? MAX_DEPLOY_AGE_DAYS;

  if (reading.unreachable) {
    return {
      state: 'unknown',
      message: `[F212.3] cannot tell when ${opts.site} last deployed: ${reading.unreachable}`,
    };
  }
  if (!reading.deployedAt) {
    return {
      state: 'never',
      message: `[F212.3] no successful deploy has ever been recorded for ${opts.site}`,
    };
  }
  const at = Date.parse(reading.deployedAt);
  if (!Number.isFinite(at)) {
    return {
      state: 'unknown',
      message: `[F212.3] the deploy register returned an unreadable date for ${opts.site}`,
    };
  }
  const ageDays = (now.getTime() - at) / 86_400_000;
  if (ageDays > maxAgeDays) {
    return {
      state: 'stale',
      ageDays: Math.round(ageDays * 10) / 10,
      // No live age in the text — the issue title freezes at the first
      // event (measured; see disk-guard.ts's header), so "17 days" would
      // still be there at 60. The threshold is stable, the age is a tag.
      message: `[F212.3] no successful deploy of ${opts.site} in over ${maxAgeDays} days`,
    };
  }
  return { state: 'fresh', ageDays: Math.round(ageDays * 10) / 10 };
}

export async function readRelease(site: string, baseUrl?: string): Promise<ReleaseReading> {
  const base = baseUrl ?? process.env.UPMETRICS_BASE_URL ?? UPMETRICS_BASE_URL;
  try {
    const res = await fetch(`${base}/release/${encodeURIComponent(site)}`, {
      signal: AbortSignal.timeout(8_000),
    });

    // READ THE BODY EVEN ON A NON-2xx. Measured against the live register
    // 2026-09-20: `no_release` comes back with HTTP **404** and the JSON
    // body `{"error":"no_release","site":"…"}`. The first version of this
    // function checked `res.ok` first and reported "cannot tell" for a site
    // that had simply never deployed.
    //
    // Both states alarm, so nothing went silently green — but they have
    // DIFFERENT remedies, and this function's own tests assert that the
    // distinction is kept: "never deployed" points at a wrong site name,
    // "cannot tell" points at Upmetrics being down. Collapsing them sends
    // whoever reads the issue to the wrong place.
    // Named rather than `as typeof body`: that annotation refers to the
    // variable being declared, so TypeScript collapsed the parsed value to
    // `never` and every field read below became an error.
    type ReleaseBody = { deployedAt?: string; sha?: string; error?: string };
    let body: ReleaseBody | null = null;
    try {
      body = (await res.json()) as ReleaseBody;
    } catch {
      // No JSON at all — then the status IS the only thing we know.
      return { deployedAt: null, sha: null, unreachable: `HTTP ${res.status} (no JSON body)` };
    }

    // `no_release` is a real answer, not a failure: the register is up and
    // says it has never seen a successful deploy for this site.
    if (body?.error === 'no_release') return { deployedAt: null, sha: null };
    if (body?.error) return { deployedAt: null, sha: null, unreachable: body.error };
    if (!res.ok) return { deployedAt: null, sha: null, unreachable: `HTTP ${res.status}` };
    return { deployedAt: body?.deployedAt ?? null, sha: body?.sha ?? null };
  } catch (err) {
    return {
      deployedAt: null,
      sha: null,
      unreachable: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runDeployFreshnessCheck(site: string): Promise<DeployVerdict> {
  const reading = await readRelease(site);
  const verdict = judgeRelease(reading, { site });
  if (verdict.state === 'fresh') {
    console.log(`[deploy-freshness] ${site} last deployed ${verdict.ageDays}d ago (${reading.sha})`);
    return verdict;
  }
  console.error(`[deploy-freshness] ${verdict.message}`);
  captureException(new Error(verdict.message), {
    tags: {
      feature: 'F212.3',
      state: verdict.state,
      site,
      ...('ageDays' in verdict ? { age_days: `${Math.floor(verdict.ageDays)}` } : {}),
    },
  });
  return verdict;
}

export function startDeployFreshness(): () => void {
  const site = process.env.UPMETRICS_SITE;
  if (!site) {
    // Ship dark. UPMETRICS_SITE is what names the surface in the register;
    // without it there is nothing to ask about, and guessing a site name
    // would alarm about a site that does not exist.
    console.log('  deploy-freshness: disabled (UPMETRICS_SITE not set)');
    return () => {};
  }

  let stopped = false;
  const check = () => {
    if (stopped) return;
    void runDeployFreshnessCheck(site).catch((err: unknown) => {
      console.error(
        `[deploy-freshness] check threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const first = setTimeout(check, INITIAL_DELAY_MS);
  const interval = setInterval(check, TICK_INTERVAL_MS);

  console.log(
    `  deploy-freshness: ${site}, alarm over ${MAX_DEPLOY_AGE_DAYS}d, ` +
      `tick every ${Math.round(TICK_INTERVAL_MS / 3_600_000)}h`,
  );

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(interval);
  };
}
