/**
 * F213.1 — `updatedAt` on retrieve chunks must mean the same instant
 * whichever of the two stored formats a row happens to carry.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE FORCES A TIMEZONE, and why that is the load-bearing part:
 *
 * `bun test` runs with TZ=UTC by default (measured 2026-08-27). The bug this
 * test exists to catch — parsing SQLite's unlabelled 'YYYY-MM-DD HH:MM:SS' as
 * LOCAL time — is INVISIBLE under UTC, because local and UTC coincide. The
 * first version of this test was written without the override, and the naive
 * `new Date(v).toISOString()` implementation passed it cleanly. CI containers
 * are UTC too, so nothing would ever have caught it.
 *
 * A test that can only fail on a developer's laptop is not a gate. So the
 * suite pins a non-UTC zone and then ASSERTS that the pin took effect — if a
 * future runtime stops honouring a runtime TZ change, this file must go red
 * rather than quietly losing its power.
 * ─────────────────────────────────────────────────────────────────────────
 */

process.env.TZ = 'Europe/Copenhagen';

import { describe, expect, test } from 'bun:test';
import { normaliseUpdatedAt } from './retrieve.js';

describe('normaliseUpdatedAt', () => {
  test('the test itself is armed — the TZ override took effect', () => {
    // Without this, every assertion below still passes against a broken
    // implementation. This is the check on the checker.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Copenhagen');
    expect(new Date('2026-06-22 12:07:09').toISOString()).toBe('2026-06-22T10:07:09.000Z');
  });

  test('ISO-8601 with Z is handed back untouched', () => {
    expect(normaliseUpdatedAt('2026-04-16T16:31:49.278Z')).toBe('2026-04-16T16:31:49.278Z');
    expect(normaliseUpdatedAt('2026-04-16T16:31:49Z')).toBe('2026-04-16T16:31:49Z');
  });

  test("SQLite datetime('now') is LABELLED as UTC, not converted", () => {
    // Exact-string assertion on purpose. The tempting implementation,
    // `new Date(v).toISOString()`, returns '2026-06-22T10:07:09.000Z' here —
    // a plausible-looking date, silently two hours early, on the format that
    // holds 93 % of production rows.
    expect(normaliseUpdatedAt('2026-06-22 12:07:09')).toBe('2026-06-22T12:07:09.000Z');
    expect(normaliseUpdatedAt('2026-01-05 00:00:00')).toBe('2026-01-05T00:00:00.000Z');
  });

  test('both stored formats for the same instant normalise identically', () => {
    // The property consumers actually depend on: two rows written by
    // different code paths at the same moment must compare equal.
    expect(normaliseUpdatedAt('2026-06-22 12:07:09')).toBe(
      normaliseUpdatedAt('2026-06-22T12:07:09.000Z')!,
    );
  });

  test('the normalised value round-trips through Date as the same instant', () => {
    const iso = normaliseUpdatedAt('2026-06-22 12:07:09')!;
    expect(new Date(iso).getTime()).toBe(Date.UTC(2026, 5, 22, 12, 7, 9));
  });

  test('a winter timestamp is not shifted either (offset is never applied)', () => {
    // Copenhagen is +1 in January, +2 in June. A bug that hardcoded one
    // offset would pass the June case and fail here.
    expect(normaliseUpdatedAt('2026-01-05 08:30:00')).toBe('2026-01-05T08:30:00.000Z');
  });

  test('NEGATIVE CONTROL — unparseable input yields null, never a guess', () => {
    // For a freshness field a wrong date is worse than no date: the consumer
    // renders "as of <date>" with equal confidence either way.
    for (const bad of ['', '   ', 'yesterday', '22/06/2026', '2026-06-22', null, undefined]) {
      expect(normaliseUpdatedAt(bad as string | null | undefined)).toBeNull();
    }
  });

  test('NEGATIVE CONTROL — a partially-shaped string is not coerced', () => {
    expect(normaliseUpdatedAt('2026-06-22 12:07')).toBeNull();
    expect(normaliseUpdatedAt('2026-06-22T12:07:09')).toBeNull(); // no zone marker: ambiguous
  });
});
