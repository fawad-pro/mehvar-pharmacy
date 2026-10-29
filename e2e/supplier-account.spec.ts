import { expect, test } from '@playwright/test';

import { openCounter, search } from './support/counter';

/**
 * T4 for suppliers: a payment made against what is owed is a record you can
 * find again. Before the supplier account existed, paying the last Rs 500 of
 * an invoice dropped the balance and left no trace of when, how much or who.
 *
 * The owner's own walk, verbatim: receive Rs 1,500 paying Rs 1,000, pay the
 * Rs 500 later from "Owed to suppliers", then find that payment from both the
 * invoice and the supplier. A fresh supplier per run; Flagyl is used by no
 * other spec.
 */

test('a later payment to a supplier shows on their account and from the invoice', async ({
  page,
}) => {
  const supplier = `E2E Account ${Date.now()}`;
  await openCounter(page);

  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await page.getByRole('button', { name: 'Supplier' }).click();
  await page.getByPlaceholder('Name or phone…').fill(supplier);
  await page.getByRole('button', { name: `Add “${supplier}” as a new supplier` }).click();
  await expect(page.getByRole('button', { name: 'Supplier' })).toContainText(supplier);

  await search(page).fill('flagyl');
  await page.getByRole('option').first().click();
  await page.getByLabel(/^How many/).fill('10');
  await page.getByLabel(/^Cost of 1/).fill('150.00');
  await page.getByLabel('Expiry').fill('12/2030');
  await page.getByLabel(/^Cost of 1/).press('Enter');
  await page.getByLabel('Paid now').fill('1000');
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByRole('status', { name: 'Received' })).toContainText('1 batch');

  // Rs 500 left owing; pay it from the panel.
  // The owed row is the one linking to the supplier's account; "Received
  // recently" names the supplier too, linking to the invoice.
  const owed = page.locator('li', {
    has: page.locator('a[href^="/purchases/suppliers/"]', { hasText: supplier }),
  });
  const owedRow = owed.first();
  await expect(owedRow).toContainText('Rs 500.00');
  await owedRow.getByRole('button', { name: 'Pay' }).click();
  await owedRow.getByLabel('Amount paid').fill('500');
  await owedRow.getByLabel('Amount paid').press('Enter');
  await expect(owed).toHaveCount(0);

  // The invoice still says what it left owing on arrival — and where the
  // account stands now, with the way to the payments.
  await page
    .getByRole('region', { name: 'Recent deliveries' })
    .getByRole('link', { name: new RegExp(supplier) })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: supplier })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/On credit — owed to/)).toContainText(supplier);
  await expect(page.getByText(`${supplier} account today:`)).toContainText('settled');
  await page.getByRole('link', { name: 'Payments and account →' }).click();

  // The account: the invoice and the payment, ending settled.
  await expect(page.getByRole('heading', { name: supplier })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Settled — nothing owed')).toBeVisible();
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows.filter({ hasText: 'Invoice' })).toContainText('+500.00');
  await expect(rows.filter({ hasText: 'Invoice' })).toContainText('paid Rs 1,000.00 on receiving');
  const payment = rows.filter({ hasText: 'Payment' });
  await expect(payment).toContainText('−500.00');
  await expect(payment).toContainText('settled');
  await expect(payment).toContainText(new Date().toLocaleDateString('en-PK'));
});
