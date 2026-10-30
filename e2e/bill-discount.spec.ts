import { expect, test, type Page } from '@playwright/test';

import {
  DEMO,
  lastSale,
  openCounter,
  printedReceipt as receipt,
  search,
  total,
} from './support/counter';

/**
 * [PCN-014, PCN-015] The bill discount, as the counter gives it: what comes
 * off, "5" or "10%", typed into a field on the sale screen. It applies as it
 * is typed, and the figure to take is the largest on screen; a discount over
 * the shop's limit needs the owner's PIN, and Pay waits for it; the receipt
 * shows the bill discount on its own row.
 *
 * Three strips of Panadol: a Rs 105.00 bill, under the default 10% limit at
 * Rs 5 off and over it at Rs 25 off.
 */

async function threeStrips(page: Page): Promise<void> {
  await search(page).fill('3*panadol');
  await expect(page.getByRole('option').first()).toContainText('Panadol', { timeout: 30_000 });
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('Rs 105.00');
}

const OWNER_PIN = '1234';

const discount = (page: Page) => page.locator('#bill-discount');
const cashReceived = (page: Page) => page.locator('#cash-received');
const pay = (page: Page) => page.getByRole('button', { name: /^Pay/ });

test('within the limit: what comes off, Pay — by keyboard', async ({ page }) => {
  await openCounter(page);
  await threeStrips(page);

  // In view and empty before anything is pressed, saying what to type.
  await expect(discount(page)).toHaveValue('');
  await expect(discount(page)).toHaveAttribute('placeholder', 'Amount or %');
  await discount(page).fill('5');
  // Applied as typed: the screen never shows one price while Pay charges another.
  await expect(total(page)).toHaveText('Rs 100.00');
  await expect(page.getByLabel('Bill discount')).toContainText(
    '-Rs 5.00',
  );
  await expect(cashReceived(page)).toHaveValue('100.00');
  await page.keyboard.press('F12');

  await expect(lastSale(page)).toContainText('Rs 100.00');
  await expect(receipt(page)).toContainText('Bill Discount');
  await expect(receipt(page)).toContainText('-5.00');
  await expect(receipt(page)).toContainText('100.00');
});

test('over the limit with a wrong PIN: Esc sells at the full amount', async ({ page }) => {
  await openCounter(page);
  await threeStrips(page);

  await discount(page).fill('25');
  // Nothing is sold at a price the owner has not approved.
  await expect(pay(page)).toBeDisabled();
  await page.keyboard.press('Enter');

  const pin = page.getByLabel('Owner’s PIN');
  await expect(pin).toBeFocused();
  await expect(page.locator('aside')).toContainText('Over the shop’s limit of 10%');
  await pin.fill('9999');
  await page.keyboard.press('Enter');
  await expect(page.locator('aside').getByRole('alert')).toContainText('not the owner’s PIN');

  await page.keyboard.press('Escape');
  await expect(total(page)).toHaveText('Rs 105.00');
  await expect(discount(page)).toHaveValue('');
  await expect(cashReceived(page)).toHaveValue('105.00');
  await page.keyboard.press('F12');
  await expect(lastSale(page)).toContainText('Rs 105.00');
  await expect(receipt(page)).not.toContainText('Bill Discount');
});

test('over the limit: the owner’s PIN approves, and the screen says who', async ({ page }) => {
  await openCounter(page);
  await threeStrips(page);

  await discount(page).fill('25');
  await page.keyboard.press('Enter');
  // The demo owner's PIN (scripts/db/seed.ts).
  await page.getByLabel('Owner’s PIN').fill(OWNER_PIN);
  await page.keyboard.press('Enter');

  await expect(total(page)).toHaveText('Rs 80.00');
  await expect(page.getByLabel('Bill discount')).toContainText(
    `by ${DEMO.owner}`,
  );
  await expect(cashReceived(page)).toBeFocused();
  await expect(cashReceived(page)).toHaveValue('80.00');
  await page.keyboard.press('F12');

  await expect(lastSale(page)).toContainText('Rs 80.00');
  await expect(receipt(page)).toContainText('Bill Discount');
  await expect(receipt(page)).toContainText('-25.00');

  // Step 4: the owner sees it afterwards — on the day's list, and on the
  // receipt page, each line showing its share and what it paid.
  const number = (await lastSale(page).textContent())?.match(/Saved — ([A-Z]+-\d+)/)?.[1];
  expect(number).toBeTruthy();
  await page.keyboard.press('F9');
  await expect(page).toHaveURL(/\/day$/);
  // By the link, exactly: by text, A-4's row also matched A-41.
  const row = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: number!, exact: true }) });
  await expect(row).toContainText('Bill discount', { timeout: 30_000 });
  await expect(row).toContainText('105.00 → 80.00');
  await expect(row).toContainText(`approved by ${DEMO.owner}`);
  await expect(row).toContainText('-25.00');
  await expect(page.getByText(/Discounts Rs/)).toBeVisible();

  await row.getByRole('link', { name: number! }).click();
  // Until the receipt page arrives, the day's list is what matches: every
  // earlier run's bill discounts are rows on it.
  await expect(page).toHaveURL(new RegExp(`/receipts/${number!}$`), { timeout: 30_000 });
  await expect(page.getByText('Bill discount', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Approved by ${DEMO.owner}`)).toBeVisible();
  await expect(page.getByText('−25.00 bill discount · paid 80.00')).toBeVisible();
});

test('more than the bill is refused, and junk is never read as Rs 0', async ({ page }) => {
  await openCounter(page);
  await threeStrips(page);

  await discount(page).click();
  await discount(page).fill('200');
  await expect(page.locator('aside').getByRole('alert')).toContainText('More than bill');
  await expect(pay(page)).toBeDisabled();
  await discount(page).fill('abc');
  await expect(page.locator('aside').getByRole('alert')).toContainText('e.g. 50 or 10%');
  await expect(total(page)).toHaveText('Rs 105.00');
  await expect(pay(page)).toBeDisabled();
  await discount(page).fill('');
  await expect(pay(page)).toBeEnabled();
});

async function setLimit(page: Page, percent: string): Promise<void> {
  await page.goto('/settings');
  const field = page.getByLabel('Discount limit without the owner (%)');
  await expect(field).toBeVisible({ timeout: 30_000 });
  await expect(field).not.toHaveValue('');
  await field.fill(percent);
  await page.getByRole('button', { name: 'Save selling setting' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  // Read back: the suite shares one database, so a limit left behind would
  // change what every later spec's payment screen asks for.
  await page.reload();
  await expect(page.getByLabel('Discount limit without the owner (%)')).toHaveValue(percent, {
    timeout: 30_000,
  });
}

test('the owner sets the limit; at 0 every bill discount needs the PIN', async ({ page }) => {
  await openCounter(page);
  await setLimit(page, '0');
  try {
    await page.goto('/sale');
    await threeStrips(page);
    await discount(page).fill('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('aside')).toContainText('Over the shop’s limit of 0%');
    await expect(page.getByLabel('Owner’s PIN')).toBeFocused();
    await page.keyboard.press('Escape');
  } finally {
    await setLimit(page, '10');
  }
});
