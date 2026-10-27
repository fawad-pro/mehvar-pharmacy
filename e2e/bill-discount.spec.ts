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
 * [PCN-014] The bill discount, as the counter gives it: the amount to collect,
 * typed on the payment screen. The figure to take is the largest on screen;
 * a discount over the shop's limit needs the owner's PIN; the receipt shows
 * the bill discount on its own row.
 *
 * Three strips of Panadol: a Rs 105.00 bill, under the default 10% limit at
 * Rs 100 and over it at Rs 80.
 */

async function threeStrips(page: Page): Promise<void> {
  await search(page).fill('3*panadol');
  // After a navigation the index loads again; Enter before it has an answer
  // adds nothing.
  await expect(page.getByRole('option').first()).toContainText('Panadol', { timeout: 30_000 });
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('105.00');
}

const OWNER_PIN = '1234';

const payment = (page: Page) => page.getByRole('dialog', { name: 'Payment' });

test('within the limit: % , the amount to collect, Enter — by keyboard', async ({ page }) => {
  await openCounter(page);
  await threeStrips(page);

  await page.keyboard.press('F12');
  await expect(payment(page).getByLabel('Amount due')).toHaveText('105.00');
  await page.keyboard.press('%');
  const collect = payment(page).getByLabel('Amount to collect');
  await expect(collect).toBeFocused();
  // Filled, not typed: digits then Enter at machine speed is a scan, and the
  // scan guard rightly keeps it out of an amount field (CLAUDE.md, PCN-013).
  await collect.fill('100');
  await page.keyboard.press('Enter');

  // The figure to take is the largest on the screen, and says what it is.
  await expect(payment(page).getByLabel('Collect', { exact: true })).toHaveText('100.00');
  await expect(payment(page).getByLabel('Bill discount')).toContainText(
    'Bill 105.00 · Discount 5.00',
  );
  await expect(payment(page).getByLabel('Cash tendered')).toBeFocused();
  await expect(payment(page).getByLabel('Cash tendered')).toHaveValue('100.00');
  await page.keyboard.press('Enter');

  await expect(lastSale(page)).toContainText('Rs 100.00');
  await expect(receipt(page)).toContainText('Bill Discount');
  await expect(receipt(page)).toContainText('-5.00');
  await expect(receipt(page)).toContainText('100.00');
});

test('over the limit with a wrong PIN: Esc sells at the full amount', async ({ page }) => {
  await openCounter(page);
  await threeStrips(page);

  await page.keyboard.press('F12');
  await page.keyboard.press('%');
  await payment(page).getByLabel('Amount to collect').fill('80');
  await page.keyboard.press('Enter');

  const pin = payment(page).getByLabel('Owner’s PIN');
  await expect(pin).toBeFocused();
  await expect(payment(page)).toContainText('over the shop’s limit of 10%');
  await pin.fill('9999');
  await page.keyboard.press('Enter');
  await expect(payment(page).getByRole('alert')).toContainText('not the owner’s PIN');

  await page.keyboard.press('Escape');
  await expect(payment(page).getByLabel('Amount due')).toHaveText('105.00');
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText('Rs 105.00');
  await expect(receipt(page)).not.toContainText('Bill Discount');
});

test('over the limit: the owner’s PIN approves, and the screen says who', async ({ page }) => {
  await openCounter(page);
  await threeStrips(page);

  await page.keyboard.press('F12');
  await page.keyboard.press('%');
  await payment(page).getByLabel('Amount to collect').fill('80');
  await page.keyboard.press('Enter');
  // The demo owner's PIN (scripts/db/seed.ts).
  await payment(page).getByLabel('Owner’s PIN').fill(OWNER_PIN);
  await page.keyboard.press('Enter');

  await expect(payment(page).getByLabel('Collect', { exact: true })).toHaveText('80.00');
  await expect(payment(page).getByLabel('Bill discount')).toContainText(
    `Approved by ${DEMO.owner}`,
  );
  await page.keyboard.press('Enter');

  await expect(lastSale(page)).toContainText('Rs 80.00');
  await expect(receipt(page)).toContainText('Bill Discount');
  await expect(receipt(page)).toContainText('-25.00');

  // Step 4: the owner sees it afterwards — on the day's list, and on the
  // receipt page, each line showing its share and what it paid.
  const number = (await lastSale(page).textContent())?.match(/Saved — ([A-Z]+-\d+)/)?.[1];
  expect(number).toBeTruthy();
  await page.keyboard.press('F9');
  await expect(page).toHaveURL(/\/day$/);
  const row = page.getByRole('listitem').filter({ hasText: number! });
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

  await page.keyboard.press('F12');
  await page.getByRole('button', { name: 'Bill discount — %' }).click();
  const collect = payment(page).getByLabel('Amount to collect');
  await collect.fill('200');
  await page.keyboard.press('Enter');
  await expect(payment(page).getByRole('alert')).toContainText('more than the bill');
  await collect.fill('abc');
  await page.keyboard.press('Enter');
  await expect(payment(page).getByRole('alert')).toContainText('Type the amount');
  await page.keyboard.press('Escape');
  await expect(payment(page).getByLabel('Amount due')).toHaveText('105.00');
  await page.keyboard.press('Escape');
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
    await page.keyboard.press('F12');
    await page.keyboard.press('%');
    await payment(page).getByLabel('Amount to collect').fill('104');
    await page.keyboard.press('Enter');
    await expect(payment(page)).toContainText('over the shop’s limit of 0%');
    await expect(payment(page).getByLabel('Owner’s PIN')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  } finally {
    await setLimit(page, '10');
  }
});
