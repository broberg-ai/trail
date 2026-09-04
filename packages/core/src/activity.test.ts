/**
 * F239 — en fejlrapport skal sige HVORFOR, ikke hvad den forsøgte.
 *
 * logActivity sluger med vilje sine fejl: en aktivitetslinje må aldrig vælte
 * den handling den beskriver. Men den skal så til gengæld kunne DIAGNOSTICERES,
 * og det kunne den ikke: for en drizzle-fejl er `err.message` hele SQL-
 * sætningen, mens grunden ligger i `err.cause`.
 *
 * Målt 4. september: seks «write failed» i produktionsloggen uden ét ord om
 * årsagen. Fire SSH-runder til en kundes database, hvor hver manuel gentagelse
 * af nøjagtig samme indsættelse lykkedes — fordi beskeden aldrig indeholdt det
 * der var galt.
 */
import { expect, test } from 'bun:test';
import { logActivity } from './activity.js';

/** En database der fejler som drizzle gør: besked = forespørgslen, grund = cause. */
function failingTrail(cause: Error) {
  const err = new Error('Failed query: insert into "activity_log" (...) values (?, ?, ?)');
  (err as Error & { cause?: unknown }).cause = cause;
  return {
    db: { insert: () => ({ values: () => ({ run: () => { throw err; } }) }) },
  } as never;
}

const input: Parameters<typeof logActivity>[1] = {
  tenantId: 't-broberg-ai',
  actorKind: 'user' as const,
  kind: 'candidate.created' as const,
  subjectType: 'candidate' as const,
  summary: 'prøve',
};

test('ÅRSAGEN kommer med i loggen — ikke kun forespørgslen', async () => {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    await logActivity(failingTrail(new Error('SQLITE_BUSY: database is locked')), input);
  } finally { console.error = orig; }

  const line = lines.join('\n');
  expect(line).toContain('SQLITE_BUSY: database is locked');
  // Og forespørgslen fylder ikke rapporten — den var det eneste der stod før.
  expect(line).not.toContain('insert into');
});

test('tenanten står med, så en fejl kan henføres til en kunde', async () => {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    await logActivity(failingTrail(new Error('noget gik galt')), input);
  } finally { console.error = orig; }
  expect(lines.join('\n')).toContain('t-broberg-ai');
});

test('NEGATIV KONTROL — uden en cause bruges beskeden, frem for ingenting', async () => {
  // En fejl uden cause må ikke give en TOM rapport. "Vi ved ikke hvorfor" og
  // "der stod ingenting" må ikke se ens ud.
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  const plain = { db: { insert: () => ({ values: () => ({ run: () => { throw new Error('bar fejl uden cause'); } }) }) } } as never;
  try { await logActivity(plain, input); } finally { console.error = orig; }
  expect(lines.join('\n')).toContain('bar fejl uden cause');
});

test('en fejl må ALDRIG kaste videre — aktiviteten er en note, ikke handlingen', async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    await expect(logActivity(failingTrail(new Error('x')), input)).resolves.toBeUndefined();
  } finally { console.error = orig; }
});
