import { expect, test, type Page } from '@playwright/test';

import { openCounter, search } from './support/counter';

/**
 * A picker's Enter means the same thing on a slow connection as on a fast one.
 *
 * Both pickers acted on whatever list had last arrived. On a fast server that
 * is the list for what was typed; on a slow one — a tablet over shop Wi-Fi —
 * it was the list for fewer letters, or none: "Rashid" + Enter created a
 * second customer called "Rashid" and put the udhaar on them, and a new
 * supplier's name + Enter put the delivery on whichever supplier listed first.
 */

async function slowServerActions(page: Page, ms: number): Promise<void> {
  await page.route('**/*', async (route) => {
    if (route.request().method() === 'POST' && route.request().headers()['next-action']) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    await route.fallback();
  });
}

test('the customer picker: a name and Enter pick that customer, however slow the answer', async ({
  page,
}) => {
  await openCounter(page);
  await search(page).fill('panadol');
  await expect(page.getByRole('option').first()).toContainText('Panadol', { timeout: 30_000 });
  await page.keyboard.press('Enter');

  await slowServerActions(page, 1_500);
  await page.keyboard.press('F4');
  const picker = page.getByRole('dialog', { name: 'Attach a customer' });
  await expect(picker.getByPlaceholder('Name or phone…')).toBeFocused();
  await page.keyboard.type('Rashid', { delay: 100 });
  await page.keyboard.press('Enter');

  await expect(picker).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText(/Rashid Sahib/).first()).toBeVisible();
});

test('the supplier picker: a new name and Enter add that supplier, however slow the answer', async ({
  page,
}) => {
  const name = `Slow Distributor ${Date.now()}`;
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await page.getByRole('button', { name: 'Supplier' }).click({ timeout: 30_000 });
  const picker = page.getByRole('dialog', { name: 'Supplier' });
  await expect(picker.getByPlaceholder('Name or phone…')).toBeFocused();

  await slowServerActions(page, 1_500);
  // At a person's speed: digits then Enter at machine speed is a scan.
  await page.keyboard.type(name, { delay: 100 });
  await page.keyboard.press('Enter');

  await expect(picker).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Supplier' })).toContainText(name);
});

test('Returns: a receipt number and Enter open that sale, however slow the answer', async ({
  page,
}) => {
  await openCounter(page);
  const sell = async () => {
    await search(page).fill('disprin');
    await expect(page.getByRole('option').first()).toContainText('Disprin', { timeout: 30_000 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('F12');
    await page.keyboard.press('Enter');
    const lastSale = page.getByRole('status', { name: 'Last sale' });
    await expect(lastSale).toContainText(/Saved — /);
    return (await lastSale.textContent())?.match(/Saved — ([A-Za-z]+-\d+)/)?.[1];
  };
  // Two sales. One number is looked up first, so the list on screen is that
  // single sale; then the other number is typed and Enter pressed before its
  // answer arrives. Acting on the list on screen opens the wrong sale.
  const first = await sell();
  const second = await sell();
  expect(first).toBeTruthy();
  expect(second).not.toBe(first);

  await page.goto('/returns');
  const find = page.getByLabel('Receipt number or customer name');
  await expect(find).toBeFocused({ timeout: 30_000 });
  await find.fill(first!);
  await expect(page.getByRole('button', { name: new RegExp(`^${first!}`) })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('listitem')).toHaveCount(1);

  await slowServerActions(page, 1_500);
  await find.fill(second!);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel(/Return quantity for Disprin/)).toBeFocused({ timeout: 15_000 });
  await expect(page.locator('main').getByText(second!, { exact: true })).toBeVisible();
});

test('Receipts: Enter opens the receipt typed, not the top of the list before it', async ({
  page,
}) => {
  await openCounter(page);
  const sell = async () => {
    await search(page).fill('disprin');
    await expect(page.getByRole('option').first()).toContainText('Disprin', { timeout: 30_000 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('F12');
    await page.keyboard.press('Enter');
    const lastSale = page.getByRole('status', { name: 'Last sale' });
    await expect(lastSale).toContainText(/Saved — /);
    return (await lastSale.textContent())?.match(/Saved — ([A-Za-z]+-\d+)/)?.[1];
  };
  const first = await sell();
  const second = await sell();
  await expect(page.getByRole('status', { name: /waiting to sync/ })).toHaveCount(0, {
    timeout: 30_000,
  });

  await page.keyboard.press('F2');
  const find = page.getByLabel('Find a receipt');
  await find.fill(first!);
  // The list has caught up: it shows the first receipt alone.
  await expect(page).toHaveURL(new RegExp(`q=${first!}`), { timeout: 30_000 });
  // Then the other number, and Enter at once — before the list follows.
  await find.fill(second!);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/receipts/${second!}$`), { timeout: 30_000 });
});

test('F12 while the customer picker is still finding: nothing lands on the bill', async ({
  page,
}) => {
  const name = `Waiting Customer ${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 8)}`;
  await openCounter(page);
  await search(page).fill('disprin');
  await expect(page.getByRole('option').first()).toContainText('Disprin', { timeout: 30_000 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table')).toContainText('Disprin');

  await slowServerActions(page, 1_500);
  await page.keyboard.press('F4');
  const picker = page.getByRole('dialog', { name: 'Attach a customer' });
  await expect(picker.getByPlaceholder('Name or phone…')).toBeFocused();
  await page.keyboard.type(name, { delay: 100 });
  await page.keyboard.press('Enter');
  // The wait is said, not silent.
  await expect(picker.getByRole('status')).toContainText(`Finding “${name}”`);
  // A quick operator goes on as if the customer were attached: Payment, the
  // cash, Enter. Payment used to open over the picker; when the picker closed
  // it put focus behind Payment, so "0" searched for a product and Enter
  // added it to the bill. Now F12 waits for the customer, and the keys typed
  // into a picker that is finding change nothing.
  await page.keyboard.press('F12');
  await page.keyboard.type('0', { delay: 100 });
  await page.keyboard.press('Enter');

  // The F12 waited for the customer, then opened Payment, with the full
  // amount still tendered: the "0" and Enter typed while the picker was
  // finding changed nothing. No other product is on the bill.
  await expect(picker).toBeHidden({ timeout: 15_000 });
  const payment = page.getByRole('dialog', { name: 'Payment' });
  await expect(payment).toBeVisible();
  await expect(payment).toContainText(`Billing to ${name}`);
  await expect(payment.getByLabel('Cash tendered')).toHaveValue('25.00');
  const lines = page.getByRole('table').getByRole('row');
  await expect(lines).toHaveCount(2); // the header and Disprin
  await expect(page.getByRole('status', { name: 'Last sale' })).toHaveCount(0);

  // Now the cash, as intended.
  await payment.getByLabel('Cash tendered').fill('0');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Last sale' })).toContainText(
    `Rs 25.00 on ${name}’s udhaar`,
  );
});

test('the supplier picker holds the name while it finds it', async ({ page }) => {
  const name = `Holding Distributor ${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 8)}`;
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await page.getByRole('button', { name: 'Supplier' }).click({ timeout: 30_000 });
  const picker = page.getByRole('dialog', { name: 'Supplier' });
  await slowServerActions(page, 1_500);
  await page.keyboard.type(name, { delay: 100 });
  await page.keyboard.press('Enter');
  await expect(picker.getByRole('status')).toContainText(`Finding “${name}”`);
  // The invoice number, typed on before the picker has closed.
  await page.keyboard.type('INV-77', { delay: 100 });
  await expect(picker).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Supplier' })).toHaveText(name);
});
