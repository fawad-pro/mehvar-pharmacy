import { expect, test } from '@playwright/test';

import { openCounter, printedReceipt as receipt, unsynced } from './support/counter';

/**
 * [PCN-013] A payment or cash entry typed wrong is cancelled, never edited:
 * the opposite entry is written, both stay on record, and the customer's slip
 * says the payment no longer stands. Fresh records per run (CLAUDE.md, Day 20).
 */

test('an udhaar payment typed wrong: cancelled from the ledger, with a slip', async ({ page }) => {
  await openCounter(page);

  // A customer who pays Rs 70 — the amount meant was Rs 7.
  await page.keyboard.press('F4');
  const picker = page.getByRole('dialog', { name: 'Settle udhaar' });
  const name = `Cancelled Pay ${Date.now()}`;
  await picker.getByPlaceholder('Name or phone…').fill(name);
  await picker.getByRole('button', { name: `Add “${name}” as a new customer` }).click();
  const overlay = page.getByRole('dialog', { name: 'Settle udhaar' });
  await overlay.getByLabel('Amount paid').fill('70');
  await page.keyboard.press('Enter');
  await expect(overlay).toContainText('Now');
  const original = (await receipt(page).textContent())?.match(/Receipt ([A-Z0-9-]+)/)?.[1];
  expect(original).toBeTruthy();
  await page.keyboard.press('Escape');
  // The customer's page reads the server, so the settlement must have reached it.
  await expect(unsynced(page)).toHaveCount(0, { timeout: 30_000 });

  await page.goto(`/customers?q=${encodeURIComponent(name)}`);
  await page.getByRole('link', { name }).click({ timeout: 30_000 });
  await expect(page.getByText('Advance paid').first()).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Cancel entry' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Yes, cancel it' })).toBeFocused();
  await page.keyboard.press('Enter');

  // The slip says what it is, against which receipt, and where the balance is now.
  await expect(receipt(page)).toContainText(`PAYMENT CANCELLED — receipt ${original}`, {
    timeout: 30_000,
  });
  await expect(receipt(page)).toContainText('Payment cancelled');
  await expect(receipt(page)).toContainText('Settled');

  // Both rows stay; the balance is back where it started.
  await expect(page.getByText('— cancelled')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('cell', { name: /^Payment cancelled/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel entry' })).toHaveCount(0);
  await expect(page.getByText('Settled up').first()).toBeVisible();

  // The original's receipt says it was cancelled.
  await page.goto(`/receipts/${encodeURIComponent(original!)}`);
  await expect(page.getByText('Cancelled — see receipt')).toBeVisible({ timeout: 30_000 });
});

test('a cash expense typed wrong: cancelled on the Day screen, both rows listed', async ({
  page,
}) => {
  await openCounter(page);
  await page.keyboard.press('F9');
  await expect(page).toHaveURL(/\/day$/);

  // A distinctive amount, so this run's row is the one found.
  const rupees = 4000 + (Date.now() % 1000);
  const shown = `${rupees.toLocaleString('en-PK')}.00`;
  await page.getByLabel('Reason').selectOption('expense');
  await page.getByLabel('Amount').fill(String(rupees));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  const entry = page
    .getByRole('listitem')
    .filter({ hasText: `-${shown}` })
    .filter({ hasText: 'Expense' });
  await expect(entry).toHaveCount(1, { timeout: 30_000 });
  await entry.getByRole('button', { name: 'Cancel entry' }).click();
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();

  await expect(entry).toContainText('— cancelled', { timeout: 30_000 });
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: `+${shown}` })
      .filter({ hasText: 'Cancelled: Expense' }),
  ).toHaveCount(1);
});
