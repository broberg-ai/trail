/**
 * F201.4 — session windowing + summarisation (pure, no I/O).
 *
 * The F201 plan's top risk is queue-flooding, so the relay NEVER posts one
 * candidate per event. Events fold into session windows — a window closes
 * on an idle gap or when it hits the max span — and each window becomes at
 * most ONE candidate: a compact per-app summary of what was worked on.
 */

export interface RelayEvent {
  app: string;
  windowTitle?: string;
  /** F201.5 — on-device Vision OCR of the frontmost window (redacted at
   * candidate assembly). The frame itself never leaves the Mac; only this text
   * reaches the relay. */
  screenText?: string;
  ts: string;
}

export interface WindowOptions {
  /** Idle gap that closes a window (ms). */
  gapMs: number;
  /** Hard cap on a single window's span (ms). */
  maxWindowMs: number;
}

export const DEFAULT_WINDOW_OPTIONS: WindowOptions = {
  gapMs: 3 * 60_000,
  maxWindowMs: 15 * 60_000,
};

/** Split a chronological event list into session windows. */
export function windowEvents(events: RelayEvent[], opts: WindowOptions = DEFAULT_WINDOW_OPTIONS): RelayEvent[][] {
  const windows: RelayEvent[][] = [];
  let current: RelayEvent[] = [];
  for (const event of events) {
    if (current.length > 0) {
      const prev = Date.parse(current[current.length - 1]!.ts);
      const first = Date.parse(current[0]!.ts);
      const now = Date.parse(event.ts);
      if (now - prev > opts.gapMs || now - first > opts.maxWindowMs) {
        windows.push(current);
        current = [];
      }
    }
    current.push(event);
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

export interface WindowSummary {
  title: string;
  content: string;
  start: string;
  end: string;
}

const timeFmt = (iso: string): string => iso.slice(11, 16);

/**
 * One window → one human-readable summary. Groups consecutive events by
 * app, keeps distinct window titles (the actual knowledge signal), and
 * leads with the dominant app.
 */
export function summarizeWindow(window: RelayEvent[]): WindowSummary {
  const start = window[0]!.ts;
  const end = window[window.length - 1]!.ts;

  interface Run { app: string; titles: string[]; screenTexts: string[]; count: number }
  const runs: Run[] = [];
  /** Per-run OCR budget so a dense screen can't dominate the candidate. */
  const OCR_BUDGET = 1500;
  const addScreenText = (run: Run, text: string): void => {
    const t = text.trim();
    if (!t || run.screenTexts.includes(t)) return;
    const used = run.screenTexts.reduce((n, s) => n + s.length, 0);
    if (used < OCR_BUDGET) run.screenTexts.push(t.slice(0, OCR_BUDGET - used));
  };
  for (const event of window) {
    const last = runs[runs.length - 1];
    if (last && last.app === event.app) {
      last.count++;
      if (event.windowTitle && !last.titles.includes(event.windowTitle)) last.titles.push(event.windowTitle);
      if (event.screenText) addScreenText(last, event.screenText);
    } else {
      const run: Run = { app: event.app, titles: event.windowTitle ? [event.windowTitle] : [], screenTexts: [], count: 1 };
      if (event.screenText) addScreenText(run, event.screenText);
      runs.push(run);
    }
  }

  const byApp = new Map<string, number>();
  for (const run of runs) byApp.set(run.app, (byApp.get(run.app) ?? 0) + run.count);
  const dominant = [...byApp.entries()].sort((a, b) => b[1] - a[1])[0]![0];

  // Each app run: its distinct window titles, then the on-device OCR of what
  // was on screen (the real knowledge signal). Redaction happens downstream in
  // buildCandidateBody, so secrets in OCR text never reach the queue.
  const lines = runs.flatMap((run) => {
    const head = run.titles.length > 0 ? `- ${run.app}: ${run.titles.map((t) => `"${t}"`).join(', ')}` : `- ${run.app}`;
    if (run.screenTexts.length === 0) return [head];
    return [head, ...run.screenTexts.map((s) => `  Skærm: ${s.replace(/\n/g, ' ⏎ ')}`)];
  });

  return {
    title: `Arbejdssession ${timeFmt(start)}–${timeFmt(end)} — ${dominant}`,
    content: `Fokusforløb ${start} → ${end}:\n${lines.join('\n')}`,
    start,
    end,
  };
}
