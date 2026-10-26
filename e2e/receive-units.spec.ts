import { expect, test, type Page } from '@playwright/test';

import { openCounter, search } from './support/counter';

/**
 * PCN-012, Session 2: stock comes in the way the paper says it does.
 *
 *  - Receive Stock in the pack it arrived in — largest first, bonus in the
 *    same pack, cost per pack — with an exact line cost.
 *  - "MRP on pack" per line: a price above it is warned; an MRP that differs
 *    from the record is offered to the owner, never applied silently.
 *  - Opening stock counted as the shelf holds it: boxes, strips, tablets.
 *
 * A fresh product per run, so the spec passes against a database it has run
 * on before (CLAUDE.md, Day 20).
 */

/** Tablets, strips of 10 at Rs 40, boxes of 10 strips (Rs 400 suggested). */
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

test('receive in boxes: bonus and cost per box, an exact line, and the MRP offered to the owner', async ({
  page,
}) => {
  const name = `Recvbox ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);

  await page.goto('/purchases');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await search(page).fill(name.toLowerCase());
  await page.getByRole('option').first().click({ timeout: 30_000 });

  // Packs only — a distributor never invoices loose tablets — largest first
  // and pressed; the price follows the pack.
  const arrivedIn = page.getByRole('group', { name: 'Arrived in' });
  await expect(arrivedIn.getByRole('button')).toHaveText(['box', 'strip'], { ignoreCase: true });
  await expect(arrivedIn.getByRole('button', { name: 'box' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel(/^Sells for/)).toHaveValue('400.00');

  await page.getByLabel(/^Qty/).fill('2');
  await page.getByLabel(/^Bonus/).fill('1');
  await page.getByLabel(/^Unit cost/).fill('333.33');
  await page.getByLabel('Expiry').fill('2030-12-31');
  // The box says Rs 420; this shop will sell at Rs 450 — above it, warned.
  await page.getByLabel(/^MRP on pack/).fill('420');
  await page.getByLabel(/^Sells for/).fill('450');
  await page.getByLabel(/^Unit cost/).press('Enter');

  const line = page.getByRole('table').getByRole('row').filter({ hasText: name });
  await expect(line).toContainText('2 box');
  await expect(line).toContainText('+1 box');
  // Exactly 2 × Rs 333.33 — the free box is never charged.
  await expect(line).toContainText('666.66');
  await expect(line).toContainText('above MRP');

  // No MRP on record yet: the owner may take the pack's, with the new price.
  await line.getByRole('button', { name: 'Record it, and sell at 450.00 per box' }).click();
  await expect(line.getByRole('status')).toContainText(`Recorded on ${name}`);

  // The newest invoice before this one, so the list's reload can be waited on.
  const recent = page.getByRole('region', { name: 'Received recently' });
  const newestBefore = await recent
    .getByRole('link')
    .first()
    .getAttribute('href')
    .catch(() => null);
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByRole('status', { name: 'Received' })).toContainText('1 batch');

  // The invoice reads like the paper: boxes, cost per box, the exact total.
  const newest = recent.getByRole('link').first();
  await expect(newest).not.toHaveAttribute('href', newestBefore ?? '');
  await newest.click();
  const invoiceLine = page.getByRole('row').filter({ hasText: name });
  await expect(invoiceLine).toContainText('2 box', { timeout: 30_000 });
  await expect(invoiceLine).toContainText('+ 1 box bonus');
  await expect(invoiceLine).toContainText('666.66');

  // The product's box now sells at the price the owner took.
  // Opened from the invoice line itself; the product list is not searched.
  await invoiceLine.getByRole('link', { name }).click();
  await expect(page.getByLabel('Price per box')).toHaveValue('450.00', { timeout: 30_000 });
});

test('opening stock counted as boxes, strips and tablets, costed per box', async ({ page }) => {
  const name = `Openbox ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);

  await page.goto('/stock/adjust?opening=1');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await search(page).fill(name.toLowerCase());
  await page.getByRole('option').first().click({ timeout: 30_000 });

  await page.getByLabel('box', { exact: true }).fill('2');
  await page.getByLabel('strip', { exact: true }).fill('3');
  await page.getByLabel('tab', { exact: true }).fill('4');
  // Cost is required: blank is refused, never read as free (decision 5).
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Enter what this stock cost per box' }),
  ).toBeVisible();

  await page.getByLabel(/^Cost per box/).fill('250');
  // 234 tablets; Rs 250 a box of 100 makes them Rs 585.00, exactly.
  await expect(page.getByRole('status').filter({ hasText: 'in all' })).toHaveText(
    '234 tab in all · costs Rs 585.00',
  );
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved.', { exact: false })).toBeVisible();
});
