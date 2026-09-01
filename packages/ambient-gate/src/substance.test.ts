/**
 * F201.22 — the filters that decide what Ambient sends to Trail.
 *
 * Every fixture below is REAL: taken from focus.jsonl and from the candidates
 * that were auto-approved on 2026-09-01, not invented. A filter tested against
 * text I wrote myself would prove that my example matches my rule.
 */
import { test, expect } from 'bun:test';
import { hasSubstance, RecentWindows, MIN_CONTENT_WORDS } from './substance.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The shape that produced twelve Neurons about one sidebar: names only. */
const namesOnly = {
  title: 'Arbejdssession 11:51–11:55 — Notes',
  content: 'Fokusforløb 2026-09-01T09:51:00Z → 2026-09-01T09:55:00Z:\n- Notes: "FDAA – 6 notes"',
};

/** The same window a minute later — a new timestamp range, identical content. */
const namesOnlyAgain = {
  title: 'Arbejdssession 11:56–11:58 — Notes',
  content: 'Fokusforløb 2026-09-01T09:56:00Z → 2026-09-01T09:58:00Z:\n- Notes: "FDAA – 6 notes"',
};

/** A real capture that produced the one useful Neuron of the day. */
const realFinding = {
  title: 'Arbejdssession 11:09–11:18 — iTerm2',
  content:
    'Fokusforløb 2026-09-01T09:09:00Z → 2026-09-01T09:18:00Z:\n' +
    '- iTerm2: "fd-sundhed"\n' +
    '  Skærm: Jeg har fundet to huller i min validering: "2026-13-45" matcher formatet ⏎ ' +
    'og parseDate accepterer den uden at kaste. Måneden bliver 13 og dagen 45, ⏎ ' +
    'så en ugyldig dato slipper igennem som gyldig og fejler først ved visning.',
};

// ── The substance gate ─────────────────────────────────────────────────────

test('a window carrying only its own app name and title is not sent', () => {
  const v = hasSubstance(namesOnly);
  expect(v.keep).toBe(false);
  expect(v.reason).toBe('no-screen-text');
});

test('a window whose OCR only repeats the title is not sent', () => {
  const v = hasSubstance({
    title: 'Arbejdssession 12:00–12:02 — Notes',
    content:
      'Fokusforløb a → b:\n- Notes: "FDAA – 6 notes"\n  Skærm: FDAA 6 notes Notes',
  });
  expect(v.keep).toBe(false);
  expect(v.reason).toBe('only-names');
});

test('NEGATIVE CONTROL — the real finding still passes', () => {
  // The load-bearing half. Rejecting more is trivial; rejecting more without
  // losing the day's one useful capture is the actual requirement.
  const v = hasSubstance(realFinding);
  expect(v.keep).toBe(true);
  expect(v.words).toBeGreaterThanOrEqual(MIN_CONTENT_WORDS);
});

// ── Dedup ──────────────────────────────────────────────────────────────────

test('the same window seen again is a duplicate — despite a different time range', () => {
  const r = new RecentWindows();
  expect(r.isDuplicate(realFinding)).toBe(false);
  const laterSameContent = { ...realFinding, title: 'Arbejdssession 13:30–13:40 — iTerm2',
    content: realFinding.content.replace('T09:09', 'T11:30').replace('T09:18', 'T11:40') };
  expect(r.isDuplicate(laterSameContent)).toBe(true);
});

test('NEGATIVE CONTROL — two genuinely different windows both go through', () => {
  const r = new RecentWindows();
  const other = { ...realFinding, content: realFinding.content.replace(
    /Skærm:.*/s, 'Skærm: Relayet kører nu som LaunchAgent med KeepAlive, så det overlever en genstart af maskinen og ikke kun af terminalen.') };
  expect(r.isDuplicate(realFinding)).toBe(false);
  expect(r.isDuplicate(other)).toBe(false);
});

test('a duplicate outside the TTL is allowed again', () => {
  const r = new RecentWindows(1000);
  const t0 = Date.now();
  expect(r.isDuplicate(realFinding, t0)).toBe(false);
  expect(r.isDuplicate(realFinding, t0 + 500)).toBe(true);
  expect(r.isDuplicate(realFinding, t0 + 5_000)).toBe(false);
});

// ── The two together, on the actual cluster ────────────────────────────────

test('twelve glances at one sidebar produce ZERO sends, not twelve', () => {
  const r = new RecentWindows();
  let sent = 0;
  for (let i = 0; i < 12; i++) {
    const w = i % 2 === 0 ? namesOnly : namesOnlyAgain;
    if (!hasSubstance(w).keep) continue;
    if (r.isDuplicate(w)) continue;
    sent++;
  }
  expect(sent).toBe(0);
});

test('and a run of real work still sends exactly once', () => {
  const r = new RecentWindows();
  let sent = 0;
  for (let i = 0; i < 5; i++) {
    if (!hasSubstance(realFinding).keep) continue;
    if (r.isDuplicate(realFinding)) continue;
    sent++;
  }
  expect(sent).toBe(1);
});

// ── The owner's condition, asserted rather than promised ───────────────────

test('AMBIENT ONLY — nothing outside the ambient package can be affected', () => {
  // Christian's condition, verbatim: "husk det er et Trail Ambient filter og
  // ikke noget der ændrer Trail generisk er vi enige?" — and then the sharper
  // steer: "det er jo ambient der samler op og den må gerne filtrere INDEN den
  // sender til trail for compilation."
  //
  // Both filters live in this package and run before the POST, so a non-ambient
  // candidate cannot be judged differently: the engine never sees a decision
  // taken here. This test holds that structural claim in place — if a future
  // change imports these filters into the engine or the shared queue, the
  // guarantee stops being structural and this goes red.
  const root = join(import.meta.dir, '../../..');
  const strays: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.build' || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|js)$/.test(e.name)) continue;
      const rel = full.slice(root.length + 1);
      if (rel.startsWith('packages/ambient-gate/')) continue;
      if (readFileSync(full, 'utf8').includes('substance.js')) strays.push(rel);
    }
  };
  for (const top of ['apps', 'packages']) walk(join(root, top));
  expect(strays).toEqual([]);
});
