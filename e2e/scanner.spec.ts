import { expect, test, type Page } from '@playwright/test';

import { cart, openCounter, search } from './support/counter';

/**
 * The barcode scanner at the counter (I1: "the scanner is a keyboard").
 *
 * A keyboard-wedge scanner types its code and presses Enter, all within a few
 * milliseconds, so every scan here is `keyboard.type` with no delay followed by
 * Enter — never `fill`, which would hide a race between typing and the result
 * list.
 *
 * Codes are minted per run from GS1's restricted-circulation range (20–29),
 * with a valid check digit, so the spec runs against a database it has run on
 * before (CLAUDE.md, Day 20) and never collides with a real product's code.
 */

/** A GTIN-13 in the 20–29 restricted range, unique to this run. */
function freshGtin13(): string {
  const body = `20${String(Date.now()).slice(-10)}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** A medicine pack's 2D code: (01) GTIN-14, (17) expiry, (10) batch — batch last, as printed. */
function packCode(gtin13: string, batch: string): string {
  return `010${gtin13}17301231` + `10${batch}`;
}

async function scan(page: Page, code: string): Promise<void> {
  await search(page).focus();
  await page.keyboard.type(code, { delay: 0 });
  await page.keyboard.press('Enter');
}

/** A stocked product with at least one pack level, sized from the live catalog. */
async function anyStockedProduct(page: Page): Promise<{ id: string; name: string }> {
  const response = await page.request.get('/api/catalog');
  expect(response.ok()).toBe(true);
  const snapshot = (await response.json()) as {
    products: Array<{ id: string; name: string; packLevels: unknown[] }>;
    stock: Record<string, number>;
  };
  const product = snapshot.products.find(
    (row) => row.packLevels.length > 0 && (snapshot.stock[row.id] ?? 0) > 0,
  );
  expect(product, 'a stocked product with a pack level exists').toBeDefined();
  return { id: product?.id ?? '', name: product?.name ?? '' };
}

test('a barcode linked on Products scans at the counter without a reload', async ({ page }) => {
  await openCounter(page);
  const product = await anyStockedProduct(page);
  const gtin = freshGtin13();

  await page.goto(`/products/${product.id}`);
  await page.getByLabel('Scan or type a code').fill(gtin, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.getByText(gtin)).toBeVisible();

  // Back to the counter by the function key: a client navigation, so the
  // catalog index in memory is the one built before the barcode existed.
  await page.keyboard.press('F1');
  await expect(page).toHaveURL(/\/sale$/);

  await scan(page, gtin);
  await expect(cart(page)).toContainText(product.name);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The pack's 2D code carries the same GTIN with a batch and an expiry: it
  // finds the same product, and so does the next delivery's batch.
  await scan(page, packCode(gtin, '892302XV'));
  await scan(page, packCode(gtin, 'B7Q41'));
  await expect(cart(page).getByRole('row').filter({ hasText: product.name })).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('an unknown code never becomes a product by itself, and links in place', async ({ page }) => {
  await openCounter(page);
  const product = await anyStockedProduct(page);
  const gtin = freshGtin13();
  const code = packCode(gtin, 'ZZ901');

  // The scanner's own Enter must not open anything that creates a product.
  await scan(page, code);
  await expect(page.getByText('This code is not linked to a product yet')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // "Add a new product" opens the quick item with an EMPTY name — the code is
  // never offered as one.
  await page.getByRole('option', { name: /Add a new product/ }).click();
  const quick = page.getByRole('dialog');
  await expect(quick.getByLabel('Name')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Link it: find the product, confirm the unit, and the line lands.
  await scan(page, code);
  await page.getByRole('option', { name: /Link it to a product/ }).click();
  await expect(page.getByText(/Linking code/)).toBeVisible();
  await page.keyboard.type(product.name.slice(0, 6).toLowerCase());
  await page.keyboard.press('Enter');
  await page
    .getByRole('button', { name: /^Link to / })
    .first()
    .click();
  await expect(cart(page)).toContainText(product.name);

  // From now on the code is a normal barcode — and a different batch of the
  // same pack finds it too.
  await scan(page, packCode(gtin, 'NEXT1'));
  await expect(page.getByText('This code is not linked to a product yet')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
