import { expect, test, type Page } from '@playwright/test';

import { cart, lastSale, openCounter, payAndSettle, search, total } from './support/counter';

/**
 * PCN-012 at the counter, as the owner amended it on 2026-10-26: every unit
 * the product has is a button on the cart line, beside − count +, because a
 * tablet has neither Tab nor a plus key. The keyboard path (Tab, +, −) is the
 * same edit and still works.
 *
 * Which button starts pressed: the unit this counter last SOLD the product in,
 * else the shop's setting — the strip, or the loose tablet. The spec turns the
 * setting on in one test and always puts it back: the suite shares one
 * database.
 *
 * Fresh products per run, so the spec passes against a database it has run on
 * before (CLAUDE.md, Day 20).
 */

async function setStartsLoose(page: Page, value: boolean): Promise<void> {
  await page.goto('/settings');
  const box = page.getByLabel('Start sales in loose tablets/capsules');
  await expect(box).toBeVisible({ timeout: 30_000 });
  await box.setChecked(value);
  await page.getByRole('button', { name: 'Save selling setting' }).click();
  await expect(page.locator('div').filter({ has: box }).last().getByRole('status')).toHaveText(
    'Saved.',
  );
}

/** A product with no stock: tab, strip of 10 at Rs 40, box of 10 strips. */
async function newProduct(page: Page, name: string): Promise<void> {
  await page.goto('/products/new');
  await page.getByRole('button', { name: 'Not in the list — enter it myself' }).click({
    timeout: 30_000,
  });
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Base unit').fill('tab');
  await page.getByLabel('Pack levels').fill('strip:10, box:100');
  await page.getByLabel('Price per strip').fill('40');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page).toHaveURL(/\/products$/, { timeout: 30_000 });
}

async function addToCart(page: Page, name: string): Promise<void> {
  await search(page).fill(name.toLowerCase());
  await expect(page.getByRole('option').first()).toContainText(name, { timeout: 30_000 });
  await page.keyboard.press('Enter');
}

test.afterEach(async ({ page }) => {
  // Leave the shop's setting as the seed has it, whatever happened above.
  await setStartsLoose(page, false);
});

test('every unit on the line; buttons and keys change it; the next sale starts where the last one ended', async ({
  page,
}) => {
  const name = `Unitbtn ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);

  await page.goto('/sale');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await addToCart(page, name);

  // All three units, the strip pressed: the shop's default for a product
  // this counter has never sold.
  const units = cart(page).getByRole('group', { name: `Unit for ${name}` });
  await expect(units.getByRole('button')).toHaveText(['tab', 'strip', 'box'], {
    ignoreCase: true,
  });
  await expect(units.getByRole('button', { name: 'strip' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(cart(page)).toContainText('1 strip');
  await expect(total(page)).toHaveText('Rs 40.00');

  // By pointer: box, then + and −, each at the box's own price.
  await units.getByRole('button', { name: 'box' }).click();
  await expect(cart(page)).toContainText('1 box');
  await expect(total(page)).toHaveText('Rs 400.00');
  await cart(page).getByRole('button', { name: 'One box more' }).click();
  await expect(cart(page)).toContainText('2 box');
  await expect(total(page)).toHaveText('Rs 800.00');
  await cart(page).getByRole('button', { name: 'One box less' }).click();
  await expect(cart(page)).toContainText('1 box');

  // By keyboard: Tab cycles every unit and keeps the count.
  await cart(page).getByRole('row').filter({ hasText: name }).focus();
  await page.keyboard.press('Tab');
  await expect(cart(page)).toContainText('1 tab');
  await expect(total(page)).toHaveText('Rs 4.00');
  await page.keyboard.press('Tab');
  await expect(cart(page)).toContainText('1 strip');
  await page.keyboard.press('Tab');
  await expect(cart(page)).toContainText('1 box');
  await page.keyboard.press('+');
  await expect(cart(page)).toContainText('2 box');
  await expect(total(page)).toHaveText('Rs 800.00');

  await payAndSettle(page);
  await expect(lastSale(page)).toContainText('800.00');

  // Two boxes leave the shelf as 200 tablets. The product had no stock, so
  // all of it shows as sold ahead of stock (D2) — the unit reached the
  // ledger — stated in the product's own units (PCN-012).
  await page.goto('/stock');
  await expect(
    page
      .getByRole('region', { name: 'Sold more than the system had' })
      .getByRole('listitem')
      .filter({
        hasText: name,
      }),
  ).toContainText('2 box', { timeout: 30_000 });

  // The next line of this product starts in the unit it was last sold in.
  await page.goto('/sale');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await addToCart(page, name);
  await expect(units.getByRole('button', { name: 'box' })).toHaveAttribute('aria-pressed', 'true');
  await expect(total(page)).toHaveText('Rs 400.00');

  // − on a single box removes the line, as − does from the keyboard.
  await cart(page)
    .getByRole('button', { name: `Remove ${name}` })
    .click();
  await expect(
    page.getByText('Scan a barcode or type a name — Enter puts it on the bill.'),
  ).toBeVisible();
});

test('a shop that starts sales loose starts a never-sold product in tablets', async ({ page }) => {
  const name = `Unitloose ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);
  await setStartsLoose(page, true);

  await page.goto('/sale');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await addToCart(page, name);
  const units = cart(page).getByRole('group', { name: `Unit for ${name}` });
  await expect(units.getByRole('button', { name: 'tab' })).toHaveAttribute('aria-pressed', 'true');
  await expect(cart(page)).toContainText('1 tab');
  await expect(total(page)).toHaveText('Rs 4.00');
});
