import { expect, test } from '@playwright/test';

import { cart, DEMO, lastSale, openCounter, printedReceipt, search } from './support/counter';

/**
 * Day 7's screens: W4 returns, W10 day close, W11 the owner phone view, and
 * Settings' export — the day whose done-when is "the owner's three questions
 * answer in one glance on a phone" (Phase 13).
 *
 * `openCounter` pairs the device as the owner (loginDevice's starting user),
 * so F5/F7/Settings are reachable here without a PIN switch first.
 */

test('W4: a return finds the sale, restocks a batch, and prints a refund receipt', async ({
  page,
}) => {
  await openCounter(page);

  // Sell something to return.
  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('Panadol');
  await page.keyboard.press('F12');
  await page.keyboard.press('Enter');
  const saved = await lastSale(page).textContent();
  // The receipt number and the total are adjacent sibling <p> elements with no
  // separating whitespace in the DOM, so `textContent` joins them with none
  // either — `\S+` alone would swallow the total too. The receipt format
  // (device prefix + counter, Phase 9 §3) is what bounds the match instead.
  const receiptNumber = saved?.match(/Saved — ([A-Za-z]+-\d+)/)?.[1];
  expect(receiptNumber).toBeTruthy();

  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/returns$/);

  await page.getByLabel('Receipt number or customer name').fill(receiptNumber!);
  await page.getByRole('button', { name: new RegExp(receiptNumber!) }).click();

  await expect(page.getByRole('table')).toContainText('Panadol');
  await page.getByLabel(/Return quantity for Panadol/).fill('1');
  await page.getByRole('button', { name: 'Confirm return' }).click();

  await expect(page.getByRole('status')).toContainText('Returned');
  await expect(printedReceipt(page)).toContainText('Panadol');
});

test('W10: the three numbers, a cash movement, and the drawer count', async ({ page }) => {
  await openCounter(page);

  await page.keyboard.press('F5');
  await expect(page).toHaveURL(/\/day$/);

  // "Sales" labels both the three-number card and the daily-report figure
  // tile below it — scoped to the first (the three numbers, first on the
  // page per W10's ordering).
  await expect(page.getByText('Sales').first()).toBeVisible();
  await expect(page.getByText('Expected cash in drawer')).toBeVisible();
  await expect(page.getByText('Running udhaar total')).toBeVisible();

  // Record a cash movement — an owner withdrawal.
  await page.getByLabel('Reason').selectOption('owner_withdrawal');
  await page.getByLabel('Amount').fill('500');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  // The drawer-count ritual: counting something other than expected produces
  // a difference, and recording it closes the ritual (D5 — nothing locks).
  await page.getByLabel(/actually in the drawer/).fill('999999');
  await expect(page.getByText(/Over by|Short by/)).toBeVisible();
  await page.getByRole('button', { name: 'Record over/short' }).click();
  await expect(page.getByText(/Recorded/)).toBeVisible();
});

test('a salesman cannot reach Day & Reports or Settings', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F10');
  const overlay = page.getByRole('dialog', { name: 'Switch user' });
  await overlay.getByRole('button', { name: new RegExp(DEMO.salesman.name) }).click();
  await overlay.getByLabel('PIN').fill(DEMO.salesman.pin);
  await overlay.getByRole('button', { name: 'Switch' }).click();
  await expect(overlay).toBeHidden();
  await expect(page.getByRole('button', { name: new RegExp(DEMO.salesman.name) })).toBeVisible();

  await page.goto('/day');
  await expect(page).toHaveURL(/\/sale$/);

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/sale$/);
});

test('W11: the owner phone view answers the three questions in one glance', async ({ page }) => {
  await page.goto('/owner/login');
  await page.getByLabel('Pharmacy code').fill('demo');
  await page.getByLabel('Password').fill('owner-demo-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/owner$/);
  await expect(page.getByText("Today's sales")).toBeVisible();
  await expect(page.getByText('Expected cash in drawer')).toBeVisible();
  await expect(page.getByText('Running udhaar total')).toBeVisible();

  await page.getByRole('button', { name: 'Udhaar' }).click();
  await expect(page.getByText('Rashid Sahib')).toBeVisible();

  await page.getByRole('button', { name: 'Stock' }).click();
  await expect(page.getByText('Running low')).toBeVisible();
});

test('Settings: receipt config, users & PINs, and the export link', async ({ page }) => {
  await openCounter(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await expect(page.getByLabel(/Header/)).toBeVisible();
  // "Fawad" also names the top-bar's owner chip; scoped to the users list.
  await expect(page.getByRole('main').getByText('Fawad')).toBeVisible();

  const newName = `Test Salesman ${Date.now()}`;
  await page.getByLabel(/New salesman/).fill(newName);
  await page.getByLabel('PIN').fill('7788');
  await page.getByRole('button', { name: 'Add — Enter' }).click();
  await expect(page.getByText(newName)).toBeVisible();

  await expect(page.getByRole('link', { name: 'Download export' })).toHaveAttribute(
    'href',
    '/api/export',
  );
});
