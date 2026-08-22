// F206.1 — the end-to-end harness.
//
// "End-to-end" here means the REAL thing: createApp()'s router, the real
// requireAuth middleware, real migrations, real SQL. Nothing about auth is
// mocked — and that is the whole point. A test with a stubbed auth layer would
// have passed happily against the bug F205.1 exists to remove (every minted key
// silently being an unrestricted master key), because the stub would have
// encoded the same wrong assumption the code did.
//
// It exists because writing the F205 probe meant ~40 lines of temp database,
// migrations, tenant, user, knowledge bases and app boot BEFORE the first
// assertion. That distance is why the second E2E test never gets written. With
// this, a test starts at what it wants to prove.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLibsqlDatabase,
  apiKeys,
  users,
  tenants,
  knowledgeBases,
  type TrailDatabase,
} from '@trail/db';
import type { Hono } from 'hono';
import { createApp } from '../app.js';
import type { TenantPool } from '../lib/tenant-pool.js';

export interface E2ESeed {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  /** Two knowledge bases — enough to prove a key confined to one cannot reach the other. */
  kbA: string;
  kbB: string;
}

export interface E2EContext {
  app: Hono;
  trail: TrailDatabase;
  seed: E2ESeed;
  /**
   * Insert an API key directly and return the raw bearer. `scope` defaults to
   * undefined ON PURPOSE, reproducing exactly how every key was written before
   * F205.1 — that unscoped row is the regression control for "existing keys
   * keep working".
   */
  mintKey(opts?: { scope?: string; kbId?: string | null; name?: string }): Promise<string>;
  /** Authenticated request against the real app. */
  call(path: string, key: string, init?: RequestInit): Promise<Response>;
  /** SHA-256 of a raw bearer, for reading a key row back with raw SQL. */
  hashKey(raw: string): string;
  cleanup(): Promise<void>;
}

const sha = (raw: string) => createHash('sha256').update(raw).digest('hex');

/**
 * Boot a throwaway Trail. Each call gets its OWN temp directory and database,
 * so two tests in sequence share no state — asserted in the harness's own test
 * rather than assumed, because cross-test bleed is the classic way a suite goes
 * green for reasons unrelated to the code.
 */
export async function startE2E(): Promise<E2EContext> {
  const dir = mkdtempSync(join(tmpdir(), 'trail-e2e-'));
  const trail = await createLibsqlDatabase({ path: join(dir, 'test.db') });
  await trail.runMigrations();

  const seed: E2ESeed = {
    tenantId: 'ten1',
    tenantSlug: 'acme',
    userId: 'u1',
    kbA: 'kb-a',
    kbB: 'kb-b',
  };

  await trail.db.insert(tenants).values({
    id: seed.tenantId, slug: seed.tenantSlug, name: 'Acme',
  }).run?.();
  await trail.db.insert(users).values({
    id: seed.userId, tenantId: seed.tenantId, email: 'cb@webhouse.dk', role: 'admin',
  }).run?.();
  for (const [id, name] of [[seed.kbA, 'KB A'], [seed.kbB, 'KB B']] as const) {
    await trail.db.insert(knowledgeBases).values({
      id, tenantId: seed.tenantId, slug: id, name, createdBy: seed.userId,
    }).run?.();
  }

  // TenantPool is a plain Map<slug, TrailDatabase>.
  const pool: TenantPool = new Map([[seed.tenantSlug, trail]]);
  const app = createApp(trail, pool) as unknown as Hono;

  let n = 0;
  return {
    app,
    trail,
    seed,
    hashKey: sha,
    async mintKey(opts = {}) {
      const raw = `trail_${randomBytes(32).toString('hex')}`;
      await trail.db.insert(apiKeys).values({
        id: `k-${++n}`,
        tenantId: seed.tenantId,
        userId: seed.userId,
        name: opts.name ?? `key-${n}`,
        keyHash: sha(raw),
        ...(opts.scope ? { scope: opts.scope } : {}),
        ...(opts.kbId !== undefined ? { kbId: opts.kbId } : {}),
        createdAt: new Date().toISOString(),
      }).run?.();
      return raw;
    },
    call(path, key, init = {}) {
      return app.request(path, {
        ...init,
        headers: { authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
      });
    },
    async cleanup() {
      await trail.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
