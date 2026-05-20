/**
 * F40.2a — multi-tenant e2e via the embeddable widget.
 *
 * Proves that the engine's F40.2a routing correctly serves each tenant
 * via its own bearer-key, through the real prod path:
 *
 *   browser ──► local-demo Bun proxy (port 3055)
 *                  │  Authorization: Bearer <tenant bearer>
 *                  ▼
 *           engine.trailmem.com /api/v1/chat
 *                  │  hash bearer → /data/key-index.db lookup
 *                  ▼
 *           /data/<slug>/trail.db  ← retrieval runs here
 *
 * Run order:
 *   pnpm exec playwright test multi-tenant.spec.ts
 *
 * Required env:
 *   TRAIL_SANNE_BEARER   — Sanne tenant bearer (read from ~/.trail-secrets)
 *   TRAIL_BROBERG_BEARER — broberg-ai tenant bearer
 */
import { test, expect, type ChildProcess } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIDGET_DIR = join(__dirname, '..');
const DEMO_SCRIPT = join(WIDGET_DIR, 'examples', 'local-demo.ts');

const HOME = process.env.HOME!;
const SANNE_BEARER =
  process.env.TRAIL_SANNE_BEARER ??
  (existsSync(join(HOME, '.trail-secrets/sanne.bearer'))
    ? readFileSync(join(HOME, '.trail-secrets/sanne.bearer'), 'utf-8').trim()
    : '');
const BROBERG_BEARER =
  process.env.TRAIL_BROBERG_BEARER ??
  (existsSync(join(HOME, '.trail-secrets/broberg-ai.bearer'))
    ? readFileSync(join(HOME, '.trail-secrets/broberg-ai.bearer'), 'utf-8').trim()
    : '');

if (!SANNE_BEARER || !BROBERG_BEARER) {
  throw new Error(
    'Both Sanne and broberg-ai bearers required. Provide via env or ~/.trail-secrets/{sanne,broberg-ai}.bearer',
  );
}

type DemoHandle = { proc: ChildProcess; stderr: string };

function spawnDemo(opts: { bearer: string; kb: string; port?: number }): DemoHandle {
  const port = opts.port ?? 3055;
  const proc = spawn('bun', ['run', DEMO_SCRIPT], {
    env: {
      ...process.env,
      PORT: String(port),
      TRAIL_API_KEY: opts.bearer,
      TRAIL_KB: opts.kb,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const handle: DemoHandle = { proc, stderr: '' };
  proc.stderr?.on('data', (chunk) => {
    handle.stderr += chunk.toString();
  });
  return handle;
}

async function waitForDemoReady(handle: DemoHandle): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('demo failed to start in 8s. stderr: ' + handle.stderr)),
      8_000,
    );
    handle.proc.stdout?.on('data', (chunk) => {
      const s = chunk.toString();
      if (s.includes('listening at')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    handle.proc.on('error', reject);
    handle.proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`demo exited early with code ${code}. stderr: ${handle.stderr}`));
      }
    });
  });
}

async function killDemo(handle: DemoHandle): Promise<void> {
  if (!handle.proc.killed) {
    handle.proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      handle.proc.on('exit', () => resolve());
      setTimeout(resolve, 2000); // hard timeout if process is wedged
    });
  }
}

// Helper: send a message via the widget and capture the rendered
// answer + citations.
async function chatAndGetResponse(
  page: import('@playwright/test').Page,
  question: string,
): Promise<{ answer: string; citationFilenames: string[]; rawJson: unknown }> {
  // Wait for widget to mount
  await page.waitForSelector('trail-chat', { state: 'attached' });
  // Hook into the proxy responses — listen for /api/chat-proxy/chat
  const responsePromise = page.waitForResponse(
    (res) => res.url().endsWith('/api/chat-proxy/chat') && res.request().method() === 'POST',
    { timeout: 60_000 },
  );
  // Type the question + submit. The widget renders a <form> with
  // a textarea; we use the keyboard.
  const textarea = page.locator('trail-chat').locator('css=textarea').first();
  await textarea.fill(question);
  await page.keyboard.press('Enter');
  const res = await responsePromise;
  expect(res.status()).toBe(200);
  const json = (await res.json()) as {
    answer?: string;
    citations?: Array<{ filename?: string; path?: string }>;
  };
  const citationFilenames = (json.citations ?? [])
    .map((c) => c.filename ?? '')
    .filter(Boolean);
  return {
    answer: json.answer ?? '',
    citationFilenames,
    rawJson: json,
  };
}

test.describe('F40.2a multi-tenant routing via widget', () => {
  let demo: DemoHandle | null = null;

  test.afterEach(async () => {
    if (demo) {
      await killDemo(demo);
      demo = null;
    }
  });

  test('Sanne bearer returns zoneterapi answers with Sanne-tenant citations', async ({
    page,
  }) => {
    demo = spawnDemo({ bearer: SANNE_BEARER, kb: 'sanne-andersen' });
    await waitForDemoReady(demo);

    await page.goto('/');
    const result = await chatAndGetResponse(page, 'Hvad er zoneterapi?');

    // Sanne-tenant answer should mention behandling/zoneterapi
    expect(result.answer.toLowerCase()).toMatch(/zoneterapi|behandling|krop|tryk/);

    // Citations should come from Sanne's KB.
    expect(result.citationFilenames.length).toBeGreaterThan(0);
  });

  test('broberg-ai bearer returns answers from broberg KB, no cross-tenant leak', async ({
    page,
  }) => {
    demo = spawnDemo({ bearer: BROBERG_BEARER, kb: 'trail-research' });
    await waitForDemoReady(demo);

    await page.goto('/');
    const result = await chatAndGetResponse(
      page,
      'Hvad er Trail-systemet og hvordan virker det?',
    );

    // The real cross-tenant invariant: a broberg-ai bearer must NEVER
    // produce zoneterapi/akupunktur content. Those terms live in
    // Sanne's KB. If they appeared, the engine has routed the bearer
    // to Sanne's tenant DB — catastrophic leak.
    expect(result.answer.toLowerCase()).not.toMatch(/zoneterapi|akupunktur|behandling|klinik/);
    // And the proxy must have returned a 200 — meaning the engine
    // accepted the bearer and resolved the right tenant. (Any 4xx
    // here would mean the routing didn't find the broberg tenant.)
    expect((result.rawJson as Record<string, unknown>).error).toBeUndefined();
  });

  test('Sanne bearer cannot read broberg-ai-only KB (trail-research)', async ({
    page,
  }) => {
    // Boot the demo with Sanne's bearer but configure it to ASK FOR
    // broberg-ai's trail-research KB. Engine should 404 because
    // trail-research doesn't exist in Sanne's DB.
    demo = spawnDemo({ bearer: SANNE_BEARER, kb: 'trail-research' });
    await waitForDemoReady(demo);

    await page.goto('/');
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith('/api/chat-proxy/chat') && res.request().method() === 'POST',
      { timeout: 30_000 },
    );
    const textarea = page.locator('trail-chat').locator('css=textarea').first();
    await textarea.fill('Hej Trail');
    await page.keyboard.press('Enter');
    const res = await responsePromise;
    // 404 or some 4xx — anything but 200 with a Sanne-KB answer is OK.
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
