import { expect, test, type Page } from '@playwright/test';

import { openCounter, search } from './support/counter';

/**
 * PCN-012, final pass: a pack set up wrong is fixed without losing anything.
 *
 *  - "Replace this product" moves the stock to a product with the right pack,
 *    at the count the owner confirms, and retires the old one.
 *  - A unit can be renamed after stock exists; its size cannot change.
 *
 * A fresh product per run, so the spec passes against a database it has run
 * on before (CLAUDE.md, Day 20).
 */

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

async function openProduct(page: Page, name: string): Promise<void> {
  await page.goto(`/products?q=${encodeURIComponent(name)}`);
  await page.getByRole('link', { name }).first().click({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });
}

test('replace a product set up with the wrong strip: stock moves at the confirmed count', async ({
  page,
}) => {
  const name = `Wrongpack ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);

  // Two boxes on the shelf, recorded under the wrong pack.
  await page.goto('/stock/adjust?opening=1');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await search(page).fill(name.toLowerCase());
  await page.getByRole('option').first().click({ timeout: 30_000 });
  await page.getByLabel('box', { exact: true }).fill('2');
  await page.getByLabel(/^Cost per box/).fill('250');
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved.', { exact: false })).toBeVisible();

  await openProduct(page, name);
  await page.getByRole('link', { name: 'Replace this product' }).click();
  await expect(page.getByRole('heading', { name: 'Replace this product' })).toBeVisible({
    timeout: 30_000,
  });

  // The strips really hold 14, and there is no box.
  await page.getByLabel('Pack levels').fill('strip:14');
  const batch = page.getByRole('group', { name: /Batch/ }).first();
  await expect(batch).toContainText('Recorded: 2 box');
  // No box on the new pack: the old count arrives loose, for the owner to check.
  await expect(batch.getByLabel('tab', { exact: true })).toHaveValue('200');
  await batch.getByLabel('strip', { exact: true }).fill('14');
  await batch.getByLabel('tab', { exact: true }).fill('4');
  await expect(batch).toContainText('= 200 tab');
  await page.getByLabel('Why').fill('strips hold 14');
  await page.getByRole('button', { name: 'Replace and move the stock' }).click();

  // It lands on the new product, saying what moved.
  await expect(page.getByRole('status', { name: 'Replaced' })).toContainText('1 batch moved', {
    timeout: 30_000,
  });
  await expect(page.getByText('14 strip, 4 tab on hand')).toBeVisible();

  // The new product has stock, so its strip size is fixed — but it can be renamed.
  await page.getByLabel('Pack levels').fill('pack:14');
  await page.getByLabel('Price per pack').fill('70');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page).toHaveURL(/\/products$/, { timeout: 30_000 });
  await openProduct(page, name);
  await expect(page.getByText('14 pack, 4 tab on hand')).toBeVisible();

  // A size change is still refused, and says what to do instead.
  await page.getByLabel('Pack levels').fill('pack:10');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'pack sizes cannot change' }),
  ).toContainText('Replace this product');
});
