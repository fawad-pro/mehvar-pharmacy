import { expect, test } from '@playwright/test';

import { openCounter as setUpCounter } from './support/counter';

/**
 * Day 2's "done when": "typing three characters returns correctly ranked results
 * instantly against the seeded catalog" (Phase 13 §3).
 *
 * The ranking ladder itself is specified by the unit table in
 * `catalog-index.test.ts`. What this file proves is the part unit tests cannot:
 * that the index reaches the browser, survives a reload from its IndexedDB
 * cache, and drives a keyboard-only interaction.
 *
 * Selections land in the cart, which Session 3 built — `e2e/sale.spec.ts` owns
 * the cart's own behaviour; here it is only evidence that search reached it.
 */

test('three characters return ranked results, by keyboard alone', async ({ page }) => {
  await setUpCounter(page);

  const search = page.getByRole('combobox', { name: 'Search products' });
  await expect(search).toBeFocused();

  await search.fill('pan');
  const results = page.getByRole('listbox', { name: 'Search results' });
  await expect(results.getByRole('option').first()).toContainText('Panadol');

  // Enter takes the highlighted row — no mouse anywhere in this test (I1).
  await page.keyboard.press('Enter');

  await expect(page.getByRole('table')).toContainText('Panadol');
  // Focus returns to search for the next item (Phase 7 rule 1).
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
});

test('a misspelling still finds the product (Phase 10 §5)', async ({ page }) => {
  await setUpCounter(page);

  const search = page.getByRole('combobox', { name: 'Search products' });
  await search.fill('pandol');
  await expect(
    page.getByRole('listbox', { name: 'Search results' }).getByRole('option').first(),
  ).toContainText('Panadol');
});

test('a salt finds the brands that carry it, labelled as substitutes', async ({ page }) => {
  await setUpCounter(page);

  const search = page.getByRole('combobox', { name: 'Search products' });
  await search.fill('ibuprofen');

  const first = page.getByRole('listbox', { name: 'Search results' }).getByRole('option').first();
  await expect(first).toContainText('Brufen');
  await expect(first).toContainText('same salt');
});

test('a scanned barcode resolves straight to one product', async ({ page }) => {
  await setUpCounter(page);

  const search = page.getByRole('combobox', { name: 'Search products' });
  // A scanner types the digits and presses Enter.
  await search.fill('8964000101018');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('table')).toContainText('Panadol');
});

test('the index is cached, so a reload does not re-download the catalog', async ({ page }) => {
  await setUpCounter(page);

  // After the first load the client holds a watermark and asks only for changes.
  const incremental = page.waitForRequest((request) =>
    request.url().includes('/api/catalog?since='),
  );
  await page.reload();
  await incremental;

  const search = page.getByRole('combobox', { name: 'Search products' });
  await search.fill('pan');
  await expect(
    page.getByRole('listbox', { name: 'Search results' }).getByRole('option').first(),
  ).toContainText('Panadol');
});

test('the Products screen lists and edits the catalog', async ({ page }) => {
  await setUpCounter(page);

  await page.keyboard.press('F3');
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  // Deliberately not an exact count. The suite shares one database, and W6's
  // quick item (offline.spec.ts) creates real products by design — pinning the
  // seed's 53 here made an unrelated spec's correct behaviour look like a
  // catalog regression.
  await expect(page.getByText(/\d+ in catalog/)).toBeVisible();

  await page.getByLabel('Search the catalog').fill('risek');
  await page.getByRole('button', { name: 'Search' }).click();

  await page.getByRole('link', { name: /Risek/ }).click();
  await expect(page.getByRole('heading', { name: /Risek/ })).toBeVisible();

  // Pack structure is shown in plain words before it can be saved wrong.
  await expect(page.getByText('1 strip = 14 cap')).toBeVisible();
});
