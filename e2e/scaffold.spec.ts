import { expect, test } from '@playwright/test';

/**
 * Scaffold smoke check. Replaced in Session 8 / Day 8 by the one E2E path that
 * matters: W1 by keyboard (Phase 11 §3.5).
 */
test('the application boots and renders with tokens applied', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const background = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
  );
  expect(background).not.toBe('');
});
