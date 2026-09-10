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
import { hasSubstance, RecentWindows } from './substance.js';

const LOG_PATH = process.env.TRAIL_AMBIENT_LOG
  ?? join(homedir(), 'Library/Logs/TrailAmbient/focus.jsonl');
const ENGINE = process.env.TRAIL_AMBIENT_ENGINE ?? 'https://engine-001.trailmem.com';
const POLL_MS = Number(process.env.TRAIL_AMBIENT_POLL_MS ?? 5_000);
const GAP_MS = Number(process.env.TRAIL_AMBIENT_GAP_MS ?? DEFAULT_WINDOW_OPTIONS.gapMs);

/** Same defaults as the Swift agent's Settings.denyList — F201 privacy rule. */
export const DENY_LIST = ['1Password', 'Banking', 'Messages', 'Signal'];

function logSize(path: string): number {
  try {
    const fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    closeSync(fd);
    return size;
  } catch {
    return 0;
  }
}

function keychainToken(): string | null {
  const res = spawnSync('security', [
    'find-generic-password', '-s', 'com.broberg.trail-ambient', '-a', 'trail-api-token', '-w',
  ], { encoding: 'utf8' });
  const token = res.status === 0 ? res.stdout.trim() : '';
  return token.startsWith('trail_') ? token : null;
}

/**
 * F268.1 — HVILKEN VIDENBASE AMBIENT SKRIVER TIL.
 *
 * Målt 10/9 2026: 535 arbejdsnoter fra ni dage landede i broberg.ai — den Trail
 * hjemmesidens chat svarer fra. Grunden stod i den gamle udgave af netop denne
 * funktion: den tog `trail.kbIds`' FØRSTE element. Den læste aldrig ejerens valg,
 * for der fandtes ikke noget valg at læse. Rækkefølgen i parringens liste afgjorde
 * hvor ni dages dikteringer røg hen, og listen blev skrevet om 9/9 kl. 22:14.
 *
 * Nu: ambients eget valg (`trail.ambient.kbId`, sat i menulinjen), verificeret mod
 * de videnbaser parringen faktisk gav adgang til. Er der ikke valgt noget, er
 * svaret `null` og relayet stopper med at sige hvorfor. Et gæt kan ikke skelne
 * «ejeren valgte denne» fra «ingen har valgt noget» — og det er præcis den
 * forskel der her kostede 535 noter i den forkerte Trail.
 */
export function vaelgKb(input: { valgt: string | null; tilladte: string[]; env?: string }): string | null {
  if (input.env) return input.env;
  const valgt = input.valgt?.trim();
  if (!valgt) return null;
  if (input.tilladte.length > 0 && !input.tilladte.includes(valgt)) return null;
  return valgt;
}

function laesDefault(key: string): string | null {
  const res = spawnSync('defaults', ['read', 'com.broberg.trail-ambient', key], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const v = res.stdout.trim();
  return v.length > 0 ? v : null;
}

function grantedKb(): string | null {
  const liste = laesDefault('trail.kbIds') ?? '';
  return vaelgKb({
    valgt: laesDefault('trail.ambient.kbId'),
    tilladte: [...liste.matchAll(/"([^"]+)"/g)].map((m) => m[1]!),
    env: process.env.TRAIL_AMBIENT_KB,
  });
}

/**
 * F268.1 — HVOR I LOGGEN VI STARTER.
 *
 * Den gamle udgave startede på byte 0 ved hver opstart og sendte hele historikken
 * igen. Mod den SAMME videnbase blev genafsendelsen fanget af motorens 409 på
 * `sourceUrl`, så ingen så det. Mod en NY videnbase findes den dubletspærre ikke —
 * og så blev en enkelt forkert indstilling til 518 noter på 29 minutter.
 *
 * Derfor starter vi ved slutningen af loggen. Skal historikken med, er det en
 * bevidst handling: `--backfill`.
 */
export function startOffset(size: number, backfill: boolean): number {
  return backfill ? 0 : size;
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

/**
 * F201.22 — what has already been sent. Lives for the relay's lifetime, which is
 * the process launchd keeps alive, so a window looked at all afternoon is
 * compiled once rather than once per glance.
 */
const recent = new RecentWindows();

async function flushWindow(events: RelayEvent[], kb: string, token: string): Promise<void> {
  const summary = summarizeWindow(events);

  // F201.22 — filter HERE, before Trail ever sees it (the owner's instruction:
  // ambient collects, so ambient filters, before compilation). Two rejections,
  // both measured on the day this shipped:
  //
  //   only-names   a window carrying nothing but its own app + title. The
  //                distiller would fill the gap from the title and hedge while
  //                doing it ("muligvis relateret til") — a guess stored as fact.
  //   duplicate    the same unchanged window seen again. Twelve of these became
  //                twelve Neurons about one sidebar in Notes.
  //
  // Rejecting here rather than downstream also means no cloud distill call is
  // spent on a window we were never going to keep.
  const substance = hasSubstance(summary);
  if (!substance.keep) {
    console.log(`[relay] skipped (${substance.reason}, ${substance.words} content words): ${summary.title}`);
    return;
  }
  if (recent.isDuplicate(summary)) {
    console.log(`[relay] skipped (duplicate of a window already sent): ${summary.title}`);
    return;
  }

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
    console.error(
      '[relay] ingen videnbase valgt til ambient — der sendes INTET.\n' +
      '        Vælg en i menulinjen (Trail Ambient → «Skriver til:»), eller sæt den direkte:\n' +
      '          defaults write com.broberg.trail-ambient trail.ambient.kbId -string "<kb-id>"\n' +
      '        Relayet gætter med vilje ikke: et gæt sendte 535 arbejdsnoter i den forkerte Trail (F268.1).',
    );
    process.exit(1);
  }
  console.log(`[relay] watching ${LOG_PATH} → ${ENGINE} (kb=${kb}, gap=${GAP_MS / 1000}s)`);

  const backfill = process.argv.includes('--backfill');
  let offset = startOffset(logSize(LOG_PATH), backfill);
  if (backfill) console.log('[relay] --backfill: hele loggen genafsendes med vilje');
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
