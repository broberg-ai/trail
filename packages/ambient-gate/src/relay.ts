/**
 * F201.4 — the local relay: focus.jsonl → gate → Trail curation queue.
 *
 * Runs as a small Bun process next to the Swift agent (`pnpm --filter
 * @trail/ambient-gate relay`). Tails ~/Library/Logs/TrailAmbient/
 * focus.jsonl (the agent's append-only event buffer — nothing else ever
 * leaves the machine), enforces the per-app deny-list, folds events into
 * session windows, and posts at most ONE redacted candidate per window to
 * the granted Trail KB using the device-auth token from the macOS Keychain.
 *
 * Gate note (fase F2): focus summaries carry app/window context, not prose,
 * so commitment/decision keywords rarely fire. The window summary is the
 * candidate; scoreChunk's score rides along as `confidence` (low = stays
 * pending for curator review — exactly right for ambient noise). The strict
 * shouldEmit gate takes over in F201.5/.6 when OCR/STT text flows.
 */
import { spawnSync } from 'node:child_process';
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { scoreChunk } from './gate.js';
import { postCandidate } from './candidate.js';
import { windowEvents, summarizeWindow, DEFAULT_WINDOW_OPTIONS, type RelayEvent } from './session-window.js';

const LOG_PATH = process.env.TRAIL_AMBIENT_LOG
  ?? join(homedir(), 'Library/Logs/TrailAmbient/focus.jsonl');
const ENGINE = process.env.TRAIL_AMBIENT_ENGINE ?? 'https://engine-001.trailmem.com';
const POLL_MS = Number(process.env.TRAIL_AMBIENT_POLL_MS ?? 5_000);
const GAP_MS = Number(process.env.TRAIL_AMBIENT_GAP_MS ?? DEFAULT_WINDOW_OPTIONS.gapMs);

/** Same defaults as the Swift agent's Settings.denyList — F201 privacy rule. */
export const DENY_LIST = ['1Password', 'Banking', 'Messages', 'Signal'];

function keychainToken(): string | null {
  const res = spawnSync('security', [
    'find-generic-password', '-s', 'com.broberg.trail-ambient', '-a', 'trail-api-token', '-w',
  ], { encoding: 'utf8' });
  const token = res.status === 0 ? res.stdout.trim() : '';
  return token.startsWith('trail_') ? token : null;
}

/** Granted KBs stored by the Swift agent at claim-time (UserDefaults). */
function grantedKb(): string | null {
  if (process.env.TRAIL_AMBIENT_KB) return process.env.TRAIL_AMBIENT_KB;
  const res = spawnSync('defaults', ['read', 'com.broberg.trail-ambient', 'trail.kbIds'], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  // plist array text: ( "id1", "id2" ) — first grant is the v1 target;
  // deal/personal routing over several grants is F201.7.
  const match = res.stdout.match(/"([^"]+)"/);
  return match?.[1] ?? null;
}

export function isDenyListed(app: string, denyList: string[] = DENY_LIST): boolean {
  const lower = app.toLowerCase();
  return denyList.some((d) => lower.includes(d.toLowerCase()));
}

function parseLine(line: string): RelayEvent | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (typeof obj.app !== 'string' || typeof obj.ts !== 'string') return null; // status events
    return {
      app: obj.app,
      ts: obj.ts,
      windowTitle: typeof obj.windowTitle === 'string' ? obj.windowTitle : undefined,
      screenText: typeof obj.screenText === 'string' ? obj.screenText : undefined,
    };
  } catch {
    return null;
  }
}

async function flushWindow(events: RelayEvent[], kb: string, token: string): Promise<void> {
  const summary = summarizeWindow(events);
  const gate = scoreChunk(summary.content);
  const result = await postCandidate(
    {
      kb,
      title: summary.title,
      content: summary.content,
      sourceUrl: `ambient://focus-session/${summary.start}`,
      capturedAt: summary.end,
      confidence: Math.max(0.05, Math.round(gate.score * 100) / 100),
    },
    { apiBase: ENGINE, token },
  );
  if (result.ok) {
    console.log(`[relay] candidate ${result.candidateId} → ${kb} (${events.length} events, conf=${gate.score.toFixed(2)}${result.redactionFindings.length > 0 ? `, redacted: ${result.redactionFindings.map((f) => f.label).join(',')}` : ''})`);
  } else if (result.duplicate) {
    console.log(`[relay] window ${summary.start} already posted (409) — skipped`);
  } else {
    console.error(`[relay] POST failed ${result.status}: ${result.error}`);
  }
}

async function main(): Promise<void> {
  const token = keychainToken();
  if (!token) {
    console.error('[relay] no device token in Keychain — connect first: menubar → "Forbind til Trail…"');
    process.exit(1);
  }
  const kb = grantedKb();
  if (!kb) {
    console.error('[relay] no granted KB found (defaults com.broberg.trail-ambient trail.kbIds / TRAIL_AMBIENT_KB)');
    process.exit(1);
  }
  console.log(`[relay] watching ${LOG_PATH} → ${ENGINE} (kb=${kb}, gap=${GAP_MS / 1000}s)`);

  let offset = 0;
  let buffer: RelayEvent[] = [];
  let partial = '';

  const tick = async (): Promise<void> => {
    // Read anything appended since last tick.
    try {
      const fd = openSync(LOG_PATH, 'r');
      const size = fstatSync(fd).size;
      if (size < offset) offset = 0; // log rotated/truncated
      if (size > offset) {
        const buf = Buffer.alloc(size - offset);
        readSync(fd, buf, 0, buf.length, offset);
        offset = size;
        const text = partial + buf.toString('utf8');
        const lines = text.split('\n');
        partial = lines.pop() ?? '';
        for (const line of lines) {
          const event = parseLine(line);
          if (!event) continue;
          if (isDenyListed(event.app)) {
            console.log(`[relay] deny-listed app skipped: ${event.app}`);
            continue;
          }
          buffer.push(event);
        }
      }
      closeSync(fd);
    } catch {
      // log file not created yet — agent hasn't emitted anything
    }

    // Flush every window the gap rule has CLOSED; the still-open tail
    // window stays in the buffer until it goes idle.
    if (buffer.length > 0) {
      const idleFor = Date.now() - Date.parse(buffer[buffer.length - 1]!.ts);
      const windows = windowEvents(buffer, { gapMs: GAP_MS, maxWindowMs: DEFAULT_WINDOW_OPTIONS.maxWindowMs });
      const closed = idleFor > GAP_MS ? windows : windows.slice(0, -1);
      if (closed.length > 0) {
        buffer = idleFor > GAP_MS ? [] : windows[windows.length - 1] ?? [];
        for (const w of closed) await flushWindow(w, kb, token);
      }
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (import.meta.main) {
  void main();
}
