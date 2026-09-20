/**
 * F212.2 — HVAD ALARMERER, OG HVAD GØR IKKE.
 *
 * Begge retninger, for begge er fejl der kan koste noget:
 *   · en ÆGTE fejl uden alarm er de tre måneders tavshed dette kort lukker
 *   · en BENIGN afvisning MED alarm er et issue pr. kunde pr. time, og en
 *     kanal man muter er lige så tom som en ingen skriver til
 *
 * Den anden halvdel er lige så vigtig som den første, og det er den man
 * glemmer: en port der alarmerer på alt bliver slukket i løbet af en dag.
 *
 * MUTATIONS-TJEK, kørt 20. september 2026. Baseline 8/8 grønne:
 *   - fjern `if (result.error === BENIGN_REFUSAL) return null`  7 pass / 1 fail
 *       rød: «den forventede afvisning på en fjern-kunde alarmerer IKKE».
 *   - fjern `if (result.ok) return null`                        7 pass / 1 fail
 *       rød: «et lykket pas alarmerer ikke».
 *   - `raw.split('\n')[0]` → `raw`                              7 pass / 1 fail
 *       rød: «beskeden bærer kun FØRSTE linje». Det er mutationen der
 *       ville sprede én fejl over mange Upmetrics-issues, fordi de
 *       grupperer på fingeraftryk og et 100-elements integrity_check-array
 *       er forskelligt hver gang.
 *   - `err.startsWith('upload:')`-grenen væk                    6 pass / 2 fail
 *       rød: «trinnet læses af fejlens eget præfiks» OG «en upload-fejl
 *       alarmerer som SIT eget trin» — altså både aflæsningen og den
 *       konsekvens den har for beskeden.
 */
import { test, expect } from 'bun:test';
import { backupAlarmFor, backupStageOf, BENIGN_REFUSAL } from './alarm.js';
import type { BackupPassResult } from './pass.js';

function result(over: {
  ok: boolean;
  error?: string;
  snapshotError?: string;
  id?: string;
}): BackupPassResult {
  return {
    ok: over.ok,
    error: over.error,
    snapshot: {
      id: over.id ?? 'trail_2026-09-20_1200_abc123',
      snappedAt: '2026-09-20T12:00:00.000Z',
      trigger: 'scheduled',
      uncompressedBytes: 0,
      compressedBytes: 0,
      sha256: '',
      localPath: null,
      remoteUrl: null,
      status: over.ok ? 'uploaded' : 'failed',
      error: over.snapshotError,
    },
  };
}

test('et lykket pas alarmerer ikke', () => {
  expect(backupAlarmFor(result({ ok: true }))).toBe(null);
});

test('den forventede afvisning på en fjern-kunde alarmerer IKKE', () => {
  // Denne fyrer for hver kunde ved hvert tik. Alarmerede den, ville
  // kanalen være ubrugelig inden for et døgn.
  const r = result({ ok: false, error: BENIGN_REFUSAL, snapshotError: 'remote tenant (http://…)' });
  expect(backupAlarmFor(r)).toBe(null);
});

test('en snapshot-fejl alarmerer, og beskeden navngiver trinnet og manifest-id', () => {
  const r = result({
    ok: false,
    error: "snapshot integrity_check != 'ok'",
    snapshotError: "snapshot: snapshot integrity_check != 'ok' for /data/x.db: [{\"integrity_check\":\"NULL value in documents.confidence\"}]",
    id: 'trail_2026-09-20_1200_deadbe',
  });
  const alarm = backupAlarmFor(r);
  expect(alarm).not.toBe(null);
  expect(alarm!.stage).toBe('snapshot');
  expect(alarm!.snapshotId).toBe('trail_2026-09-20_1200_deadbe');
  expect(alarm!.message).toContain('trail_2026-09-20_1200_deadbe');
  expect(alarm!.message).toContain('at snapshot');
});

test('en upload-fejl alarmerer som SIT eget trin — to fejl med hver sin udbedring', () => {
  const r = result({ ok: false, error: 'bucket unreachable', snapshotError: 'upload: bucket unreachable' });
  const alarm = backupAlarmFor(r)!;
  expect(alarm.stage).toBe('upload');
  expect(alarm.message).toContain('at upload');
  // En snapshot-fejl er et databaseproblem; en upload-fejl er net/nøgle.
  // Samme tag ville gøre dem til ét issue i Upmetrics.
  expect(alarm.message).not.toContain('at snapshot');
});

test('beskeden bærer kun FØRSTE linje af fejlen', () => {
  const r = result({
    ok: false,
    error: 'boom',
    snapshotError: 'snapshot: line one\nline two\nline three',
  });
  const alarm = backupAlarmFor(r)!;
  expect(alarm.message).toContain('line one');
  expect(alarm.message).not.toContain('line two');
  expect(alarm.message.split('\n')).toHaveLength(1);
});

test('trinnet læses af fejlens eget præfiks, ikke gættes', () => {
  expect(backupStageOf(result({ ok: false, snapshotError: 'snapshot: x' }))).toBe('snapshot');
  expect(backupStageOf(result({ ok: false, snapshotError: 'upload: x' }))).toBe('upload');
  expect(backupStageOf(result({ ok: false, snapshotError: 'something else' }))).toBe('unknown');
  expect(backupStageOf(result({ ok: false }))).toBe('unknown');
});

test('en fejl UDEN tekst nogen steder giver stadig en alarm — ikke en tavs null', () => {
  // «Ingen fejlbesked» må aldrig blive «ingen fejl». Det er samme
  // fejlform som resten af kortet, én tak længere ude.
  const alarm = backupAlarmFor(result({ ok: false }));
  expect(alarm).not.toBe(null);
  expect(alarm!.message).toContain('unknown');
});

test('to forskellige pas med SAMME fejl giver beskeder der kun varierer på id', () => {
  const a = backupAlarmFor(result({ ok: false, snapshotError: 'upload: bucket unreachable', id: 'a' }))!;
  const b = backupAlarmFor(result({ ok: false, snapshotError: 'upload: bucket unreachable', id: 'b' }))!;
  expect(a.message.replace('(a)', '(X)')).toBe(b.message.replace('(b)', '(X)'));
});
