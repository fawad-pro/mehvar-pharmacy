import { expect, test, type Page } from '@playwright/test';

import { openCounter, search } from './support/counter';

/**
 * PCN-012, Session 2: stock comes in the way the paper says it does.
 *
 *  - Receive Stock in the pack it arrived in — largest first, bonus in the
 *    same pack, cost per pack — with an exact line cost.
 *  - "MRP of 1 box" per line: a price above it is warned; an MRP that differs
 *    from the record is offered to the owner, never applied silently.
 *  - Opening stock counted as the shelf holds it: boxes, strips, tablets.
 *
 * A fresh product per run, so the spec passes against a database it has run
 * on before (CLAUDE.md, Day 20).
 */

/** Tablets, strips of 10 at Rs 40, boxes of 10 strips (Rs 400 suggested). */
async function newProduct(page: Page, name: string): Promise<void> {
  await page.goto('/products/new');
  await page.getByRole('button', { name: 'Not in the list — enter it myself' }).click({
    timeout: 30_000,
  });
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Base unit').fill('tab');
  await page.getByLabel('Pack levels').fill('strip:10, box:100');
  await page.getByLabel('Price per strip').fill('40');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page).toHaveURL(/\/products$/, { timeout: 30_000 });
}

test('receive in boxes: bonus and cost per box, an exact line, and the MRP offered to the owner', async ({
  page,
}) => {
  const name = `Recvbox ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);

  await page.goto('/purchases');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await search(page).fill(name.toLowerCase());
  await page.getByRole('option').first().click({ timeout: 30_000 });

  // Packs only — a distributor never invoices loose tablets — largest first
  // and pressed; the price follows the pack.
  const arrivedIn = page.getByRole('group', { name: 'Arrived in' });
  await expect(arrivedIn.getByRole('button')).toHaveText(['box', 'strip'], { ignoreCase: true });
  await expect(arrivedIn.getByRole('button', { name: 'box' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Sells for')).toHaveValue('400.00');

  await page.getByLabel(/^How many/).fill('2');
  await page.getByLabel(/^Free/).fill('1');
  await page.getByLabel(/^Cost of 1/).fill('333.33');
  await page.getByLabel('Expiry').fill('12/2030');
  // The box says Rs 420; this shop will sell at Rs 450 — above it, warned.
  await page.getByLabel(/^MRP of 1/).fill('420');
  await page.getByLabel('Sells for').fill('450');
  await page.getByLabel(/^Cost of 1/).press('Enter');

  const line = page.getByRole('table').getByRole('row').filter({ hasText: name });
  await expect(line).toContainText('2 box');
  await expect(line.getByRole('cell').nth(2)).toHaveText('1 box');
  // Exactly 2 × Rs 333.33 — the free box is never charged.
  await expect(line).toContainText('666.66');
  await expect(line).toContainText('Above MRP');

  // No MRP on record yet: the owner may take the pack's, with the new price.
  await line.getByRole('button', { name: 'Record it, and sell at 450.00 per box' }).click();
  await expect(line.getByRole('status')).toContainText(`Recorded on ${name}`);

  // The newest invoice before this one, so the list's reload can be waited on.
  const recent = page.getByRole('region', { name: 'Recent deliveries' });
  const newestBefore = await recent
    .getByRole('link')
    .first()
    .getAttribute('href')
    .catch(() => null);
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByRole('status', { name: 'Received' })).toContainText('1 batch');

  // The invoice reads like the paper: boxes, cost per box, the exact total.
  const newest = recent.getByRole('link').first();
  await expect(newest).not.toHaveAttribute('href', newestBefore ?? '');
  await newest.click();
  const invoiceLine = page.getByRole('row').filter({ hasText: name });
  await expect(invoiceLine).toContainText('2 box', { timeout: 30_000 });
  await expect(invoiceLine).toContainText('+ 1 box bonus');
  await expect(invoiceLine).toContainText('666.66');

  // The product's box now sells at the price the owner took.
  // Opened from the invoice line itself; the product list is not searched.
  await invoiceLine.getByRole('link', { name }).click();
  await expect(page.getByLabel('Price per box')).toHaveValue('450.00', { timeout: 30_000 });
  // And the MRP reads as the box printed it, on the box (PCN-012).
  await expect(
    page.getByRole('group', { name: 'MRP printed on' }).getByRole('button', { name: 'box' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('MRP per box')).toHaveValue('420.00');
});

test('opening stock counted as boxes, strips and tablets, costed per box', async ({ page }) => {
  const name = `Openbox ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);

  await page.goto('/stock/adjust?opening=1');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await search(page).fill(name.toLowerCase());
  await page.getByRole('option').first().click({ timeout: 30_000 });

  await page.getByLabel('box', { exact: true }).fill('2');
  await page.getByLabel('strip', { exact: true }).fill('3');
  await page.getByLabel('tab', { exact: true }).fill('4');
  // Cost is required: blank is refused, never read as free (decision 5).
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Enter what this stock cost per box' }),
  ).toBeVisible();

  await page.getByLabel(/^Cost per box/).fill('250');
  // 234 tablets; Rs 250 a box of 100 makes them Rs 585.00, exactly.
  await expect(page.getByRole('status').filter({ hasText: 'in all' })).toHaveText(
    '2 box, 3 strip, 4 tab in all · costs Rs 585.00',
  );
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByText('Saved.', { exact: false })).toBeVisible();
});

/**
 * The line being entered fits one row on a desktop-wide screen, and wraps —
 * every field still usable, nothing off the side — on a narrow one.
 */
async function openLine(page: Page, name: string): Promise<void> {
  await page.goto('/purchases');
  await expect(search(page)).toBeVisible({ timeout: 30_000 });
  await search(page).fill(name.toLowerCase());
  await page.getByRole('option').first().click({ timeout: 30_000 });
  await expect(page.getByRole('group', { name: 'Arrived in' })).toBeVisible();
}

function lineControls(page: Page) {
  return [
    page.getByLabel(/^How many/),
    page.getByLabel(/^Free/),
    page.getByLabel(/^Cost of 1/),
    page.getByLabel(/^Expiry/),
    page.getByLabel(/^Batch/),
    page.getByLabel(/^MRP of 1/),
    page.getByLabel('Sells for'),
    page.getByRole('button', { name: 'Add line' }),
  ];
}

/** Every field's label is one line: the same height, none wrapped. */
async function labelsOnOneLine(page: Page): Promise<void> {
  const heights = await Promise.all(
    lineControls(page)
      .slice(0, 7)
      .map((control) =>
        control.evaluate(
          (input) =>
            input.closest('label')?.querySelector('span')?.getBoundingClientRect().height ?? 0,
        ),
      ),
  );
  expect(Math.max(...heights) - Math.min(...heights), `label heights: ${heights.join(', ')}`).toBe(
    0,
  );
  expect(Math.max(...heights), 'a label wrapped onto a second line').toBeLessThan(24);
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
}

test('the line is two rows of four at 1280×800 and wraps usably at 768px', async ({ page }) => {
  const name = `Layout ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);

  await page.setViewportSize({ width: 1280, height: 800 });
  await openLine(page, name);
  const boxes = await Promise.all(lineControls(page).map((control) => control.boundingBox()));
  const bottoms = boxes.map((box) => Math.round((box?.y ?? 0) + (box?.height ?? 0)));
  // PCN-016: two rows of four, in the order the invoice is read — how many,
  // free, cost, expiry; then batch, MRP, sells for and Add. Each row's
  // controls end on one line.
  for (const row of [bottoms.slice(0, 4), bottoms.slice(4)]) {
    expect(
      Math.max(...row) - Math.min(...row),
      `bottoms: ${bottoms.join(', ')}`,
    ).toBeLessThanOrEqual(2);
  }
  expect(
    bottoms[4]! - bottoms[0]!,
    'batch, MRP and sells for are on screen, a row down',
  ).toBeGreaterThan(20);
  for (const box of boxes) expect(box?.width ?? 0).toBeGreaterThanOrEqual(80);
  await labelsOnOneLine(page);
  // The unit is said once per field, in one pattern, and follows the pack.
  await expect(page.getByLabel('Cost of 1 box')).toBeVisible();
  await expect(page.getByLabel('MRP of 1 box')).toBeVisible();
  await expect(page.getByLabel('Sells for')).toBeVisible();
  await noSidewaysScroll(page);

  await page.setViewportSize({ width: 768, height: 1024 });
  for (const control of lineControls(page)) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(768);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(80);
  }
  await labelsOnOneLine(page);
  await noSidewaysScroll(page);
  // Still a working form: fill and add by keyboard.
  await page.getByLabel(/^How many/).fill('1');
  await page.getByLabel(/^Cost of 1/).fill('300');
  await page.getByLabel(/^Cost of 1/).press('Enter');
  await expect(page.getByRole('table').getByRole('row').filter({ hasText: name })).toContainText(
    '1 box',
  );
});

test('damaged strips go back from a box delivery: credit at stock cost, any difference shown', async ({
  page,
}) => {
  const name = `Stripback ${Date.now()}`;
  const supplier = `Strip Distributor ${Date.now()}`;
  await openCounter(page);
  await newProduct(page, name);

  // Two boxes on credit, Rs 640 a box.
  await page.goto('/purchases');
  await page.getByRole('button', { name: 'Supplier' }).click({ timeout: 30_000 });
  await page.getByPlaceholder('Name or phone…').fill(supplier);
  await page.getByRole('button', { name: `Add “${supplier}” as a new supplier` }).click();
  await search(page).fill(name.toLowerCase());
  await page.getByRole('option').first().click({ timeout: 30_000 });
  await page.getByLabel(/^How many/).fill('2');
  await page.getByLabel(/^Cost of 1/).fill('640');
  await page.getByLabel('Expiry').fill('12/2030');
  await page.getByLabel(/^Cost of 1/).press('Enter');
  await page.getByLabel('Paid now').fill('0');
  await page.getByRole('button', { name: 'Receive stock' }).click();
  await expect(page.getByRole('status', { name: 'Received' })).toContainText('1 batch');

  await page
    .getByRole('region', { name: 'Recent deliveries' })
    .getByRole('link', { name: new RegExp(supplier) })
    .first()
    .click();
  await page.getByRole('link', { name: /Correct this invoice or return goods/ }).click({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Return to supplier' }).click({ timeout: 30_000 });
  const giveBack = page.getByRole('form', { name: `Return ${name} to ${supplier}` });

  // Packs only, starting in the unit it was bought in; strips are a pack.
  const goingBackIn = giveBack.getByRole('group', { name: 'Going back in' });
  await expect(goingBackIn.getByRole('button')).toHaveText(['box', 'strip'], { ignoreCase: true });
  await expect(goingBackIn.getByRole('button', { name: 'box' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await goingBackIn.getByRole('button', { name: 'strip' }).click();
  await giveBack.getByLabel(/Quantity going back \(strip, up to 20\)/).fill('3');
  // Exactly what three strips cost: Rs 1,280 over 200 tablets, 30 of them.
  await expect(giveBack.getByLabel(/^Credit from/)).toHaveValue('192.00');
  await expect(giveBack.getByRole('status', { name: 'Stock cost' })).toHaveText(
    'These go back at a stock cost of 192.00.',
  );
  // The distributor gives less; the difference is said, not absorbed.
  await giveBack.getByLabel(/^Credit from/).fill('180');
  await expect(giveBack.getByRole('status', { name: 'Stock cost' })).toContainText(
    'the credit is 12.00 less',
  );
  await giveBack.getByLabel('Note').fill('damaged strips');
  await giveBack.getByLabel('Note').press('Enter');
  await expect(page.getByText(`${name}: return to ${supplier} recorded.`)).toBeVisible();
  await expect(page.getByText('1 box, 7 strip on hand')).toBeVisible();

  await page.getByRole('link', { name: '← Back to the invoice' }).click();
  const history = page.getByRole('heading', { name: 'Corrections and returns' }).locator('..');
  await expect(history).toContainText(`3 strip returned to ${supplier}, credit 180.00`, {
    timeout: 30_000,
  });
  await expect(history).toContainText('stock cost 192.00 (12.00 below stock cost)');
});
