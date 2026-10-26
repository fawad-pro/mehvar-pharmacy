import { expect, test } from '@playwright/test';

import { cart, lastSale, openCounter, printedReceipt, search } from './support/counter';

/**
 * A barcode scanned into an amount field never becomes money (I1, P4).
 *
 * Cash tendered and a settlement's amount both commit on Enter, and a scanner
 * ends every code with Enter. Before this, a scanned EAN in Cash tendered
 * committed the sale and printed "Paid 8,964,000,101,018.00"; in a settlement
 * it would have recorded a payment of billions.
 */

const EAN = '8964000101018';

test('a code scanned into Cash tendered commits nothing and puts the amount back', async ({
  page,
}) => {
  await openCounter(page);
  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('Panadol');

  await page.keyboard.press('F12');
  const payment = page.getByRole('dialog', { name: 'Payment' });
  await expect(payment).toBeVisible();
  const tendered = payment.getByLabel('Cash tendered');
  const exact = await tendered.inputValue();

  // At scanner speed, Enter included, over the selected exact amount.
  await page.keyboard.type(EAN, { delay: 0 });
  await page.keyboard.press('Enter');
  await expect(payment.getByRole('alert')).toContainText('That was a barcode, not cash');
  await expect(payment).toBeVisible();
  await expect(tendered).toHaveValue(exact);

  // The ordinary Enter still commits, at the real amount.
  await tendered.press('Enter');
  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);
  await expect(printedReceipt(page)).not.toContainText(EAN.slice(0, 7));
});

test('an implausible tendered amount commits only by a click, never by Enter', async ({ page }) => {
  await openCounter(page);
  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await page.keyboard.press('F12');
  const payment = page.getByRole('dialog', { name: 'Payment' });
  const tendered = payment.getByLabel('Cash tendered');

  // Typed like a person — not a scan — but a crore or more.
  await tendered.fill('');
  await tendered.pressSequentially('10000000', { delay: 120 });
  await tendered.press('Enter');
  await expect(payment.getByRole('alert')).toContainText('looks like a barcode');
  await expect(payment).toBeVisible();

  // Nothing is refused: the button still takes it.
  await payment.getByRole('button', { name: 'Commit — Enter' }).click();
  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);
});

test('a code scanned into a settlement amount records no payment', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F4');
  const overlay = page.getByRole('dialog', { name: 'Settle udhaar' });
  await expect(overlay).toBeVisible();
  const name = `Scan-guard Customer ${Date.now()}`;
  await overlay.getByPlaceholder('Name or phone…').fill(name);
  await overlay.getByRole('button', { name: `Add “${name}” as a new customer` }).click();
  await expect(overlay).toContainText(name);

  const amount = overlay.getByLabel('Amount paid');
  await amount.click();
  await page.keyboard.type(EAN, { delay: 0 });
  await page.keyboard.press('Enter');
  await expect(overlay.getByRole('alert')).toContainText('That was a barcode, not an amount');
  await expect(amount).toHaveValue('');
  // Still asking for the amount: a committed payment shows its slip and Done.
  await expect(overlay.getByRole('button', { name: 'Settle — Enter' })).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Done — Esc' })).toHaveCount(0);
});
