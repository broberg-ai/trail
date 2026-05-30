/**
 * F187 + F188 browser verification (buddy flag #455).
 *
 * Drives the REAL built admin SPA in headless Chromium against a locally
 * booted admin-server with a seeded session — exercising the UI the
 * earlier API-only verification skipped: the Invitations tab (invite
 * form, role picker, send, pending row) and the Developer section
 * (generate modal, one-time key reveal, table render, revoke).
 *
 * Lives under apps/widget/scripts because @playwright/test (and its
 * chromium) are installed there. Imports admin-server's db module by
 * relative path for seeding + final DB assertions.
 *
 * Run:  cd apps/admin && pnpm build      # produce dist the server serves
 *       bun run apps/widget/scripts/verify-admin-ui.ts
 */

import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../..');
const SPA_DIR = join(REPO, 'apps/admin/dist');
const DB_PATH = join(tmpdir(), `verify-admin-ui-${process.pid}-${Date.now()}.db`);
const PORT = 8137;
const BASE = `http://localhost:${PORT}`;

process.env.TRAIL_ADMIN_CONTROL_DB = DB_PATH;

const { db, schema, client } = await import('../../admin-server/src/db.js');
const { runMigrations } = await import('../../admin-server/src/migrations.js');

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}

const SESSION = 'sess-ui-smoke';
const USER = 'u-ui-smoke';
const ORG = 'org-ui-smoke';

async function seed() {
  await runMigrations();
  await db.insert(schema.organizations).values({ id: ORG, slug: 'ui-smoke', name: 'UI Smoke' });
  await db.insert(schema.controlTenants).values({
    id: 't-ui-smoke', organizationId: ORG, slug: 'ui-smoke', name: 'UI Smoke', language: 'en',
  });
  await db.insert(schema.controlUsers).values({
    id: USER, organizationId: ORG, email: 'smoke@verify.test', name: 'Smoke Tester', onboarded: true,
  });
  await db.insert(schema.sessions).values({
    id: SESSION, userId: USER, expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  });
  // Dead-end engine URL — the panels we test don't call the engine, and
  // any /api/v1/* shell prefetch fails fast without blocking the route.
  await db.insert(schema.tenantEngines).values({
    tenantId: 't-ui-smoke', engineId: 'engine-x',
    engineUrl: 'http://127.0.0.1:1', provisionedAt: new Date().toISOString(), bearer: 'x',
  });
}

async function waitForHealth(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let server: ChildProcess | null = null;

async function run() {
  console.log(`[verify-admin-ui] db=${DB_PATH} spa=${SPA_DIR}`);
  await seed();

  server = spawn('bun', ['apps/admin-server/src/index.ts'], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(PORT),
      TRAIL_ADMIN_CONTROL_DB: DB_PATH,
      TRAIL_ADMIN_SPA_DIR: SPA_DIR,
      NODE_ENV: 'development',
    },
    stdio: 'ignore',
  });

  const up = await waitForHealth(15_000);
  assert(up, 'admin-server booted + healthy');
  if (!up) return;

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addCookies([
    { name: 'trail-session', value: SESSION, domain: 'localhost', path: '/' },
  ]);
  await ctx.addInitScript(() => {
    localStorage.setItem('trail.admin.lang', 'en');
  });
  const page = await ctx.newPage();

  // ── F188: Developer section ──────────────────────────────────────
  console.log('\nF188 — Developer section (Account Preferences)');
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Generate new key' }).click();
  await page.getByPlaceholder('e.g. CI pipeline, laptop CLI').fill('cc-smoke-key');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const revealed = page.getByText(/trail_[0-9a-f]{64}/);
  await revealed.waitFor({ timeout: 5000 });
  assert(true, 'generate modal reveals the raw key once');
  const rawShown = (await revealed.textContent())?.trim() ?? '';
  assert(/^trail_[0-9a-f]{64}$/.test(rawShown), 'revealed key is trail_<64hex>');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByText('cc-smoke-key').waitFor({ timeout: 5000 });
  assert(true, 'new key appears in the table after Done');

  // DB cross-check: row created, hash stored (not raw), prefix set.
  const keyRow = await db.query.controlApiKeys.findFirst({
    where: (k, { eq }) => eq(k.name, 'cc-smoke-key'),
  });
  assert(!!keyRow && !!keyRow.keyHash && keyRow.keyHash !== rawShown, 'key persisted as hash, not raw');

  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await page.getByText('cc-smoke-key').waitFor({ state: 'detached', timeout: 5000 });
  assert(true, 'revoke removes the key from the table');
  const afterRevoke = await db.query.controlApiKeys.findFirst({
    where: (k, { eq }) => eq(k.name, 'cc-smoke-key'),
  });
  assert(!!afterRevoke?.revokedAt, 'revoked_at set in DB after UI revoke');

  // ── F187: Invitations tab ────────────────────────────────────────
  console.log('\nF187 — Invitations tab (Manage Tenants)');
  await page.goto(`${BASE}/tenants`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Invitations/ }).click();
  await page.getByRole('radio', { name: 'Member' }).click(); // segmented role picker
  await page.getByPlaceholder('name@example.com').fill('invitee@verify.test');
  await page.getByRole('button', { name: 'Send invite' }).click();
  // Toast confirmation fires immediately…
  await page.getByText('Invite sent to invitee@verify.test').waitFor({ timeout: 5000 });
  assert(true, 'invite send shows the success toast');
  // …and the pending row renders in the list (exact match avoids the toast).
  await page.getByText('invitee@verify.test', { exact: true }).waitFor({ timeout: 5000 });
  assert(true, 'pending invitation row renders');
  const inv = await db.query.invitations.findFirst({
    where: (i, { eq }) => eq(i.email, 'invitee@verify.test'),
  });
  assert(inv?.status === 'pending' && inv?.role === 'member', 'invitation persisted pending, role=member');

  // Pending status badge visible.
  assert(await page.getByText('Pending').first().isVisible(), 'pending status badge shown');

  await browser.close();
}

try {
  await run();
} finally {
  server?.kill('SIGKILL');
  try { client.close(); } catch { /* ignore */ }
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
