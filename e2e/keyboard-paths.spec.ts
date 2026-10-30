import { expect, test } from '@playwright/test';

import { openCounter, search } from './support/counter';

/**
 * The counter's less frequent workflows, by keyboard (I1).
 *
 * Each was walked key by key with where-focus-lands logged after every key.
 * What failed: a screen that started with focus nowhere, so the first thing
 * typed went nowhere; a focus call that ran before its field existed; and Esc,
 * which closed a screen's own form or dialog and then also went home to Sale
 * — away from the record just changed.
 */

test('Customers and Products start with the cursor in their search', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F3');
  await expect(page).toHaveURL(/\/customers$/);
  await expect(page.getByLabel('Search customers')).toBeFocused({ timeout: 30_000 });
  await page.keyboard.press('F5');
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByLabel('Search the catalog')).toBeFocused({ timeout: 30_000 });
});

test('Adjust: the product, then straight to how many', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F8');
  await expect(page).toHaveURL(/\/stock\/adjust$/);
  await search(page).fill('disprin');
  await expect(page.getByRole('option').first()).toContainText('Disprin', { timeout: 30_000 });
  await page.keyboard.press('Enter');
  // It went to the unit buttons: the first product's fields did not exist yet
  // when focus was asked for.
  await expect(page.locator('#adjust-qty')).toBeFocused();
});

test('a payment recorded on the customer page: Esc closes it and stays there', async ({ page }) => {
  await openCounter(page);
  // A customer of this run's own, owing what this test pays, so nobody's
  // balance is left changed.
  const name = `Keys Customer ${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 8)}`;
  await search(page).fill('panadol');
  await expect(page.getByRole('option').first()).toContainText('Panadol', { timeout: 30_000 });
  await page.keyboard.press('Enter');
  await page.keyboard.press('F4');
  const picker = page.getByRole('dialog', { name: 'Attach a customer' });
  await picker.getByPlaceholder('Name or phone…').fill(name);
  await picker.getByRole('button', { name: `Add “${name}” as a new customer` }).click();
  await page.getByLabel('Cash received').fill('0');
  await page.keyboard.press('F12');
  await expect(page.getByRole('status', { name: 'Last sale' })).toContainText('udhaar');
  await expect(page.getByRole('status', { name: /waiting to sync/ })).toHaveCount(0, {
    timeout: 30_000,
  });

  await page.goto(`/customers?q=${encodeURIComponent(name)}`);
  await page.getByRole('link', { name }).click({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });
  const customerUrl = page.url();
  const record = page.getByRole('button', { name: 'Record a payment' });
  await record.focus();
  await page.keyboard.press('Enter');
  const settle = page.getByRole('dialog', { name: 'Settle udhaar' });
  await expect(settle.getByLabel('Amount paid')).toBeFocused();
  await page.keyboard.type('35', { delay: 120 });
  await page.keyboard.press('Enter');
  // The slip, with focus in it, so Esc reaches the dialog.
  await expect(settle.getByRole('button', { name: /^Done/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settle).toBeHidden();
  expect(page.url()).toBe(customerUrl);
  await expect(record).toBeFocused();
  await expect(page.getByRole('main')).toContainText('Payment');
});

test('Receive Stock: Esc in a supplier payment closes it, and stays', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  const pay = page.getByRole('button', { name: 'Pay', exact: true }).first();
  await expect(pay).toBeVisible({ timeout: 30_000 });
  await pay.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Amount paid')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Amount paid')).toHaveCount(0);
  await expect(page).toHaveURL(/\/purchases$/);
  await expect(pay).toBeFocused();
});

test('Receive Stock: Esc in a line goes back to search, not to Sale', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await search(page).fill('hydryllin');
  await expect(page.getByRole('option').first()).toContainText('Hydryllin', { timeout: 30_000 });
  await page.keyboard.press('Enter');
  await expect(page.getByLabel(/^Qty/)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/purchases$/);
  await expect(search(page)).toBeFocused();
});

test('correcting a purchase line: Esc closes the form and keeps the page', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  // Any received invoice will do; the form is closed before anything is saved.
  // An invoice, by where it leads: supplier names also link, to their
  // accounts, and which comes last depends on what other specs left behind.
  await page
    .locator('main a[href^="/purchases/"]:not([href^="/purchases/suppliers"])')
    .first()
    .click({ timeout: 30_000 });
  await page.getByRole('link', { name: /Correct this invoice/ }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/correct$/);
  const correctUrl = page.url();

  const open = page.getByRole('button', { name: 'Correct this line' }).first();
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel(/^Quantity/)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel(/^Quantity/)).toHaveCount(0);
  expect(page.url()).toBe(correctUrl);
  await expect(open).toBeFocused();
});
