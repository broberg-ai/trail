/**
 * F40.2a — Playwright config for the widget multi-tenant e2e.
 *
 * Spins up the local-demo Bun server on :3055 with TRAIL_API_KEY set
 * to a specific bearer for the test run. The test asserts that the
 * widget can talk to engine.trailmem.com via the proxy and that the
 * tenant-routing in F40.2a returns data from the right DB.
 */
import { defineConfig } from '@playwright/test';

const WIDGET_DIR = process.cwd();
const PORT = 3055;

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    actionTimeout: 30_000,
  },
  // One worker — the demo server is a single Bun process and the
  // tests need clean per-tenant runs without race conditions on the
  // bearer env-var.
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
