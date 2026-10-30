import { expect, test } from '@playwright/test';

import { lastSale, openCounter, search } from './support/counter';

/**
 * The next key after a sale goes where it says.
 *
 * The outbox delivers a sale a moment after it is saved, and `RefreshOnSync`
 * refreshed the page the instant it did — which cancelled any navigation in
 * flight. A link or a function key pressed right after a sale did nothing
 * about one time in eight (4 of 32 in the run that found it). Twenty sales,
 * each followed at once by a link click or F5: every one must arrive.
 *
 * Probabilistic by nature: the old code passed this now and then, so a single
 * green run is not proof of a fix — but a red run is proof of a regression.
 */
test('a link or a function key right after a sale always navigates', async ({ page }) => {
  test.setTimeout(240_000);
  await openCounter(page);

  for (let sale = 0; sale < 20; sale += 1) {
    await page.goto('/sale');
    await search(page).fill('panadol');
    await expect(page.getByRole('option').first()).toContainText('Panadol', {
      timeout: 30_000,
    });
    await page.keyboard.press('Enter');
    await page.keyboard.press('F12');
    await expect(lastSale(page)).toContainText(/Saved — A-\d+/);

    if (sale % 2 === 0) {
      await page.getByRole('link', { name: 'Settings' }).click();
      await expect(page, `sale ${sale + 1}: the Settings link was lost`).toHaveURL(/\/settings$/);
    } else {
      await page.keyboard.press('F5');
      await expect(page, `sale ${sale + 1}: F5 was lost`).toHaveURL(/\/products$/);
    }
  }
});
