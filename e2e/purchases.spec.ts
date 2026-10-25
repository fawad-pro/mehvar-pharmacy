import { expect, test, type Page } from '@playwright/test';

import { SEED_PRODUCTS } from '../scripts/db/seed-data';

import { cart, lastSale, openCounter, payAndSettle, search, unsynced } from './support/counter';

/**
 * Day 6's "done when", verbatim: "a 20-line invoice enters at working rhythm
 * and resolves a pending shortfall from Day 3" (Phase 13 §3).
 *
 * The transaction semantics live in `commit-purchase.integration.test.ts` and
 * the arithmetic in the rebuild-equivalence suite. What only a browser proves
 * is the part W7 actually asks for — that the per-line rhythm works, that the
 * half-entered invoice survives being interrupted by a customer, and that
 * receiving it visibly closes the loop D2 opened at the counter.
 */

const PURCHASES_URL = /\/purchases$/;

/** Stocked, but thinly, and used by no other spec — see below. */
const SHORTFALL_PRODUCT = 'Toradol';

/** Enters one invoice line at the rhythm W7 describes. */
async function addLine(
  page: Page,
  term: string,
  fields: { qty: string; bonus?: string; cost: string; price?: string; expiry?: string },
): Promise<void> {
  await search(page).fill(term);
  await page.getByRole('option').first().click();

  await page.getByLabel(/^Qty/).fill(fields.qty);
  if (fields.bonus) {
    await page.getByLabel('Bonus').fill(fields.bonus);
  }
  await page.getByLabel('Unit cost').fill(fields.cost);
  if (fields.expiry) {
    await page.getByLabel('Expiry').fill(fields.expiry);
  }
  if (fields.price) {
    await page.getByLabel('Sells for').fill(fields.price);
  }
  // Enter from any field adds the line and returns focus to search.
  await page.getByLabel('Unit cost').press('Enter');
}

/**
 * Regression: the invoice total is Σ qty × unit cost, and a line added with no
 * unit cost lands at zero — so the total silently read Rs 0.00 "even after
 * adding a line", the margin was computed against nothing, and (since PCN-006)
 * the supplier balance thought the delivery was free. "Sells for" is pre-filled
 * from the catalog and "Unit cost" is not, which is what made the field so easy
 * to skip. Adding a line now requires the cost to be entered; a genuinely free
 * line is an explicit "0", never a blank.
 */
/**
 * Enough whole boxes to sell more than the counter holds right now, by up to
 * eight boxes. Read from the same catalog payload the counter's index uses.
 */
async function boxesBeyondStock(page: Page, name: string): Promise<number> {
  const seeded = SEED_PRODUCTS.find((product) => product.name.startsWith(name));
  const perBox = seeded?.packLevels[0]?.factor ?? 1;
  const response = await page.request.get('/api/catalog');
  expect(response.ok()).toBe(true);
  const snapshot = (await response.json()) as {
    products: Array<{ id: string; name: string }>;
    stock: Record<string, number>;
  };
  const product = snapshot.products.find((row) => row.name.startsWith(name));
  expect(product, `${name} is in the catalog`).toBeDefined();
  const onHand = Math.max(0, snapshot.stock[product?.id ?? ''] ?? 0);
  return Math.floor(onHand / perBox) + 8;
}

test('the invoice total reflects the cost of every entered line', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(PURCHASES_URL);

  const invoiceTotal = page.getByText('Invoice total').locator('..');

  // A line with no unit cost is refused, so the total can never be a meaningless
  // zero behind a line that looks entered.
  await search(page).fill('panadol');
  await page.getByRole('option').first().click();
  await page.getByLabel(/^Qty/).fill('100');
  await page.getByRole('button', { name: /^Add/ }).click();
  await expect(page.getByText(/type 0 if it was free/i)).toBeVisible();
  await expect(invoiceTotal).toContainText('0 lines');

  // With the cost entered, the line lands and the total is qty × cost.
  await page.getByLabel('Unit cost').fill('2.80');
  await page.getByLabel('Unit cost').press('Enter');
  await expect(page.getByRole('table')).toContainText('Panadol');
  await expect(invoiceTotal).toContainText('Rs 280.00');
  await expect(invoiceTotal).toContainText('1 line');

  // An explicit zero is still allowed — a free sample is a real thing, and it
  // adds nothing to the total, which is correct.
  await addLine(page, 'brufen', { qty: '5', cost: '0' });
  await expect(page.getByRole('table')).toContainText('Brufen');
  await expect(invoiceTotal).toContainText('Rs 280.00');
  await expect(invoiceTotal).toContainText('2 lines');
});

test('W7: an invoice enters line by line, and the draft survives an interruption', async ({
  page,
}) => {
  await openCounter(page);

  await page.keyboard.press('F7');
  await expect(page).toHaveURL(PURCHASES_URL);

  await page.getByLabel('Invoice no.').fill('DIST-4417');
  await addLine(page, 'panadol', { qty: '100', cost: '2.80', expiry: '2027-06-30' });
  await addLine(page, 'brufen', { qty: '50', bonus: '5', cost: '7.20' });

  const table = page.getByRole('table');
  await expect(table).toContainText('Panadol');
  await expect(table).toContainText('Brufen');
  // The scheme line shows the blended cost it will actually carry, not the
  // invoiced one — bonus-cost honesty, visible at entry time.
  await expect(table).toContainText('+5');
  await expect(table).toContainText('× 55');

  // A customer walks in mid-invoice. This is the case W7 exists for.
  await page.keyboard.press('F1');
  await expect(page).toHaveURL(/\/sale$/);
  await search(page).fill('disprin');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('Disprin');
  // Settled before the next key: see `payAndSettle`.
  expect(await payAndSettle(page)).toMatch(/Saved — A-\d+/);

  // Back to the invoice — nothing lost.
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(PURCHASES_URL);
  await expect(page.getByText(/Resumed/)).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Panadol');
  await expect(page.getByRole('table')).toContainText('Brufen');
  await expect(page.getByLabel('Invoice no.')).toHaveValue('DIST-4417');

  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByRole('status', { name: 'Received' })).toContainText('2 batches');

  // Received means received: the draft is gone rather than lingering to be
  // entered twice.
  await page.reload();
  await expect(page.getByText(/Resumed/)).toBeHidden();
});

test('the done-when: receiving stock resolves a shortfall the counter sold into', async ({
  page,
}) => {
  await openCounter(page);

  // Day 3's promise first — sell far more than the system has, which D2 records
  // as a pending shortfall rather than refusing (P2).
  //
  // Toradol is seeded with ten ampoules and no other spec touches it, so
  // receiving it at the end of this test cannot pull another spec's oversell
  // back into stock. (It did: this test and sale.spec.ts both reached for
  // Rocephin, and this one stocking it made the other's correct behaviour look
  // like a regression.)
  //
  // The quantity is sized from what the system holds NOW, not assumed from the
  // seed: every run of this test receives 500, so a fixed 40 stopped being a
  // shortfall after the first run, and the suite has to pass against a
  // developer's database without resetting it.
  //
  // Not one of the two products seeded at zero, deliberately: a product that
  // has never had a batch is absent from the stock map, which the index reads
  // as *unknown* rather than zero (catalog-queries.ts), and unknown does not
  // warn. That is the right call — it just means the shortfall path has to be
  // tested with a product the system has an opinion about.
  const boxes = await boxesBeyondStock(page, SHORTFALL_PRODUCT);
  await search(page).fill(`${boxes}*${SHORTFALL_PRODUCT.toLowerCase()}`);
  await expect(page.getByRole('option').first()).toContainText(SHORTFALL_PRODUCT);
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText(/more than in stock|not in stock/);
  await page.keyboard.press('F12');
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText('Sold more than the system had');
  // The counter prints from local state (ADR-3), so the sale is done here
  // before the server has heard of it. The stock screen is a server view, so
  // wait for the outbox to drain — this is the real ordering, not a test trick.
  await expect(unsynced(page)).toBeHidden({ timeout: 20_000 });

  // The shortfall is visible rather than silent — D2's whole claim. Scoped to
  // the exception region, because the product legitimately appears elsewhere on
  // this screen (near-expiry, adjustments) and only its presence *here* means
  // the shelf and the numbers disagree.
  await page.keyboard.press('F6');
  await expect(page).toHaveURL(/\/stock$/);
  const shortfalls = page.getByRole('region', { name: 'Sold more than the system had' });
  await expect(shortfalls).toBeVisible();
  await expect(shortfalls).toContainText(SHORTFALL_PRODUCT);

  // Day 6's promise — the missing purchase arrives.
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(PURCHASES_URL);
  await addLine(page, SHORTFALL_PRODUCT.toLowerCase(), {
    qty: '500',
    cost: '95.00',
    expiry: '2027-12-31',
  });
  await page.getByRole('button', { name: 'Receive stock' }).click();

  const received = page.getByRole('status', { name: 'Received' });
  await expect(received).toContainText('1 batch');
  // The loop closes, and says so in plain words rather than a status code.
  await expect(received).toContainText(/already been sold are now accounted for/);

  // And the incident is gone from the exception list, because it was answered.
  //
  // This product's incident, not the whole list: the suite shares a database
  // and W6's offline quick items are themselves legitimate shortfalls, so the
  // region staying visible for somebody else's incident is correct behaviour.
  await page.keyboard.press('F6');
  await expect(page).toHaveURL(/\/stock$/);
  await expect(
    page
      .getByRole('region', { name: 'Sold more than the system had' })
      .getByText(SHORTFALL_PRODUCT),
  ).toBeHidden();
});

test('W7: twenty lines go in without the invoice growing harder to enter', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(PURCHASES_URL);

  await page.getByLabel('Invoice no.').fill('DIST-4418');

  // Distinct products, because a real invoice is distinct products — and
  // because a repeated one would prove nothing about the twentieth line being
  // as cheap to enter as the first.
  const names = SEED_PRODUCTS.slice(0, 20).map((product) => product.name);
  for (const [index, name] of names.entries()) {
    await addLine(page, name, { qty: String(10 + index), cost: '5.00' });
  }

  const rows = page.getByRole('table').getByRole('row');
  // 20 lines plus the header.
  await expect(rows).toHaveCount(21);
  // This draft's count, not the recent-purchases list beneath it, which on a
  // database this test has run against before lists an earlier 20-line invoice.
  await expect(
    page.getByText('Invoice total').locator('..').getByText('20 lines', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByRole('status', { name: 'Received' })).toContainText('20 batches');
});

test('W8: an adjustment needs a coded reason, and says who made it', async ({ page }) => {
  await openCounter(page);

  await page.keyboard.press('F8');
  await expect(page).toHaveURL(/\/stock\/adjust$/);

  // Adding stock creates its own batch, so no batch is asked for.
  await page.getByRole('button', { name: 'Add stock' }).click();
  await search(page).fill('panadol');
  await page.getByRole('option').first().click();

  await page.getByLabel('Units to add').fill('24');
  await page.getByLabel('Reason').selectOption('count_correction');
  await page.getByLabel('Note (optional)').fill('found behind the counter');
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved.', { exact: false })).toBeVisible();

  // T1 — visible, attributed, and listed without exception.
  //
  // On Adjust, not Stock. Stock browsing answers "what do I have"; a log of
  // corrections answers "what did we change", and belongs with the screen that
  // makes them.
  await page.keyboard.press('F8');
  await expect(page).toHaveURL(/\/stock\/adjust$/);
  const adjustments = page.getByRole('list').filter({ hasText: 'count correction' });
  await expect(adjustments).toContainText('Panadol');
  await expect(adjustments).toContainText('found behind the counter');
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A product with stock on hand now — Panadol when it has some. */
async function stockedProduct(page: Page): Promise<{ id: string; name: string }> {
  const response = await page.request.get('/api/catalog');
  expect(response.ok()).toBe(true);
  const snapshot = (await response.json()) as {
    products: Array<{ id: string; name: string }>;
    stock: Record<string, number>;
  };
  const stocked = snapshot.products.filter((row) => (snapshot.stock[row.id] ?? 0) > 0);
  const product = stocked.find((row) => /panadol/i.test(row.name)) ?? stocked[0];
  expect(product, 'some product has stock on hand').toBeDefined();
  return { id: product?.id ?? '', name: product?.name ?? '' };
}

test('W8: removing stock must name the batch it leaves from', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F8');
  // Wait for the destination before typing: without it the fill lands in the
  // Sale screen's search box, and the option it resolves detaches under the
  // click as the adjustment screen mounts.
  await expect(page).toHaveURL(/\/stock\/adjust$/);

  // Sized from live stock, never the seed (Day 20): other specs sell Panadol
  // down, so its earliest batch can hold fewer units than any fixed number.
  const product = await stockedProduct(page);
  await search(page).fill(product.name);
  await page
    .getByRole('option', { name: new RegExp(escapeRegExp(product.name)) })
    .first()
    .click();

  // Removing is the default direction, and it asks which batch — FEFO-ordered,
  // so the one the operator most likely means is already chosen.
  const batch = page.getByLabel('From batch');
  await expect(batch).toBeVisible();
  const chosen = await batch.evaluate(
    (select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? '',
  );
  const left = Number(/(\d+)\s[^·]*left\s*$/.exec(chosen)?.[1] ?? 0);
  expect(left, `the chosen batch says how many are left: "${chosen}"`).toBeGreaterThan(0);

  await page.getByLabel('Units to remove').fill(String(Math.min(3, left)));
  await page.getByLabel('Reason').selectOption('damage');
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved.', { exact: false })).toBeVisible();
});

test('W12: the stock screen lists what is expiring, across horizons', async ({ page }) => {
  await openCounter(page);

  await page.keyboard.press('F6');
  await expect(page).toHaveURL(/\/stock$/);
  await expect(page.getByRole('heading', { name: 'Expiring soon' })).toBeVisible();

  // The horizons are W12's 30/60/90, and they are navigation rather than a
  // filter the operator has to configure.
  await page.getByRole('link', { name: '90 days' }).click();
  await expect(page).toHaveURL(/within=90/);
  await expect(page.getByRole('link', { name: '90 days' })).toHaveAttribute('aria-current', 'page');
});
