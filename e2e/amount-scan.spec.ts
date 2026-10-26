import { expect, test, type Page } from '@playwright/test';

import { cart, lastSale, openCounter, printedReceipt, search } from './support/counter';

/**
 * A barcode scanned into a field that is not meant for one never becomes data
 * (I1, P4) — on any screen, through one guard (`client/scan/field-guard.ts`).
 *
 * Forms commit on Enter and a scanner ends every code with Enter. Before the
 * guard: a scanned EAN in Cash tendered printed "Paid 8,964,000,101,018.00",
 * one in a supplier's Pay recorded a payment of billions, a GS1 code in Pay
 * crashed the screen, and one in Paid now put the invoice on credit unasked.
 */

const EAN = '8964000101018';
/** A pack's 2D code as the owner scanned it: ends in a batch with a letter. */
const GS1 = '01089640015901701728033110563C';

const guardNotice = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'That was a barcode — nothing was entered or saved' });

/** Keys at scanner speed, Enter included. */
async function scan(page: Page, code: string): Promise<void> {
  await page.keyboard.type(code, { delay: 0 });
  await page.keyboard.press('Enter');
}

function watchCrashes(page: Page): string[] {
  const crashes: string[] = [];
  page.on('pageerror', (error) => crashes.push(error.message));
  return crashes;
}

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

  // Over the selected exact amount, as a real scan would land.
  await scan(page, EAN);
  await expect(guardNotice(page)).toBeVisible();
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
  await scan(page, EAN);
  await expect(guardNotice(page)).toBeVisible();
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
  await scan(page, EAN);
  await expect(guardNotice(page)).toBeVisible();
  await expect(form.getByLabel('Price')).toHaveValue('');

  // Into the name: the name comes back as typed.
  await form.getByLabel('Name').click();
  await page.keyboard.press('End');
  await scan(page, EAN);
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

test('Receive Stock: a code in Paid now or a supplier Pay records nothing and crashes nothing', async ({
  page,
}) => {
  const crashes = watchCrashes(page);
  const supplier = `Scan-guard Supplier ${Date.now()}`;
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await page.getByRole('button', { name: 'Supplier' }).click();
  await page.getByPlaceholder('Name or phone…').fill(supplier);
  await page.getByRole('button', { name: `+ Add “${supplier}” as a new supplier` }).click();

  // Flagyl only ever receives stock in the suite (supplier-account.spec).
  await search(page).fill('flagyl');
  await page.getByRole('option').first().click();
  await page.getByLabel(/^Qty/).fill('10');
  await page.getByLabel('Unit cost').fill('150.00');
  await page.getByLabel('Unit cost').press('Enter');

  // Paid now: a scan is put back; the same text typed by hand is "not an
  // amount" — never Rs 0 with the whole invoice silently on credit.
  const paidNow = page.getByLabel('Paid now');
  await paidNow.click();
  await scan(page, GS1);
  await expect(guardNotice(page)).toBeVisible();
  await expect(paidNow).toHaveValue('');
  await paidNow.pressSequentially(GS1, { delay: 80 });
  await expect(page.getByText('Not an amount — type what was paid')).toBeVisible();
  await expect(page.getByText('On credit', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Receive stock' })).toBeDisabled();

  await paidNow.fill('1000');
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByRole('status', { name: 'Received' })).toContainText('1 batch');

  // Rs 500 owing. Pay: the field opens with the balance; a scan of either
  // kind is put back, and the row still owes Rs 500.
  const owedRow = page
    .locator('li', {
      has: page.locator('a[href^="/purchases/suppliers/"]', { hasText: supplier }),
    })
    .first();
  await expect(owedRow).toContainText('Rs 500.00');
  await owedRow.getByRole('button', { name: 'Pay' }).click();
  const amount = owedRow.getByLabel('Amount paid');
  for (const code of [GS1, EAN]) {
    await amount.click();
    await amount.selectText();
    await scan(page, code);
    await expect(guardNotice(page)).toBeVisible();
    await expect(amount).toHaveValue('500');
  }

  // A barcode-sized amount typed by hand records only by a click.
  await amount.fill('');
  await amount.pressSequentially(EAN, { delay: 80 });
  await amount.press('Enter');
  await expect(owedRow.getByRole('alert')).toContainText('looks like a barcode');
  await expect(owedRow).toContainText('Rs 500.00');
  expect(crashes).toEqual([]);
});

test('Day: a drawer count that is not an amount is said, never recorded', async ({ page }) => {
  const crashes = watchCrashes(page);
  await openCounter(page);
  await page.goto('/day');
  const counted = page.getByLabel('What’s actually in the drawer');
  await expect(counted).toBeVisible({ timeout: 30_000 });
  await counted.pressSequentially(GS1, { delay: 40 });
  await expect(page.getByText('Not an amount — type the cash you counted.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record over/short' })).toBeDisabled();
  expect(crashes).toEqual([]);
});
