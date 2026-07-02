import { describe, expect, test } from 'bun:test';
import { windowEvents, summarizeWindow, type RelayEvent } from './session-window.js';
import { isDenyListed } from './relay.js';

const ev = (app: string, minute: number, title?: string): RelayEvent => ({
  app,
  windowTitle: title,
  ts: `2026-07-02T10:${String(minute).padStart(2, '0')}:00Z`,
});

describe('windowEvents', () => {
  test('splits on idle gaps beyond gapMs', () => {
    const events = [ev('Safari', 0), ev('Safari', 1), ev('iTerm2', 10), ev('iTerm2', 11)];
    const windows = windowEvents(events, { gapMs: 3 * 60_000, maxWindowMs: 15 * 60_000 });
    expect(windows.length).toBe(2);
    expect(windows[0]!.length).toBe(2);
    expect(windows[1]![0]!.app).toBe('iTerm2');
  });

  test('caps a window at maxWindowMs even without gaps', () => {
    const events = [0, 4, 8, 12, 16, 20].map((m) => ev('Safari', m));
    const windows = windowEvents(events, { gapMs: 5 * 60_000, maxWindowMs: 15 * 60_000 });
    expect(windows.length).toBe(2);
  });

  test('one continuous burst is ONE window (the anti-flood invariant)', () => {
    const events = [0, 1, 2, 3].map((m) => ev('Safari', m, `Side ${m}`));
    expect(windowEvents(events).length).toBe(1);
  });
});

describe('summarizeWindow', () => {
  test('groups consecutive events per app and keeps distinct titles', () => {
    const summary = summarizeWindow([
      ev('Safari', 0, 'Acme CRM'),
      ev('Safari', 1, 'Acme CRM'),
      ev('Safari', 2, 'Tilbud 2026'),
      ev('iTerm2', 3, 'TRAIL'),
    ]);
    expect(summary.title).toContain('Safari');
    expect(summary.content).toContain('"Acme CRM", "Tilbud 2026"');
    expect(summary.content).toContain('iTerm2: "TRAIL"');
    // De-dup: 'Acme CRM' appears once despite two events.
    expect(summary.content.split('Acme CRM').length - 1).toBe(1);
  });

  test('dominant app leads the title', () => {
    const summary = summarizeWindow([ev('Xcode', 0), ev('Safari', 1), ev('Xcode', 2), ev('Xcode', 3)]);
    expect(summary.title).toContain('Xcode');
  });
});

describe('deny-list', () => {
  test('deny-listed apps are filtered (case-insensitive, substring)', () => {
    expect(isDenyListed('1Password 8')).toBe(true);
    expect(isDenyListed('Messages')).toBe(true);
    expect(isDenyListed('signal')).toBe(true);
    expect(isDenyListed('Safari')).toBe(false);
  });
});
