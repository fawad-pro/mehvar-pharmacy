import { expect, test } from '@playwright/test';

import { cart, openCounter, printedReceipt, search } from './support/counter';

/**
 * PCN-006's promise, made executable.
 *
 * The licence model is perpetual: a valid, bound licence authorizes an
 * installation forever, and the seeded demo ships with a dev perpetual licence
 * bound to this machine (see `scripts/db/seed.ts`). What only a browser can
 * prove is the lived result of that — an authorized pharmacy shows NO licence
 * banner, sells by keyboard, prints from local state, and can take its data.
 *
 * The restricted tier (unauthorized / unbound / invalid / revoked) is not
 * reachable through the product's own door on a perpetual, bound demo — the
 * Settings panel verifies-then-binds a pasted token to THIS machine, so it can
 * only ever move the demo toward authorized. What restricted withholds, and
 * that it never strands captured sales, is proven where it actually lives:
 * `state.test.ts` (the evaluator), `capture-policy.test.ts` (the L1 capture
 * seam), `licence-gating.test.ts` (the server gate sweep) and the DB-backed
 * `licence-queries.integration.test.ts` / `licence-refresh.integration.test.ts`.
 */

test('the authorized demo sells, prints and exports, with no licence banner', async ({ page }) => {
  await openCounter(page);

  // A perpetual, bound licence shows no banner at all: a banner that is always
  // there is furniture, and furniture does not get read.
  await page.goto('/sale');
  await expect(page.getByRole('note', { name: 'Licence' })).toHaveCount(0);

  // --- Selling by keyboard. W1 verbatim. ----------------------------------
  await search(page).fill('panadol');
  await expect(page.getByRole('option').first()).toContainText('Panadol');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('Panadol');

  await page.keyboard.press('F12');
  await page.keyboard.press('Enter');

  // A receipt in hand — T5, printed from local state, never from a licence check.
  await expect(printedReceipt(page)).toContainText('Panadol', { timeout: 15_000 });

  // --- Export is open. T3, and Phase 3 §3 in so many words. ---------------
  const exported = await page.request.get('/api/export');
  expect(exported.status()).toBe(200);
  expect(exported.headers()['content-type']).toContain('zip');

  // --- The Settings panel states the perpetual standing plainly. ----------
  await page.goto('/settings');
  await expect(page.getByText(/never expires/)).toBeVisible();
  await expect(page.getByText('Paused until activated:')).toHaveCount(0);
});
