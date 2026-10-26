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

test('a code scanned into the quick item form saves nothing — name or price', async ({ page }) => {
  await openCounter(page);
  // Letters no earlier run's item shares, so search finds nothing and offers
  // the quick item (the suite shares one database, CLAUDE.md Day 20).
  const name = `Qx ${Date.now()
    .toString(36)
    .replace(/[0-9]/g, (digit) => 'bcdfghjklm'[Number(digit)]!)}`;
  await search(page).fill(name);
  await expect(page.getByRole('button', { name: /and keep selling/ })).toBeVisible();
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog', { name: 'Quick item' });
  await expect(form).toBeVisible();

  // Into the price, where focus starts.
  await expect(form.getByLabel('Price')).toBeFocused();
  await page.keyboard.type(EAN, { delay: 0 });
  await page.keyboard.press('Enter');
  await expect(form.getByRole('alert')).toContainText('That was a barcode');
  await expect(form.getByLabel('Price')).toHaveValue('');

  // Into the name: the name comes back as typed.
  await form.getByLabel('Name').click();
  await page.keyboard.press('End');
  await page.keyboard.type(EAN, { delay: 0 });
  await page.keyboard.press('Enter');
  await expect(form.getByRole('alert')).toContainText('That was a barcode');
  await expect(form.getByLabel('Name')).toHaveValue(name);
  await expect(form).toBeVisible();

  // A price typed like a person, but a crore: Enter does not save it.
  await form.getByLabel('Price').pressSequentially('10000000', { delay: 120 });
  await form.getByLabel('Price').press('Enter');
  await expect(form.getByRole('alert')).toContainText('looks like a barcode');
  await expect(form).toBeVisible();

  // The real price saves on Enter, as ever.
  await form.getByLabel('Price').fill('250');
  await form.getByLabel('Price').press('Enter');
  await expect(cart(page)).toContainText(name);
  await expect(cart(page)).not.toContainText(EAN);
});
