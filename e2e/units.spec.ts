import { expect, test } from '@playwright/test';

import { cart, lastSale, openCounter, printedReceipt, search, total } from './support/counter';

/**
 * PCN-012: the owner types the price of the box they sell, and a box sells at
 * exactly that price.
 *
 * A box of 14 capsules at Rs 250 is the case per-base storage could not hold:
 * 25,000 ÷ 14 is not a whole number of paisa, so a box came out at Rs 250.04
 * or Rs 249.90. Now it is Rs 250.00 on the line, the total and the receipt.
 *
 * A fresh product per run, so the spec passes against a database it has run on
 * before (CLAUDE.md, Day 20).
 */
test('a box priced by the owner sells at exactly that price (PCN-012)', async ({ page }) => {
  const name = `Unitcap ${Date.now()}`;
  await openCounter(page);

  await page.goto('/products/new');
  await page.getByRole('button', { name: 'Not in the list — enter it myself' }).click({
    timeout: 30_000,
  });
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Base unit').fill('cap');
  await page.getByLabel('Pack levels').fill('box:14');
  await page.getByLabel('Price per box').fill('250');
  // The capsule price is suggested, rounded up so it never undercuts the box.
  await expect(page.getByLabel('Price per cap')).toHaveAttribute('placeholder', '17.86');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page).toHaveURL(/\/products$/, { timeout: 30_000 });

  // A reload picks the new product up in the counter's index.
  await page.goto('/sale');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await search(page).fill(name.toLowerCase());
  await expect(page.getByRole('option').first()).toContainText(name, { timeout: 30_000 });
  await page.keyboard.press('Enter');
  // A new line starts at the smallest pack (I3), at that pack's own price.
  await expect(cart(page)).toContainText('1 box');
  await expect(total(page)).toHaveText('Rs 250.00');

  const line = cart(page).getByRole('row').filter({ hasText: name });
  await line.focus();
  await page.keyboard.press('+');
  await expect(cart(page)).toContainText('2 box');
  await expect(total(page)).toHaveText('Rs 500.00');

  // Tab keeps the count and moves to the next unit at ITS price: two capsules
  // at the suggested Rs 17.86 — then back to two boxes at Rs 250 each.
  await page.keyboard.press('Tab');
  await expect(cart(page)).toContainText('2 cap');
  await expect(total(page)).toHaveText('Rs 35.72');
  await page.keyboard.press('Tab');
  await expect(cart(page)).toContainText('2 box');
  await expect(total(page)).toHaveText('Rs 500.00');

  await page.keyboard.press('F12');
  await expect(page.getByRole('dialog', { name: 'Payment' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText('500.00');
  // The slip prints the count as sold under QTY — 2 (boxes), never the 28
  // capsules they hold (P9). The unit word is off the slip by the owner's choice.
  await expect(
    printedReceipt(page).getByText(name).locator('xpath=preceding-sibling::span[1]'),
  ).toHaveText('2');
  await expect(printedReceipt(page)).toContainText('500.00');
});
