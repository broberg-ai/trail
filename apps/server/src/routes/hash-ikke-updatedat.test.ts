/**
 * F275.1 AC#5 — «NOGEN SKREV» og «INDHOLDET ER NYT» er to spørgsmål.
 *
 * Målt natten mellem 15. og 16. september: `updatedAt` flyttede sig mens
 * version, filstørrelse OG indholds-hash stod stille. Afgjorde afløsningen på
 * `updatedAt`, ville hver eneste gen-synkronisering fra sitet — også en der
 * ikke ændrede ét tegn — tælle som en ny udgave og udløse hele maskineriet.
 */
import { test, expect, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createLibsqlDatabase, tenants, users, knowledgeBases, documents } from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { awaitendeKilde } from './documents.js';

const T = 't-hsh', U = 'u-hsh', KB = 'kb-hsh';
let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

async function afventende(): Promise<string[]> {
  const r = await trail.db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.tenantId, T), awaitendeKilde()))
    .all();
  return r.map((x) => x.id);
}

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `hsh-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f, { force: true }); } catch { /* frisk */ } }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'hsh', name: 'Hsh', plan: 'hobby' }).run();
  await trail.db.insert(users).values({ id: U, tenantId: T, email: 'h@s.dk', displayName: 'H', role: 'owner', onboarded: true }).run();
  await trail.db.insert(knowledgeBases).values({ id: KB, tenantId: T, createdBy: U, name: 'Hsh', slug: KB, language: 'da' }).run();
  // En kilde der ER kompileret: hash'en er stemplet som «den vi har set».
  await trail.db.insert(documents).values({
    id: 'kilde', tenantId: T, userId: U, knowledgeBaseId: KB, kind: 'source',
    path: '/sources/', filename: 'side.md', content: 'tekst', fileType: 'md',
    contentHash: 'aaa', localCompiledHash: 'aaa', awaitingLocalCompile: false,
    updatedAt: '2026-09-15T10:00:00.000Z',
  }).run();
});

test('AC#5 DEN BÆRENDE: rør kilden UDEN at ændre teksten → IKKE en ny udgave', async () => {
  expect(await afventende()).toEqual([]);
  await trail.db.update(documents)
    .set({ updatedAt: '2026-09-17T23:59:00.000Z' })   // «nogen skrev»
    .where(eq(documents.id, 'kilde')).run();
  // … men indholdet er det samme, så der er intet nyt at afløse.
  expect(await afventende()).toEqual([]);
});

test('AC#5 POSITIV KONTROL: ændres INDHOLDET, er det en ny udgave', async () => {
  // Uden den beviser prøven ovenfor kun at intet nogensinde tæller med.
  await trail.db.update(documents)
    .set({ contentHash: 'bbb' })
    .where(eq(documents.id, 'kilde')).run();
  expect(await afventende()).toEqual(['kilde']);
});

test('DEN TREDJE TILSTAND: har vi aldrig kompileret den, afgør hash\'en ingenting', async () => {
  // `localCompiledHash = NULL` betyder «vi ved ikke hvad vi har set», og et
  // ukendt må ikke læses som «forskellig fra». Flaget er den eneste kilde da.
  await trail.db.update(documents)
    .set({ localCompiledHash: null }).where(eq(documents.id, 'kilde')).run();
  expect(await afventende()).toEqual([]);
  await trail.db.update(documents)
    .set({ awaitingLocalCompile: true }).where(eq(documents.id, 'kilde')).run();
  expect(await afventende()).toEqual(['kilde']);
});
