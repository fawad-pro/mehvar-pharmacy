import { expect, test } from '@playwright/test';

import { lastSale, openCounter, search, total, unsynced } from './support/counter';

/**
 * [PCN-013] A customer or supplier typed wrong can be corrected: the name
 * fixed, or the record removed and restored. Fresh records per run, so the
 * spec passes against a database it has run on before (CLAUDE.md, Day 20).
 */

test('a customer: fix the name by keyboard, remove, find again, restore', async ({ page }) => {
  const name = `Typo Custmer ${Date.now()}`;
  const fixed = name.replace('Custmer', 'Customer');
  await openCounter(page);

  // A customer is created the way a counter creates one: attached mid-sale.
  // Paid in full, so they owe nothing and can be removed afterwards.
  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('Rs 35.00');
  await page.keyboard.press('F4');
  const picker = page.getByRole('dialog', { name: 'Attach a customer' });
  await picker.getByPlaceholder('Name or phone…').fill(name);
  await picker.getByRole('button', { name: `Add “${name}” as a new customer` }).click();
  await expect(picker).toBeHidden();
  await page.keyboard.press('F12');
  const overlay = page.getByRole('dialog', { name: 'Payment' });
  await overlay.getByLabel('Cash tendered').fill('35');
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText('Saved');
  // The customer's page reads the server; the sale must have reached it, and
  // the refresh that follows delivery must not land on the next navigation.
  await expect(unsynced(page)).toHaveCount(0, { timeout: 30_000 });

  await page.goto(`/customers?q=${encodeURIComponent(name)}`);
  await page.getByRole('link', { name }).click({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Edit name or phone' }).focus();
  await page.keyboard.press('Enter');
  // The name field takes focus; type, Tab to phone, Enter saves.
  await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(fixed);
  await page.keyboard.press('Tab');
  // At a person's speed: digits then Enter at machine speed is a scan, and
  // the scan guard rightly keeps a scan out of a field that is not for one.
  await page.keyboard.type('0300 1234567', { delay: 120 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: fixed })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('0300 1234567')).toBeVisible();

  await page.getByRole('button', { name: 'Remove customer' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Yes, remove' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Removed — not offered when picking a customer')).toBeVisible({
    timeout: 30_000,
  });

  await page.goto(`/customers?q=${encodeURIComponent(fixed)}`);
  await expect(page.getByRole('link', { name: fixed })).toHaveCount(0);
  await page.getByRole('link', { name: 'Show removed customers' }).click();
  await expect(page.getByRole('row').filter({ hasText: fixed })).toContainText('removed', {
    timeout: 30_000,
  });
  await page.getByRole('link', { name: fixed }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByRole('button', { name: 'Remove customer' })).toBeVisible({
    timeout: 30_000,
  });
});

test('a customer who owes cannot be removed, and the screen says how much', async ({ page }) => {
  const name = `Owing ${Date.now()}`;
  await openCounter(page);

  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await page.keyboard.press('F4');
  const picker = page.getByRole('dialog', { name: 'Attach a customer' });
  await picker.getByPlaceholder('Name or phone…').fill(name);
  await picker.getByRole('button', { name: `Add “${name}” as a new customer` }).click();
  await page.keyboard.press('F12');
  const overlay = page.getByRole('dialog', { name: 'Payment' });
  await overlay.getByLabel('Cash tendered').fill('15');
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText('Saved');
  // The customer's page reads the server; the sale must have reached it, and
  // the refresh that follows delivery must not land on the next navigation.
  await expect(unsynced(page)).toHaveCount(0, { timeout: 30_000 });

  // The udhaar sale reaches the server through the outbox; the customer page
  // shows it once it has.
  await page.goto(`/customers?q=${encodeURIComponent(name)}`);
  await page.getByRole('link', { name }).click({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Remove customer' }).click();
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'owe' })).toContainText(
    'They still owe Rs 20.00',
    {
      timeout: 30_000,
    },
  );
  await expect(page.getByRole('button', { name: 'Remove customer' })).toBeVisible();
});

test('a supplier added by mistake: found from All suppliers, renamed, removed', async ({
  page,
}) => {
  const name = `Mistake Distributor ${Date.now()}`;
  await openCounter(page);

  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await page.getByRole('button', { name: 'Supplier' }).click();
  await page.getByPlaceholder('Name or phone…').fill(name);
  await page.getByRole('button', { name: `+ Add “${name}” as a new supplier` }).click();
  await expect(page.getByRole('button', { name: 'Supplier' })).toContainText(name);

  // Nothing owed, so the owed panel cannot lead here; All suppliers does.
  await page.getByRole('link', { name: 'All suppliers →' }).click();
  await expect(page).toHaveURL(/\/purchases\/suppliers$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Suppliers', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel('Search suppliers').fill(name);
  await page.getByLabel('Search suppliers').press('Enter');
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Settled', {
    timeout: 30_000,
  });
  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Edit name or phone' }).click();
  await page.getByLabel('Name', { exact: true }).fill(`${name} Ltd`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: `${name} Ltd` })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: 'Remove supplier' }).click();
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByText('Removed — not offered when picking a supplier')).toBeVisible({
    timeout: 30_000,
  });

  // Gone from the Receive Stock picker.
  await page.goto('/purchases');
  await page.getByRole('button', { name: 'Supplier' }).click({ timeout: 30_000 });
  await page.getByPlaceholder('Name or phone…').fill(name);
  await expect(
    page.getByRole('button', { name: `+ Add “${name}” as a new supplier` }),
  ).toBeVisible();
  await expect(page.getByRole('option', { name: new RegExp(`${name} Ltd`) })).toHaveCount(0);
});
