import { expect, test } from '@playwright/test';

import { openCounter, search } from './support/counter';

/**
 * PCN-009: a received invoice can be corrected, and goods sent back for credit,
 * without editing anything.
 *
 * The invoice's review page keeps what was entered and shows the corrected
 * figure beside it; the correction screen is reached by the one control that
 * says it changes something; and both acts land on the owner's Day screen.
 *
 * A fresh supplier per run, so the test passes against a database it has run
 * on before. Lipitor is used by no other spec.
 */

const PRODUCT = 'Lipitor';

test('W7/W8: correct a received invoice and return goods to the supplier', async ({ page }) => {
  const supplier = `E2E Distributor ${Date.now()}`;
  await openCounter(page);

  // Receive on credit from a new supplier.
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await page.getByRole('button', { name: 'Supplier' }).click();
  await page.getByPlaceholder('Name or phone…').fill(supplier);
  await page.getByRole('button', { name: `+ Add “${supplier}” as a new supplier` }).click();
  await expect(page.getByRole('button', { name: 'Supplier' })).toContainText(supplier);

  await search(page).fill(PRODUCT.toLowerCase());
  await page.getByRole('option').first().click();
  await page.getByLabel(/^Qty/).fill('50');
  await page.getByLabel('Unit cost').fill('10.00');
  await page.getByLabel('Expiry').fill('2030-12-31');
  await page.getByLabel('Unit cost').press('Enter');
  await page.getByLabel('Paid now').fill('0');
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByRole('status', { name: 'Received' })).toContainText('1 batch');

  // Open the invoice from the recent list.
  // From "Received recently": the supplier's name in "Owed to suppliers" is a
  // link too, to the supplier's account.
  await page
    .getByRole('region', { name: 'Received recently' })
    .getByRole('link', { name: new RegExp(supplier) })
    .first()
    .click();
  // Dynamic routes cannot be warmed without an id: their first visit compiles,
  // which is a startup cost, not an interaction (CLAUDE.md, Day 5).
  await expect(page.getByRole('heading', { name: supplier })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Invoice total as corrected')).toHaveCount(0);

  await page.getByRole('link', { name: /Correct this invoice or return goods/ }).click();
  await expect(page).toHaveURL(/\/correct$/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Correct this line' })).toBeVisible({
    timeout: 30_000,
  });

  // The cost was typed wrong.
  await page.getByRole('button', { name: 'Correct this line' }).click();
  const correction = page.getByRole('form', { name: `Correct ${PRODUCT}` });
  // A cleared field is refused, never read as zero ("nothing arrived").
  const quantity = correction.getByLabel(/^Quantity/);
  const entered = await quantity.inputValue();
  await quantity.fill('');
  await quantity.press('Enter');
  await expect(correction.getByRole('alert')).toContainText('whole numbers');
  await quantity.fill(entered);
  await correction.getByLabel(/Unit cost/).fill('8.00');
  await correction.getByLabel('Why').fill('cost typed wrong');
  await correction.getByLabel('Why').press('Enter');
  await expect(page.getByRole('status')).toContainText('correction recorded');

  // Five go back to the distributor.
  await page.getByRole('button', { name: 'Return to supplier' }).click();
  const giveBack = page.getByRole('form', { name: `Return ${PRODUCT} to ${supplier}` });
  await giveBack.getByLabel(/Quantity going back/).fill('5');
  await giveBack.getByLabel('Note').fill('damaged in transit');
  await giveBack.getByLabel('Note').press('Enter');
  await expect(page.getByRole('status')).toContainText(`return to ${supplier} recorded`);

  // The invoice shows both figures and the history, never an edited original.
  await page.getByRole('link', { name: '← Back to the invoice' }).click();
  await expect(page.getByText('Invoice total as entered')).toBeVisible();
  await expect(page.getByText('Invoice total as corrected')).toBeVisible();
  const history = page.getByRole('heading', { name: 'Corrections and returns' }).locator('..');
  await expect(history).toContainText('cost now');
  await expect(history).toContainText('cost typed wrong');
  await expect(history).toContainText(`returned to ${supplier}`);

  // PCN-011: paying more than is owed says so first, and the credit it leaves
  // stays visible instead of the supplier vanishing from the panel.
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  const owedRow = page.getByRole('listitem').filter({ hasText: supplier });
  // 500 invoiced − 100 corrected − 40 credited for the return.
  await expect(owedRow).toContainText('360.00');
  await owedRow.getByRole('button', { name: 'Pay' }).click();
  await owedRow.getByLabel('Amount paid').fill('400');
  await expect(owedRow.getByRole('status')).toContainText('40.00 more than you owe');
  await owedRow.getByLabel('Amount paid').press('Enter');
  const credit = page.getByRole('region', { name: 'Credit with suppliers' });
  await expect(credit.getByRole('listitem').filter({ hasText: supplier })).toContainText('40.00');

  // And the owner sees all of it on the Day screen (T1).
  await page.keyboard.press('F9');
  await expect(page).toHaveURL(/\/day/);
  await expect(page.getByRole('heading', { name: /Purchase corrections/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Returns to suppliers/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /credit with \d+ suppliers?/ })).toBeVisible();
});
