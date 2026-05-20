/**
 * Verify the admin chat panel renders the image carousel when the
 * engine returns image hits, end-to-end through the real UI.
 *
 * Targets local admin on :58031 + local engine on :58021. The local
 * Sanne-andersen KB has 310 vision-described images and 7 hits for
 * the "gul blomst" FTS query — same retrieval path prod uses.
 *
 * Asserts the visible failure mode Christian saw: LLM acknowledges
 * "Der er N billeder" but admin renders zero. Test fails if the
 * carousel grid is missing even though images came back.
 */
import { test, expect } from '@playwright/test';

const ADMIN = 'http://127.0.0.1:58031';

test('Tool audience renders image carousel for "gule blomster" query', async ({
  page,
  context,
}) => {
  // 1. dev-login establishes the session cookie. Use `load` not
  // `networkidle` because the admin SPA opens SSE streams that
  // never settle — networkidle waits forever.
  await page.goto(`${ADMIN}/api/auth/dev-login`, { waitUntil: 'load' });

  // 2. Navigate to the sanne-andersen KB chat panel.
  await page.goto(`${ADMIN}/kb/sanne-andersen/chat`, { waitUntil: 'load' });

  // 3. Click the Tool audience pill in the segmented control.
  // The selector uses `role="group"` with three <button>s; click the
  // one labelled "Tool" (matches both EN and current text).
  const toolButton = page.getByRole('group', { name: /chat audience/i })
    .getByRole('button', { name: 'Tool' });
  await expect(toolButton).toBeVisible({ timeout: 10_000 });
  await toolButton.click();

  // 4. Type the canonical image-search query in the chat textarea.
  // The admin panel uses a textarea (Spørg om hvad som helst i denne Trail…)
  // anchored at the bottom of the feed.
  const textarea = page.locator('textarea').first();
  await textarea.fill('Vis mig billeder af gule blomster');

  // 5. Submit — Enter triggers send (Shift+Enter is newline per the
  // hint text). The chat handler can take 5-30s for the LLM round-trip.
  // Capture the /chat response so we can prove what came back from
  // the server — separates "engine returned no images" from
  // "SPA failed to render returned images".
  const responsePromise = page.waitForResponse(
    (res) => res.url().endsWith('/api/v1/chat') && res.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await textarea.press('Enter');
  const response = await responsePromise;
  const body = await response.json();
  // eslint-disable-next-line no-console
  console.log('[chat-response] images count:', body.images?.length ?? 'undefined');
  // eslint-disable-next-line no-console
  console.log('[chat-response] images key present:', 'images' in body);
  // eslint-disable-next-line no-console
  console.log('[chat-response] answer:', String(body.answer ?? '').slice(0, 120));

  // 6. The server must have returned images for the renderer to have
  // anything to display.
  expect(body.images?.length ?? 0).toBeGreaterThan(0);

  // Give the SPA a moment to setState + render.
  await page.waitForTimeout(2_000);

  // Capture diagnostic: screenshot + answer-block HTML.
  await page.screenshot({ path: 'test-results/admin-after-chat.png', fullPage: true });
  const answerBlocks = await page.locator('[class*="prose-body"]').count();
  // eslint-disable-next-line no-console
  console.log('[dom] answer block count:', answerBlocks);
  const allImgs = await page.locator('img').count();
  // eslint-disable-next-line no-console
  console.log('[dom] total <img> elements on page:', allImgs);

  // 7. The carousel must contain at least one <img> element with a
  // /api/v1/documents/.../images/... src — that's the load-bearing
  // proof that the SPA is rendering returned image-rows.
  const carouselImgs = page.locator('img[src*="/api/v1/documents/"]');
  const count = await carouselImgs.count();
  // eslint-disable-next-line no-console
  console.log('[dom] image carousel <img> count:', count);
  expect(count).toBeGreaterThan(0);

  // 8. As a sanity bonus, capture the chat response payload too via
  // a network interception, to compare against the rendered count.
  // (Already arrived by the time the carousel rendered — we just
  // re-fetch via the page's context if we want to compare.)
});
