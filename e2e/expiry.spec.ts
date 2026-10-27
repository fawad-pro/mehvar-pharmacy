import { expect, test, type Page } from '@playwright/test';

import { SEED_PRODUCTS } from '../scripts/db/seed-data';

import { cart, lastSale, openCounter, search, unsynced } from './support/counter';

/**
 * PCN-008: expired stock is the last stock a sale reaches, and never silently.
 *
 * Earliest-expiry-first used to sell an expired batch before a good one,
 * because an expired batch is always the earliest. Now unexpired stock goes
 * first; a line that needs more than that is warned about, naming the expiry,
 * before payment; and the sale lands on the owner's exception list.
 *
 * Concor is used by no other spec. The quantity is sized from what the system
 * holds now, so the test passes against a database it has run on before.
 */

const PRODUCT = 'Concor';

async function receiveExpired(page: Page): Promise<void> {
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await search(page).fill(PRODUCT.toLowerCase());
  await page.getByRole('option').first().click();
  await page.getByLabel(/^Qty/).fill('10');
  await page.getByLabel(/^Cost \//).fill('5.00');
  await page.getByLabel('Expiry').fill('2020-01-01');
  await page.getByLabel(/^Cost \//).press('Enter');
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByRole('status', { name: 'Received' })).toContainText('1 batch');
}

/** Whole strips that ask for more than the unexpired stock, by one strip. */
async function stripsBeyondUnexpired(page: Page): Promise<number> {
  const perStrip = SEED_PRODUCTS.find((p) => p.name === PRODUCT)?.packLevels[0]?.factor ?? 1;
  const response = await page.request.get('/api/catalog');
  expect(response.ok()).toBe(true);
  const snapshot = (await response.json()) as {
    products: Array<{ id: string; name: string }>;
    stock: Record<string, number>;
    expired: Record<string, { qtyBase: number; expiryDate: string }>;
  };
  const product = snapshot.products.find((row) => row.name === PRODUCT);
  expect(product, `${PRODUCT} is in the catalog`).toBeDefined();
  const id = product?.id ?? '';
  expect(snapshot.expired[id]?.qtyBase ?? 0, 'expired stock was received').toBeGreaterThan(0);
  const unexpired = Math.max(0, (snapshot.stock[id] ?? 0) - (snapshot.expired[id]?.qtyBase ?? 0));
  return Math.floor(unexpired / perStrip) + 1;
}

test('expired stock is warned about before payment and listed for the owner', async ({ page }) => {
  await openCounter(page);
  await receiveExpired(page);

  await page.keyboard.press('F1');
  await expect(page).toHaveURL(/\/sale$/);
  const strips = await stripsBeyondUnexpired(page);
  // The counter's index must have the received batch before it can warn.
  await page.reload();
  await expect(page.getByText(/\d+ products/)).toBeVisible({ timeout: 45_000 });

  await search(page).fill(`${strips}*${PRODUCT.toLowerCase()}`);
  await expect(page.getByRole('option').first()).toContainText(PRODUCT);
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText(/expired stock/);
  await expect(cart(page)).toContainText(/expired \d{4}-\d{2}-\d{2}/);

  // Warned, never blocked (P2).
  await page.keyboard.press('F12');
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);
  await expect(unsynced(page)).toBeHidden({ timeout: 20_000 });

  await page.keyboard.press('F9');
  await expect(page).toHaveURL(/\/day/);
  await expect(page.getByText(/expired sale/)).toBeVisible();
  const group = page.getByRole('heading', { name: /Expired stock sold/ }).locator('..');
  await expect(group).toContainText(PRODUCT);
});
