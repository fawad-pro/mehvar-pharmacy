import { expect, test, type Page } from '@playwright/test';

import { openCounter, search } from './support/counter';

/**
 * A picker's Enter means the same thing on a slow connection as on a fast one.
 *
 * Both pickers acted on whatever list had last arrived. On a fast server that
 * is the list for what was typed; on a slow one — a tablet over shop Wi-Fi —
 * it was the list for fewer letters, or none: "Rashid" + Enter created a
 * second customer called "Rashid" and put the udhaar on them, and a new
 * supplier's name + Enter put the delivery on whichever supplier listed first.
 */

async function slowServerActions(page: Page, ms: number): Promise<void> {
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    await route.fallback();
  });
}

test('the customer picker: a name and Enter pick that customer, however slow the answer', async ({
  page,
}) => {
  await openCounter(page);
  await search(page).fill('panadol');
  await expect(page.getByRole('option').first()).toContainText('Panadol', { timeout: 30_000 });
  await page.keyboard.press('Enter');

  await slowServerActions(page, 1_500);
  await page.keyboard.press('F4');
  const picker = page.getByRole('dialog', { name: 'Attach customer' });
  await expect(picker.getByPlaceholder('Name or phone…')).toBeFocused();
  await page.keyboard.type('Rashid', { delay: 100 });
  await page.keyboard.press('Enter');

  await expect(picker).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText(/Rashid Sahib/).first()).toBeVisible();
});

test('the supplier picker: a new name and Enter add that supplier, however slow the answer', async ({
  page,
}) => {
  const name = `Slow Distributor ${Date.now()}`;
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await page.getByRole('button', { name: 'Supplier' }).click({ timeout: 30_000 });
  const picker = page.getByRole('dialog', { name: 'Supplier' });
  await expect(picker.getByPlaceholder('Name or phone…')).toBeFocused();

  await slowServerActions(page, 1_500);
  // At a person's speed: digits then Enter at machine speed is a scan.
  await page.keyboard.type(name, { delay: 100 });
  await page.keyboard.press('Enter');

  await expect(picker).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Supplier' })).toContainText(name);
});

test('Returns: a receipt number and Enter open that sale, however slow the answer', async ({
  page,
}) => {
  await openCounter(page);
  const sell = async () => {
    await search(page).fill('disprin');
    await expect(page.getByRole('option').first()).toContainText('Disprin', { timeout: 30_000 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('F12');
    await page.keyboard.press('Enter');
    const lastSale = page.getByRole('status', { name: 'Last sale' });
    await expect(lastSale).toContainText(/Saved — /);
    return (await lastSale.textContent())?.match(/Saved — ([A-Za-z]+-\d+)/)?.[1];
  };
  // Two sales. One number is looked up first, so the list on screen is that
  // single sale; then the other number is typed and Enter pressed before its
  // answer arrives. Acting on the list on screen opens the wrong sale.
  const first = await sell();
  const second = await sell();
  expect(first).toBeTruthy();
  expect(second).not.toBe(first);

  await page.goto('/returns');
  const find = page.getByLabel('Receipt number or customer name');
  await expect(find).toBeFocused({ timeout: 30_000 });
  await find.fill(first!);
  await expect(page.getByRole('button', { name: new RegExp(`^${first!}`) })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('listitem')).toHaveCount(1);

  await slowServerActions(page, 1_500);
  await find.fill(second!);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel(/Return quantity for Disprin/)).toBeFocused({ timeout: 15_000 });
  await expect(page.locator('main').getByText(second!, { exact: true })).toBeVisible();
});
