/**
 * F212.3 — watch the number that filled the disk while nobody looked.
 *
 * On 2026-08-27 the engine's volume went from ~40 % in June to 99.8 % in
 * August and crash-looped for 75 minutes on SQLITE_FULL. Nothing watched
 * it climb; the first notification anyone got was users hitting a dead app.
 *
 * `statfsSync`, not a shell-out and not a figure read once at boot. The
 * outage happened to a process that had been up since 4 July on
 * already-open file handles — it could not see that the filesystem had no
 * room left. So the check has to ask the filesystem, every time.
 *
 * WHY THE MESSAGE CARRIES THE BAND AND NOT THE PERCENTAGE. Measured
 * against the live Upmetrics API on 2026-09-20, twice:
 *
 *   3 identical errors from one call site   → 1 issue
 *   3 DIFFERENT errors from one call site   → 1 issue, and the title is
 *                                             the FIRST event's text
 *
 * The grouping is what gives us "one open issue, not one per hour" for
 * free. But it also means a title containing a momentary number FREEZES:
 * an issue first raised at 91 % would still read "disk 91 %" when the
 * volume is at 99 %. That is an alarm making a stale claim, which is the
 * exact failure this epic exists to remove. So the message names the
 * BAND and the THRESHOLD ("over 90 % used"), the live figure goes in the
 * tags and the log line, and the issue stays honest however long it is open.
 */
import { statfsSync } from 'node:fs';
import { captureException } from '@upmetrics/sdk';

/** Warn at 80 %, critical at 90 % — the epic's own thresholds. */
export const WARN_PERCENT = 80;
export const CRITICAL_PERCENT = 90;

const TICK_INTERVAL_MS = Number(process.env.TRAIL_DISK_GUARD_INTERVAL_SECONDS ?? 3600) * 1000;
const INITIAL_DELAY_MS = Number(process.env.TRAIL_DISK_GUARD_INITIAL_DELAY_SECONDS ?? 60) * 1000;

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
}

export type DiskBand = 'ok' | 'warning' | 'critical';

/**
 * Read real free space. Separated from the banding so the thresholds can
 * be driven by INJECTED figures — a test must not need a full disk.
 */
export function readDiskUsage(path: string): DiskUsage {
  const s = statfsSync(path);
  const totalBytes = s.blocks * s.bsize;
  // bavail = blocks available to an UNPRIVILEGED writer, which is what the
  // engine is. bfree counts the root-reserved slack too and would report
  // headroom this process cannot actually use.
  const freeBytes = s.bavail * s.bsize;
  const usedPercent = totalBytes > 0 ? 100 * (1 - freeBytes / totalBytes) : 0;
  return { totalBytes, freeBytes, usedPercent };
}

/**
 * Which band is this usage in? `>` and not `>=` on purpose: 80.0 % exactly
 * is not yet a warning, and the boundary has its own test in both
 * directions so a later `>=` cannot slip in unnoticed.
 */
export function bandOf(usedPercent: number): DiskBand {
  if (usedPercent > CRITICAL_PERCENT) return 'critical';
  if (usedPercent > WARN_PERCENT) return 'warning';
  return 'ok';
}

export interface DiskAlarm {
  band: Exclude<DiskBand, 'ok'>;
  /** Stable across readings in the same band — see the fingerprint note above. */
  message: string;
  usedPercent: number;
  freeBytes: number;
}

export function diskAlarmFor(path: string, usage: DiskUsage): DiskAlarm | null {
  const band = bandOf(usage.usedPercent);
  if (band === 'ok') return null;
  const threshold = band === 'critical' ? CRITICAL_PERCENT : WARN_PERCENT;
  return {
    band,
    // No live percentage in here. See the header: the issue title freezes
    // at the first event, so a number would become a lie while the issue
    // is still open.
    message: `[F212.3] disk ${band}: ${path} is over ${threshold}% used`,
    usedPercent: Math.round(usage.usedPercent * 100) / 100,
    freeBytes: usage.freeBytes,
  };
}

/** One reading, one decision, one alarm. Exported so a probe can drive it. */
export function runDiskCheck(path: string): { usage: DiskUsage; alarm: DiskAlarm | null } {
  const usage = readDiskUsage(path);
  const alarm = diskAlarmFor(path, usage);
  if (alarm) {
    // The log line DOES carry the live figure — it is per-event, so it
    // cannot go stale the way a grouped issue title can.
    console.error(
      `[disk-guard] ${alarm.band}: ${path} at ${alarm.usedPercent}% used, ` +
        `${Math.round(alarm.freeBytes / 1_048_576)} MB free`,
    );
    captureException(new Error(alarm.message), {
      tags: {
        feature: 'F212.3',
        band: alarm.band,
        // Bucketed on purpose: a raw percentage as a tag would be a new
        // tag value every hour for no reader benefit.
        used: `${Math.floor(alarm.usedPercent)}%`,
        path,
      },
    });
  }
  return { usage, alarm };
}

export function startDiskGuard(): () => void {
  const path = process.env.TRAIL_DATA_DIR ?? '/data';
  let stopped = false;

  const check = () => {
    if (stopped) return;
    try {
      const { usage, alarm } = runDiskCheck(path);
      if (!alarm) {
        console.log(
          `[disk-guard] ${path} at ${Math.round(usage.usedPercent * 10) / 10}% used ` +
            `(${Math.round(usage.freeBytes / 1_048_576)} MB free) — under ${WARN_PERCENT}%`,
        );
      }
    } catch (err) {
      // A path that cannot be read is UNKNOWN, never "fine". Worth one
      // loud line: it means the guard is not guarding.
      console.error(
        `[disk-guard] cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // Boot reading first, so a machine that comes up already full says so
  // immediately rather than in an hour.
  const first = setTimeout(check, INITIAL_DELAY_MS);
  const interval = setInterval(check, TICK_INTERVAL_MS);

  console.log(
    `  disk-guard: ${path}, warn >${WARN_PERCENT}% critical >${CRITICAL_PERCENT}%, ` +
      `tick every ${Math.round(TICK_INTERVAL_MS / 60_000)}min`,
  );

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(interval);
  };
}
