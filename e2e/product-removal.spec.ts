import { expect, test, type Page } from '@playwright/test';

import { openCounter, search } from './support/counter';

/**
 * A product entered by mistake can be removed, by keyboard, and put back.
 *
 *  - Removed, it leaves the counter's search and the Products list; "Show
 *    removed products" finds it again, with Restore.
 *  - With stock on hand it is refused, and the refusal says what to do.
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
  await page.getByLabel('Pack levels').fill('strip:10');
  await page.getByLabel('Price per strip').fill('40');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page).toHaveURL(/\/products$/, { timeout: 30_000 });
}

async function openProduct(page: Page, name: string, removed = false): Promise<void> {
  await page.goto(`/products?q=${encodeURIComponent(name)}${removed ? '&removed=1' : ''}`);
  await page.getByRole('link', { name }).first().click({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });
}

const results = (page: Page, name: string) =>
  page
    .getByRole('listbox', { name: 'Search results' })
    .getByRole('option')
    .filter({ hasText: name });

test('remove a product entered by mistake, then restore it', async ({ page }) => {
  const name = `Mistyped ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);

  // The counter finds it before removal — so its absence afterwards means
  // something, rather than an index that never loaded.
  await page.goto('/sale');
  await search(page).fill(name.toLowerCase());
  await expect(results(page, name)).toHaveCount(1, { timeout: 30_000 });

  await openProduct(page, name);
  await page.getByRole('button', { name: 'Remove product' }).focus();
  await page.keyboard.press('Enter');
  // The confirmation takes focus, so Enter again is the deliberate second step.
  await expect(page.getByRole('button', { name: 'Yes, remove it' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Removed — not shown at the counter')).toBeVisible({
    timeout: 30_000,
  });

  await page.goto('/sale');
  await search(page).fill(name.toLowerCase());
  await expect(results(page, name)).toHaveCount(0, { timeout: 30_000 });

  await page.goto(`/products?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole('link', { name })).toHaveCount(0);
  await page.getByRole('link', { name: 'Show removed products' }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('removed', {
    timeout: 30_000,
  });

  await openProduct(page, name, true);
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('button', { name: 'Remove product' })).toBeVisible({
    timeout: 30_000,
  });

  await page.goto('/sale');
  await search(page).fill(name.toLowerCase());
  await expect(results(page, name)).toHaveCount(1, { timeout: 30_000 });
});

test('a product with stock on hand is not removed, and the screen says what to do', async ({
  page,
}) => {
  const name = `Stocked ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);

  await page.goto('/stock/adjust?opening=1');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await search(page).fill(name.toLowerCase());
  await page.getByRole('option').first().click({ timeout: 30_000 });
  await page.getByLabel('strip', { exact: true }).fill('3');
  await page.getByLabel(/^Cost per strip/).fill('30');
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved.', { exact: false })).toBeVisible();

  await openProduct(page, name);
  await page.getByRole('button', { name: 'Remove product' }).click();
  await page.getByRole('button', { name: 'Yes, remove it' }).click();

  const refusal = page.getByRole('alert').filter({ hasText: 'still has' });
  await expect(refusal).toContainText('3 strip on hand', { timeout: 30_000 });
  await expect(refusal.getByRole('link', { name: 'Remove the stock' })).toBeVisible();
  await expect(
    refusal.getByRole('link', { name: 'Replace it with the right product' }),
  ).toBeVisible();
  // Still on sale.
  await expect(page.getByRole('button', { name: 'Remove product' })).toBeVisible();
});

test('[PCN-013] opening stock typed for the wrong product: removed as never there, then the product', async ({
  page,
}) => {
  const name = `Wrong product ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);

  await page.goto('/stock/adjust?opening=1');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await search(page).fill(name.toLowerCase());
  await page.getByRole('option').first().click({ timeout: 30_000 });
  await page.getByLabel('strip', { exact: true }).fill('3');
  await page.getByLabel(/^Cost per strip/).fill('30');
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved.', { exact: false })).toBeVisible();

  // Taken back as never there — not as damage, not as a count that came up short.
  await page.goto('/stock/adjust');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await search(page).fill(name.toLowerCase());
  await page.getByRole('option').first().click({ timeout: 30_000 });
  await page.getByLabel('Reason').selectOption('entered_by_mistake');
  await expect(page.getByText('It is not counted as a loss')).toBeVisible();
  await page
    .getByRole('group', { name: 'Remove in' })
    .getByRole('button', { name: 'strip' })
    .click();
  await page.getByLabel(/to remove$/).fill('3');
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved.', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('list').filter({ hasText: 'entered by mistake' }).filter({ hasText: name }),
  ).toHaveCount(1, { timeout: 30_000 });

  // Nothing on hand, so the product itself can go.
  await openProduct(page, name);
  await page.getByRole('button', { name: 'Remove product' }).click();
  await page.getByRole('button', { name: 'Yes, remove it' }).click();
  await expect(page.getByText('Removed — not shown at the counter')).toBeVisible({
    timeout: 30_000,
  });
});
