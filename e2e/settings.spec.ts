import { expect, test, type Page } from '@playwright/test';

import { lastSale, openCounter, printedReceipt, search } from './support/counter';

/**
 * Receipt printing settings take effect on the counter that changed them.
 *
 * The auto-print setting (and the receipt header and footer) used to be read
 * once per app load: unticking "Print a receipt for every sale" saved, said
 * "Saved.", and the counter went on printing every sale until it was
 * restarted. Found on a spare laptop, where it looked like the setting did
 * nothing at all.
 *
 * `window.print` is counted rather than left to the browser: the question is
 * whether the counter asked to print, not what the test browser did with it.
 */

declare global {
  interface Window {
    __prints: number;
  }
}

async function countPrints(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__prints = 0;
    window.print = () => {
      window.__prints += 1;
    };
  });
}

const prints = (page: Page) => page.evaluate(() => window.__prints);

async function sellOnePanadol(page: Page): Promise<void> {
  await search(page).fill('panadol');
  await expect(page.getByRole('option').first()).toContainText('Panadol');
  await page.keyboard.press('Enter');
  await page.keyboard.press('F12');
  await expect(page.getByRole('dialog', { name: 'Payment' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);
}

async function setAutoPrint(page: Page, on: boolean): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click();
  const box = page.getByRole('checkbox', { name: /Print a receipt for every sale/ });
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.setChecked(on);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  // What was saved is what the shop now has. A late load once overwrote the
  // tick, saved the old value back, and left every later spec printing nothing.
  // Read back from the server: away to Sale and back re-mounts the form, which
  // loads what was stored. Same tab, so the print count is untouched.
  await page.keyboard.press('F1');
  await expect(page).toHaveURL(/\/sale$/);
  await page.getByRole('link', { name: 'Settings' }).click();
  const saved = page.getByRole('checkbox', { name: /Print a receipt for every sale/ });
  await expect(saved).toBeVisible({ timeout: 15_000 });
  await expect(saved).toBeChecked({ checked: on });
}

test('turning automatic printing off takes effect without restarting the counter', async ({
  page,
}) => {
  await countPrints(page);
  await openCounter(page);

  // The demo starts with automatic printing on.
  await sellOnePanadol(page);
  await expect.poll(() => prints(page)).toBe(1);

  try {
    await setAutoPrint(page, false);

    // Back to Sale in the same app session: no reload, no restart.
    await page.keyboard.press('F1');
    await expect(page).toHaveURL(/\/sale$/);
    await sellOnePanadol(page);
    expect(await prints(page)).toBe(1);
    await expect(printedReceipt(page)).toHaveCount(0);
  } finally {
    // The suite shares one database; leave the setting as the demo had it.
    await setAutoPrint(page, true);
  }
});

test('Settings prints a test receipt, numbered TEST so it takes no receipt number', async ({
  page,
}) => {
  await countPrints(page);
  await openCounter(page);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Print test receipt' }).click();

  await expect.poll(() => prints(page)).toBe(1);
  await expect(printedReceipt(page)).toContainText('Test receipt — not a sale');
  await expect(printedReceipt(page)).toContainText('TEST');
});
