import { devices, expect, test, type Locator, type Page } from '@playwright/test';

import { openCounter, search, total } from './support/counter';

/**
 * The counter on a tablet: every workflow by touch alone.
 *
 * No `keyboard.press` anywhere below, except for a scanner, which is a
 * keyboard. A tablet has no function keys, no Tab and no Enter beyond the
 * on-screen keyboard's, so each step is a tap, and
 * text goes in the way an on-screen keyboard puts it (`fill`). A workflow
 * that needs a key fails here at the step with nothing to tap: the udhaar
 * key and Switch user were inert text in the key bar, so an udhaar sale and
 * a user switch could not be done at all.
 *
 * Signing in is setup, not a counter workflow, so it is left to the shared
 * helper.
 */

const { defaultBrowserType: _browser, ...tablet } = devices['Galaxy Tab S9 landscape'];
test.use({ ...tablet });

const keyBar = (page: Page) => page.getByRole('navigation', { name: 'Function keys' });
const lastSale = (page: Page) => page.getByRole('status', { name: 'Last sale' });

/** Taps the search box, types as an on-screen keyboard does, taps the first match. */
async function addByTouch(page: Page, term: string, expected: string): Promise<void> {
  await search(page).tap();
  await search(page).fill(term);
  const option = page.getByRole('option').first();
  await expect(option).toContainText(expected, { timeout: 30_000 });
  await tap(option.getByRole('button').first());
}

/** A tap that first brings the target on screen, as a finger would scroll to it. */
async function tap(target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await target.tap();
}

test('a cash sale by touch', async ({ page }) => {
  await openCounter(page);
  await addByTouch(page, 'panadol', 'Panadol');
  await expect(page.getByRole('table')).toContainText('Panadol');

  await tap(page.getByRole('button', { name: /^Pay/ }));
  await expect(lastSale(page)).toContainText(/Saved — [A-Z]+-\d+/);
});

test('a line changed by touch: more, fewer, another unit, a discount', async ({ page }) => {
  await openCounter(page);
  await addByTouch(page, 'disprin', 'Disprin');
  const row = page.getByRole('row').filter({ hasText: 'Disprin' });
  await expect(row).toContainText('1 strip');

  await tap(row.getByRole('button', { name: /^One strip more/ }));
  await expect(row).toContainText('2 strip');
  await tap(row.getByRole('group', { name: /^Unit for/ }).getByRole('button', { name: 'tab' }));
  await expect(row).toContainText(/tab/);

  await tap(row.getByRole('button', { name: 'Add a discount on Disprin' }));
  await page.getByLabel(/^Discount for Disprin/).fill('1');
  // A visible Apply: tapping away cancels, as leaving the field does by key.
  await tap(row.getByRole('button', { name: 'Apply discount on Disprin' }));
  await expect(row).toContainText('Rs 1.00');
});

test('an udhaar sale by touch, then the customer settles it', async ({ page }) => {
  const name = `Touch Customer ${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 8)}`;
  await openCounter(page);
  await addByTouch(page, 'panadol', 'Panadol');

  // With items in the cart, the rail offers it as something to tap.
  await tap(page.getByRole('button', { name: /^Attach/ }));
  const picker = page.getByRole('dialog', { name: 'Attach a customer' });
  await picker.getByPlaceholder('Name or phone…').fill(name);
  await tap(picker.getByRole('button', { name: `Add “${name}” as a new customer` }));
  await expect(picker).toBeHidden();

  await page.getByLabel('Cash received').fill('0');
  await expect(page.locator('aside')).toContainText(`goes on ${name}’s udhaar`);
  await tap(page.getByRole('button', { name: /^Pay/ }));
  await expect(lastSale(page)).toContainText(`on ${name}’s udhaar`);

  // The cart is empty, so the key bar's Udhaar settles — and it is a button.
  await tap(keyBar(page).getByRole('button', { name: /Udhaar/ }));
  const settle = page.getByRole('dialog', { name: 'Settle udhaar' });
  await settle.getByPlaceholder('Name or phone…').fill(name);
  await tap(settle.getByRole('option').filter({ hasText: name }).getByRole('button'));
  await settle.getByLabel('Amount paid').fill('35');
  await expect(settle).toContainText('After this: Settled up');
  await tap(settle.getByRole('button', { name: /^Settle/ }));
  await expect(settle).toContainText('Saved — ');
});

test('a bill discount by touch: tap the field, type what comes off, Pay', async ({ page }) => {
  await openCounter(page);
  await addByTouch(page, 'panadol', 'Panadol');
  await expect(total(page)).toHaveText('Rs 35.00');

  // No button to find and no Apply to remember: the field is there, and the
  // figure to collect follows what is typed into it.
  await tap(page.locator('#bill-discount'));
  await page.locator('#bill-discount').fill('4%');
  await expect(total(page)).toHaveText('Rs 33.60');
  await expect(page.getByLabel('Cash received')).toHaveValue('33.60');
  await tap(page.getByRole('button', { name: /^Pay/ }));
  await expect(lastSale(page)).toContainText('Rs 33.60');
});

test('Switch user by touch', async ({ page }) => {
  await openCounter(page);
  await tap(keyBar(page).getByRole('button', { name: /Switch user/ }));
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('PIN')).toBeVisible();
});

test('every function key is something to tap', async ({ page }) => {
  await openCounter(page);
  const entries = keyBar(page).locator(':scope > *');
  const count = await entries.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const entry = entries.nth(index);
    const tag = await entry.evaluate((element) => element.tagName);
    const text = (await entry.textContent()) ?? '';
    // Owner-only keys are dimmed text for a salesman; this session is the
    // owner, so every key must be a link or a button.
    expect(['A', 'BUTTON'], `${text} cannot be tapped`).toContain(tag);
  }
});

/**
 * Every control a finger reaches for is at least the design's touch target
 * (`--touch-target`, 44px, "actionable controls"). Measured, not assumed:
 * "Print receipt" was 16px tall, a supplier's Pay 21×16.
 */
async function undersized(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const target = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--touch-target'),
    );
    const found: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(
      'button, a[href], input, select',
    )) {
      if (element.closest('#printable-receipt')) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.height < target || box.width < target) {
        const name = (element.getAttribute('aria-label') ?? element.textContent ?? element.id)
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40);
        found.push(`${name} (${Math.round(box.width)}×${Math.round(box.height)})`);
      }
    }
    return [...new Set(found)];
  });
}

test('every control on the counter screens is big enough to tap', async ({ page }) => {
  await openCounter(page);
  await addByTouch(page, 'disprin', 'Disprin');
  expect(await undersized(page), 'Sale, with a line').toEqual([]);

  await tap(page.getByRole('button', { name: /^Pay/ }));
  await expect(lastSale(page)).toContainText(/Saved — /);
  expect(await undersized(page), 'Sale, after a sale').toEqual([]);

  for (const path of ['/purchases', '/returns', '/customers', '/receipts']) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 });
    // Each screen's lists arrive after it does.
    await page.waitForLoadState('networkidle');
    expect(await undersized(page), path).toEqual([]);
  }
});

test('receiving a delivery by touch', async ({ page }) => {
  const supplier = `Touch Distributor ${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 8)}`;
  await openCounter(page);
  await tap(keyBar(page).getByRole('link', { name: /Receive Stock/ }));
  await expect(page).toHaveURL(/\/purchases$/);

  await tap(page.getByRole('button', { name: 'Supplier' }));
  const picker = page.getByRole('dialog', { name: 'Supplier' });
  await picker.getByPlaceholder('Name or phone…').fill(supplier);
  await tap(picker.getByRole('button', { name: `Add “${supplier}” as a new supplier` }));
  await expect(page.getByRole('button', { name: 'Supplier' })).toContainText(supplier);

  await page.getByLabel('Invoice no.').fill('TOUCH-1');
  await addByTouch(page, 'hydryllin', 'Hydryllin');
  await page.getByLabel(/^Qty/).fill('1');
  await page.getByLabel(/^Cost of 1/).fill('100');
  await tap(page.getByRole('button', { name: /^Add/ }));
  await expect(page.getByRole('table')).toContainText('Hydryllin');

  await tap(page.getByRole('button', { name: 'Receive stock' }));
  await expect(page.getByRole('status', { name: 'Received' })).toContainText('1 batch');
});

test('a return by touch, from the sale just made', async ({ page }) => {
  await openCounter(page);
  await addByTouch(page, 'disprin', 'Disprin');
  await tap(page.getByRole('button', { name: /^Pay/ }));
  const saved = await lastSale(page).textContent();
  const receiptNumber = saved?.match(/Saved — ([A-Z]+-\d+)/)?.[1];
  expect(receiptNumber).toBeTruthy();
  // The sale must have reached the shop's computer for its page to show it.
  await expect(page.getByRole('status', { name: /waiting to sync/ })).toHaveCount(0, {
    timeout: 30_000,
  });

  // "View sale" opens the sale's own page — it opened Returns.
  await tap(lastSale(page).getByRole('link', { name: 'View sale' }));
  await expect(page).toHaveURL(new RegExp(`/receipts/${receiptNumber!}$`), { timeout: 30_000 });
  await tap(page.getByRole('link', { name: 'Start a return' }));
  await page.getByLabel(/Return quantity for Disprin/).fill('1');
  expect(await undersized(page), 'Returns, with a sale open').toEqual([]);
  await tap(page.getByRole('button', { name: /^Confirm return/ }));
  await expect(page.getByRole('status')).toContainText('Returned');
});

test('a Bluetooth scanner after a tap: the scan adds its product', async ({ page }) => {
  await openCounter(page);
  await addByTouch(page, 'disprin', 'Disprin');
  const row = page.getByRole('row').filter({ hasText: 'Disprin' });
  await tap(row.getByRole('button', { name: /^One strip more/ }));
  await expect(row).toContainText('2 strip');
  // Focus is wherever the tap left it, never the search box. The scanner
  // types Panadol's strip code and Enter, as a keyboard does.
  await page.keyboard.type('8964000101018', { delay: 0 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('row').filter({ hasText: 'Panadol' })).toHaveCount(1);
  // And the tapped line is as it was.
  await expect(row).toContainText('2 strip');
});
