import { expect, test, type Page } from '@playwright/test';

import { cart, DEMO, openCounter, payAndSettle, printedReceipt, search } from './support/counter';

/**
 * Day 7's screens: W4 returns, W10 day close, W11 the owner phone view, and
 * Settings' export — the day whose done-when is "the owner's three questions
 * answer in one glance on a phone" (Phase 13).
 *
 * `openCounter` pairs the device as the owner (loginDevice's starting user),
 * so F9/F2/Settings are reachable here without a PIN switch first.
 */

/** Sells one Panadol and waits for it to settle — see `payAndSettle`. */
async function sellPanadol(page: Page): Promise<string | null> {
  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('Panadol');
  return payAndSettle(page);
}

test('W4: a return finds the sale, restocks a batch, and prints a refund receipt', async ({
  page,
}) => {
  await openCounter(page);

  // Sell something to return.
  const saved = await sellPanadol(page);
  // The receipt number and the total are adjacent sibling <p> elements with no
  // separating whitespace in the DOM, so `textContent` joins them with none
  // either — `\S+` alone would swallow the total too. The receipt format
  // (device prefix + counter, Phase 9 §3) is what bounds the match instead.
  const receiptNumber = saved?.match(/Saved — ([A-Za-z]+-\d+)/)?.[1];
  expect(receiptNumber).toBeTruthy();

  // F2 is Receipts. The whole point of the separation is that
  // looking at a sale and refunding it are different acts, so the walk is:
  // find the receipt → read it → decide → start the return from it.
  await page.keyboard.press('F2');
  await expect(page).toHaveURL(/\/receipts$/);

  await page.getByLabel('Find a receipt').fill(receiptNumber!);
  await page.getByRole('link', { name: receiptNumber! }).first().click();
  await expect(page).toHaveURL(new RegExp(`/receipts/${receiptNumber!}$`));

  // Reviewing shows what was sold without entering any workflow.
  await expect(page.getByRole('table')).toContainText('Panadol');

  // Only now, and only deliberately, does the refund path open.
  await page.getByRole('link', { name: 'Start a return' }).click();
  await expect(page).toHaveURL(/\/returns\?receipt=/);

  // The handoff lands on the sale itself — the operator does not search twice.
  await expect(page.getByRole('table')).toContainText('Panadol');
  await page.getByLabel(/Return quantity for Panadol/).fill('1');
  await page.getByRole('button', { name: 'Confirm return' }).click();

  await expect(page.getByRole('status')).toContainText('Returned');
  await expect(printedReceipt(page)).toContainText('Panadol');
  // A refund slip says so: no "Amount Due", no minus signs.
  await expect(printedReceipt(page)).toContainText(`RETURN — against receipt ${receiptNumber!}`);
  await expect(printedReceipt(page)).toContainText('Cash refunded');
  await expect(printedReceipt(page)).not.toContainText('Amount Due');
  await expect(printedReceipt(page)).not.toContainText(/-[\d,]+\.\d{2}/);
});

test('W4 by keyboard: a receipt number and Enter open the sale; a quantity and Enter refund it', async ({
  page,
}) => {
  await openCounter(page);
  const saved = await sellPanadol(page);
  const receiptNumber = saved?.match(/Saved — ([A-Za-z]+-\d+)/)?.[1];
  expect(receiptNumber).toBeTruthy();

  await page.goto('/returns');
  const find = page.getByLabel('Receipt number or customer name');
  await expect(find).toBeFocused({ timeout: 30_000 });
  // Typed (or scanned) whole, then Enter: that sale opens. It used to do
  // nothing until the result was clicked.
  await find.fill(receiptNumber!);
  await page.keyboard.press('Enter');
  // And focus goes to how many came back, not to the page.
  const qty = page.getByLabel(/Return quantity for Panadol/);
  await expect(qty).toBeFocused({ timeout: 30_000 });
  await page.keyboard.type('1', { delay: 120 });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Returned');
});

test('a quantity typed on Returns survives a late answer for the same sale', async ({ page }) => {
  // React's development StrictMode loads the sale twice; in production the
  // same gap opens when the operator switches sales before the lines arrive.
  // Every repeat of a server action is held back here, so any late answer
  // lands after the quantity is typed — and must not wipe it.
  await openCounter(page);
  const saved = await sellPanadol(page);
  const receiptNumber = saved?.match(/Saved — ([A-Za-z]+-\d+)/)?.[1] ?? '';
  expect(receiptNumber).toBeTruthy();

  const seen = new Set<string>();
  await page.route(/\/returns\?receipt=/, async (route) => {
    const action = route.request().headers()['next-action'];
    if (route.request().method() === 'POST' && action) {
      if (seen.has(action)) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      seen.add(action);
    }
    await route.continue();
  });

  await page.keyboard.press('F2');
  await expect(page).toHaveURL(/\/receipts$/);
  await page.getByLabel('Find a receipt').fill(receiptNumber);
  await page.getByRole('link', { name: receiptNumber }).first().click();
  await page.getByRole('link', { name: 'Start a return' }).click();
  await expect(page.getByRole('table')).toContainText('Panadol');

  const quantity = page.getByLabel(/Return quantity for Panadol/);
  await quantity.fill('1');
  // Long enough for every held answer to land, twice over.
  await page.waitForTimeout(4_000);
  await expect(quantity).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Confirm return' })).toBeEnabled();
  await page.unrouteAll({ behavior: 'wait' });
});

test('W10: the three numbers, a cash movement, and the drawer count', async ({ page }) => {
  await openCounter(page);

  await page.keyboard.press('F9');
  await expect(page).toHaveURL(/\/day$/);

  // Each label carries its own time scope, because the three numbers do not
  // share one: sales and cash are the selected day's, the udhaar total is a
  // position and is always all-time.
  await expect(page.getByText('Sales today')).toBeVisible();
  await expect(page.getByText('Cash expected in drawer')).toBeVisible();
  await expect(page.getByText('Owed to you, all time')).toBeVisible();

  // Three, and only three, at that size. "Revenue" was the same query as
  // "Sales today" under another name, so an owner scanning the screen saw one
  // number twice and had to work out that they were not different figures.
  await expect(page.getByText('Revenue')).toBeHidden();
  await expect(page.getByText('Sale count')).toBeHidden();

  // And one line answering "is anything wrong?", in place of six headings the
  // owner had to scan and total up for themselves.
  await expect(
    page.getByText(/Nothing needs a look today\.|thing(s)? need(s)? a look/),
  ).toBeVisible();

  const expected = page
    .getByText('Cash expected in drawer')
    .locator('xpath=..')
    .locator('p.numeral');
  await expect(expected).toContainText('Rs', { timeout: 30_000 });
  const before = (await expected.textContent()) ?? '';

  // Record a cash movement — an owner withdrawal. A distinctive amount, so
  // this run's row is the one found and cancelled below.
  const withdrawn = 400 + (Date.now() % 100);
  await page.getByLabel('Reason').selectOption('owner_withdrawal');
  await page.getByLabel('Amount').fill(String(withdrawn));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  // The drawer-count ritual: counting something other than expected produces
  // a difference, and recording it closes the ritual (D5 — nothing locks).
  // A small, believable difference: this spec counted Rs 999,999 once, and
  // on a developer's database that became the day's expected cash for good.
  await expect(expected).not.toHaveText(before, { timeout: 30_000 });
  const expectedText = (await expected.textContent()) ?? '';
  const expectedPaisa = Math.round(Number(expectedText.replace(/[^0-9.-]/g, '')) * 100);
  expect(Number.isSafeInteger(expectedPaisa), expectedText).toBe(true);
  const overPaisa = 700 + (Date.now() % 97);
  await page
    .getByLabel(/actually in the drawer/)
    .fill(((expectedPaisa + overPaisa) / 100).toFixed(2));
  await expect(page.getByText(`Over by ${rupees(overPaisa)}`)).toBeVisible();
  await page.getByRole('button', { name: 'Record over/short' }).click();
  await expect(page.getByText(/Recorded/)).toBeVisible();

  // Leave the drawer as it was found (CLAUDE.md: a spec that leaves balance
  // state behind must clear it): both entries cancelled, as PCN-013 allows.
  await cancelCashEntry(page, `-${rupees(withdrawn * 100)}`, 'Owner withdrawal');
  await cancelCashEntry(page, `+${rupees(overPaisa)}`, 'Over/short at count');
  await expect(expected).toHaveText(before, { timeout: 30_000 });
});

/** As the screen writes an amount: 1,234.50. */
function rupees(amountPaisa: number): string {
  return (amountPaisa / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function cancelCashEntry(page: Page, amount: string, reason: string): Promise<void> {
  const entry = page
    .getByRole('listitem')
    .filter({ hasText: amount })
    .filter({ hasText: reason })
    .filter({ hasNotText: 'Cancelled:' });
  await expect(entry).toHaveCount(1, { timeout: 30_000 });
  await entry.getByRole('button', { name: 'Cancel entry' }).click();
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(entry).toContainText('— cancelled', { timeout: 30_000 });
}

/**
 * The Overall tab sums every rupee since installation, so an "expected cash in
 * drawer" there is not a figure anyone can count against. Leaving the counting
 * form on that tab let an owner record an over/short of the entire lifetime
 * takings — an append-only row that cannot be edited and would corrupt every
 * later cash figure. The guard is that neither the figure nor the form exists
 * outside the day they belong to.
 */
test('the Overall range offers no drawer count to record against a lifetime figure', async ({
  page,
}) => {
  await openCounter(page);
  await page.goto('/day?view=overall');

  await expect(page.getByText('Sales, all time')).toBeVisible();
  await expect(page.getByText('Owed to you, all time')).toBeVisible();

  await expect(page.getByText('Cash expected in drawer')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Record over/short' })).toBeHidden();
  await expect(page.getByText('Record a cash movement')).toBeHidden();

  // Still reachable where it does mean something.
  await page.goto('/day?view=daily');
  await expect(page.getByRole('button', { name: 'Record over/short' })).toBeVisible();
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
  // React's duplicate-key warning: two batches of one product with the same
  // expiry shared a row key, so one could be drawn twice or not at all.
  const keyWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('two children with the same key')) keyWarnings.push(message.text());
  });
  await page.goto('/owner/login');
  await page.getByLabel('Pharmacy code').fill('demo');
  await page.getByLabel('Password').fill('owner-demo-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/owner$/);
  await expect(page.getByText("Today's sales")).toBeVisible();
  await expect(page.getByText('Expected cash in drawer')).toBeVisible();
  // Renamed with the netting fix: it is money owed TO the shop, floored per
  // customer, and never a net figure that an advance could push negative.
  await expect(page.getByText('Owed to you')).toBeVisible();

  await page.getByRole('button', { name: 'Udhaar' }).click();
  await expect(page.getByText('Rashid Sahib')).toBeVisible();

  await page.getByRole('button', { name: 'Stock' }).click();
  await expect(page.getByText('Running low')).toBeVisible();
  expect(keyWarnings).toEqual([]);
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
