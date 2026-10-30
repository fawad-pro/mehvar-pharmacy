import { expect, test, type Page } from '@playwright/test';

import { openCounter } from './support/counter';

/**
 * The five common tasks, each done with exactly its budgeted keys.
 *
 * Measured, not designed on paper: each task was walked with every key
 * logged, and the keys that carried no decision were cut. Typed text — a
 * name, a number — is data and is not budgeted; the keys around it are. A
 * change that adds a step, or makes a key stop doing its job, fails here
 * with the task it slowed.
 *
 *   sell one item          Enter · F12 · Enter                 (scan · F12 · Enter)
 *   sell several           Enter per item · F12 · Enter
 *   udhaar sale            Enter · F4 · Enter · F12 · "0" · Enter
 *   receive one line       F7 · Enter · Enter · Enter · Enter · Tab · Tab · Enter · Enter · Enter
 *   return from a receipt  F2 · Enter · Tab · Tab · Enter · Enter
 *
 * Selling is at its floor: each key is a decision (the item; open payment,
 * where cash and change are; confirm). Receiving lost one key and a hazard:
 * the way from the search to Paid now went through the last line's Remove
 * button, and Enter on an empty search now goes straight there.
 */

const lastSale = (page: Page) => page.getByRole('status', { name: 'Last sale' });

/** Keys as an operator presses them; text as they type it. Nothing else. */
async function keys(page: Page, sequence: readonly string[]): Promise<void> {
  for (const step of sequence) {
    if (step.startsWith('type:')) {
      await page.keyboard.type(step.slice(5), { delay: 110 });
    } else {
      await page.keyboard.press(step);
    }
  }
}

/** Waits for a type-ahead to answer, as an operator waits to see the match. */
async function seen(page: Page, text: string, within = page.locator('body')): Promise<void> {
  await expect(within.getByRole('option').first()).toContainText(text, { timeout: 30_000 });
}

test('sell one item: Enter, F12, Enter — or a scan, F12, Enter', async ({ page }) => {
  await openCounter(page);
  await keys(page, ['type:panadol']);
  await seen(page, 'Panadol');
  await keys(page, ['Enter', 'F12', 'Enter']);
  await expect(lastSale(page)).toContainText(/Saved — /);

  await page.keyboard.type('8964000101018', { delay: 0 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table')).toContainText('Panadol');
  await keys(page, ['F12']);
  await expect(lastSale(page)).toContainText(/Saved — /);
});

test('sell several: one Enter per item, then F12, Enter', async ({ page }) => {
  await openCounter(page);
  for (const [term, name] of [
    ['panadol', 'Panadol'],
    ['3*brufen', 'Brufen'],
    ['disprin', 'Disprin'],
  ] as const) {
    await keys(page, [`type:${term}`]);
    await seen(page, name);
    await keys(page, ['Enter']);
  }
  await expect(page.getByRole('table')).toContainText('3 strip');
  await keys(page, ['F12', 'Enter']);
  await expect(lastSale(page)).toContainText(/Saved — /);
});

test('an udhaar sale: the screen says how, and it takes five keys', async ({ page }) => {
  const name = `Budget Customer ${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 8)}`;
  await openCounter(page);
  // A customer of this test's own, so nobody's balance is left changed.
  await keys(page, ['type:disprin']);
  await seen(page, 'Disprin');
  await keys(page, ['Enter', 'F4', `type:${name}`, 'Enter']);
  await expect(page.locator('aside')).toContainText(name);
  await page.getByLabel('Cash received').fill('0');
  await keys(page, ['F12']);
  await expect(lastSale(page)).toContainText(`on ${name}’s udhaar`);
});

test('receive a one-line delivery: ten keys, and Enter on an empty search goes to Paid now', async ({
  page,
}) => {
  const supplier = `Budget Distributor ${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 8)}`;
  await openCounter(page);
  await page.keyboard.press('F7');
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.includes('purchase')) localStorage.removeItem(key);
    }
  });
  await page.goto('/sale');

  await keys(page, ['F7']);
  await expect(page.getByRole('button', { name: 'Supplier' })).toBeFocused({ timeout: 30_000 });
  await keys(page, ['Enter', `type:${supplier}`, 'Enter']);
  await expect(page.getByLabel('Invoice no.')).toBeFocused({ timeout: 30_000 });
  await keys(page, ['type:KB-2', 'Enter', 'type:hydryllin']);
  await seen(page, 'Hydryllin');
  await keys(page, ['Enter', 'type:1', 'Tab', 'Tab', 'type:100', 'Enter']);
  await expect(page.getByRole('table')).toContainText('Hydryllin');
  await expect(page.getByText(/Enter on an empty search goes to Paid now/)).toBeVisible();
  await keys(page, ['Enter']);
  await expect(page.getByLabel('Paid now')).toBeFocused();
  await keys(page, ['Enter']);
  await expect(page.getByRole('status', { name: 'Received' })).toContainText('1 batch');
});

test('return from a receipt: F2, the number, Enter, Tab, Tab, Enter, the quantity, Enter', async ({
  page,
}) => {
  await openCounter(page);
  await keys(page, ['type:disprin']);
  await seen(page, 'Disprin');
  await keys(page, ['Enter', 'F12', 'Enter']);
  const number = (await lastSale(page).textContent())?.match(/Saved — ([A-Z]+-\d+)/)?.[1];
  expect(number).toBeTruthy();
  await expect(page.getByRole('status', { name: /waiting to sync/ })).toHaveCount(0, {
    timeout: 30_000,
  });

  await keys(page, ['F2']);
  await expect(page.getByLabel('Find a receipt')).toBeFocused({ timeout: 30_000 });
  await keys(page, [`type:${number!}`, 'Enter']);
  await expect(page).toHaveURL(new RegExp(`/receipts/${number!}$`), { timeout: 30_000 });
  // Reviewing and refunding are separate places (Day 9): two Tabs to the one
  // control on the receipt that leads to a change.
  await keys(page, ['Tab', 'Tab']);
  await expect(page.getByRole('link', { name: 'Start a return' })).toBeFocused();
  await keys(page, ['Enter']);
  await expect(page.getByLabel(/Return quantity for Disprin/)).toBeFocused({ timeout: 30_000 });
  await keys(page, ['type:1', 'Enter']);
  await expect(page.getByRole('status')).toContainText('Returned');
});
