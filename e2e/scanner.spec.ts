import { expect, test, type Page } from '@playwright/test';

import { cart, openCounter, search, total, unsynced } from './support/counter';

/**
 * The barcode scanner at the counter (I1: "the scanner is a keyboard").
 *
 * A keyboard-wedge scanner types its code and presses Enter, all within a few
 * milliseconds, so every scan here is `keyboard.type` with no delay followed by
 * Enter — never `fill`, which would hide a race between typing and the result
 * list.
 *
 * Codes are minted per run from GS1's restricted-circulation range (20–29),
 * with a valid check digit, so the spec runs against a database it has run on
 * before (CLAUDE.md, Day 20) and never collides with a real product's code.
 */

/** A GTIN-13 in the 20–29 restricted range, unique to this run. */
let minted = 0;
function freshGtin13(): string {
  // Time plus a counter: two codes minted in the same millisecond must differ.
  minted += 1;
  const body = `20${String(Date.now() + minted * 7919).slice(-10)}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** A medicine pack's 2D code: (01) GTIN-14, (17) expiry, (10) batch — batch last, as printed. */
function packCode(gtin13: string, batch: string): string {
  return `010${gtin13}17301231` + `10${batch}`;
}

async function scan(page: Page, code: string): Promise<void> {
  await search(page).focus();
  await page.keyboard.type(code, { delay: 0 });
  await page.keyboard.press('Enter');
}

/** A stocked product with at least one pack level, sized from the live catalog. */
async function anyStockedProduct(page: Page): Promise<{ id: string; name: string }> {
  const response = await page.request.get('/api/catalog');
  expect(response.ok()).toBe(true);
  const snapshot = (await response.json()) as {
    products: Array<{ id: string; name: string; packLevels: unknown[] }>;
    stock: Record<string, number>;
  };
  const product = snapshot.products.find(
    (row) => row.packLevels.length > 0 && (snapshot.stock[row.id] ?? 0) > 0,
  );
  expect(product, 'a stocked product with a pack level exists').toBeDefined();
  return { id: product?.id ?? '', name: product?.name ?? '' };
}

test('a barcode linked on Products scans at the counter without a reload', async ({ page }) => {
  await openCounter(page);
  const product = await anyStockedProduct(page);
  const gtin = freshGtin13();

  await page.goto(`/products/${product.id}`);
  await page.getByLabel('Scan or type a code').fill(gtin, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.getByText(gtin)).toBeVisible();

  // Back to the counter by the function key: a client navigation, so the
  // catalog index in memory is the one built before the barcode existed.
  await page.keyboard.press('F1');
  await expect(page).toHaveURL(/\/sale$/);

  await scan(page, gtin);
  await expect(cart(page)).toContainText(product.name);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The pack's 2D code carries the same GTIN with a batch and an expiry: it
  // finds the same product, and so does the next delivery's batch.
  await scan(page, packCode(gtin, '892302XV'));
  await scan(page, packCode(gtin, 'B7Q41'));
  await expect(cart(page).getByRole('row').filter({ hasText: product.name })).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('an unknown code never becomes a product by itself, and links in place', async ({ page }) => {
  await openCounter(page);
  const product = await anyStockedProduct(page);
  const gtin = freshGtin13();
  const code = packCode(gtin, 'ZZ901');

  // The scanner's own Enter must not open anything that creates a product.
  await scan(page, code);
  await expect(page.getByText('This code is not linked to a product yet')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // "Add a new product" opens the quick item with an EMPTY name — the code is
  // never offered as one.
  await page.getByRole('option', { name: /Add a new product/ }).click();
  const quick = page.getByRole('dialog');
  await expect(quick.getByLabel('Name')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Link it: find the product, confirm the unit, and the line lands.
  await scan(page, code);
  await page.getByRole('option', { name: /Link it to a product/ }).click();
  await expect(page.getByText(/Linking code/)).toBeVisible();
  // The whole name, and the option chosen by it: a prefix's top match can be a
  // sibling product ("panado" ranks Panadol above Panadol Extra).
  await page.keyboard.type(product.name.toLowerCase());
  await page.getByRole('option').filter({ hasText: product.name }).first().click();
  await page
    .getByRole('button', { name: /^Link to / })
    .first()
    .click();
  await expect(cart(page)).toContainText(product.name);

  // From now on the code is a normal barcode — and a different batch of the
  // same pack finds it too.
  await scan(page, packCode(gtin, 'NEXT1'));
  await expect(page.getByText('This code is not linked to a product yet')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

/** Links `code` to a product from its Products page, as the owner does. */
async function linkOnProducts(page: Page, productId: string, code: string): Promise<void> {
  await page.goto(`/products/${productId}`);
  await page.getByLabel('Scan or type a code').fill(code, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.getByText(code)).toBeVisible();
}

test('a new product added from an unknown scan keeps the code', async ({ page }) => {
  await openCounter(page);
  const gtin = freshGtin13();
  const name = `Scanned new ${Date.now()}`;

  await scan(page, packCode(gtin, 'NEW1'));
  await page.getByRole('option', { name: /Add a new product/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick item' });
  // Saved as the product number, not this one pack's batch string.
  await expect(dialog).toContainText(`0${gtin}`);
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Price').fill('120');
  await dialog.getByLabel('Price').press('Enter');
  await expect(cart(page)).toContainText(name);

  // The next scan — another batch of the same pack — adds it directly.
  await scan(page, packCode(gtin, 'NEW2'));
  await expect(page.getByText('This code is not linked to a product yet')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // One line, now two of it: 2 × Rs 120.
  await expect(cart(page).getByRole('row').filter({ hasText: name })).toHaveCount(1);
  await expect(total(page)).toHaveText('Rs 240.00');

  // And the server has it, through sync: the catalog every counter loads
  // carries the code on the new product.
  await expect(unsynced(page)).toHaveCount(0, { timeout: 30_000 });
  await expect
    .poll(async () => {
      const snapshot = (await (await page.request.get('/api/catalog')).json()) as {
        products: Array<{ id: string; name: string }>;
        barcodes: Array<{ barcode: string; productId: string }>;
      };
      const created = snapshot.products.find((row) => row.name === name);
      return snapshot.barcodes.some(
        (row) => row.barcode === `0${gtin}` && row.productId === created?.id,
      );
    })
    .toBe(true);
});

test('a code another product owns is never put on a new one', async ({ page, context }) => {
  await openCounter(page);
  const owner = await anyStockedProduct(page);
  const gtin = freshGtin13();

  // Linked elsewhere after this counter built its index: the counter does not
  // know, so the scan reads as unknown — the server still does.
  const other = await context.newPage();
  await linkOnProducts(other, owner.id, gtin);
  await other.close();

  await scan(page, packCode(gtin, 'CLASH'));
  await page.getByRole('option', { name: /Add a new product/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick item' });
  await expect(dialog.getByRole('alert')).toContainText(`already on ${owner.name}`);
  await expect(dialog.getByRole('button', { name: /Save without the barcode/ })).toBeVisible();

  await dialog.getByRole('button', { name: `Sell ${owner.name} instead` }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(cart(page)).toContainText(owner.name);
});

test('an expired pack is added, and said to be expired', async ({ page }) => {
  await openCounter(page);
  const product = await anyStockedProduct(page);
  const gtin = freshGtin13();
  await linkOnProducts(page, product.id, gtin);
  await page.keyboard.press('F1');
  await expect(page).toHaveURL(/\/sale$/);

  // (17) 200131: this pack expired on 31 Jan 2020.
  await scan(page, `010${gtin}17200131` + '10OLD1');
  await expect(cart(page)).toContainText(product.name);
  await expect(page.getByRole('status', { name: 'Expired pack' })).toContainText('expired 01/2020');

  // A pack in date says nothing.
  await scan(page, packCode(gtin, 'FRESH1'));
  await expect(page.getByRole('status', { name: 'Expired pack' })).toHaveCount(0);
});

test('scanning a pack on Receive Stock fills its batch and expiry', async ({ page }) => {
  await openCounter(page);
  const product = await anyStockedProduct(page);
  const gtin = freshGtin13();
  await linkOnProducts(page, product.id, gtin);

  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await scan(page, `010${gtin}17300131` + '10B7Q41');
  await expect(page.getByLabel('Expiry')).toHaveValue('2030-01-31');
  await expect(page.getByLabel('Batch no.')).toHaveValue('B7Q41');
});

test('on Receive Stock, scanning the next product moves on — wherever the cursor is', async ({
  page,
}) => {
  await openCounter(page);
  const snapshot = (await (await page.request.get('/api/catalog')).json()) as {
    products: Array<{ id: string; name: string; packLevels: unknown[] }>;
  };
  const [first, second] = snapshot.products.filter((row) => row.packLevels.length > 0);
  const packGtin = freshGtin13();
  const boxEan = freshGtin13();
  await linkOnProducts(page, first!.id, packGtin);
  await linkOnProducts(page, second!.id, boxEan);

  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);

  // A 2D pack opens its line with batch and expiry; the cursor goes to Qty.
  await scan(page, `010${packGtin}17280331` + '10563C');
  await expect(page.getByLabel('Batch no.')).toHaveValue('563C');
  await expect(page.getByLabel(/^Qty/)).toBeFocused();

  // Scanned again before the line is finished: refused, and Qty is not left
  // holding barcode digits.
  await page.waitForTimeout(300);
  await page.keyboard.type(boxEan, { delay: 0 });
  await page.keyboard.press('Enter');
  await expect(
    page.getByText(`Finish the ${first!.name} line first`, { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel(/^Qty/)).toHaveValue('');

  // Finished like a person (one key at a time), the cursor left in Unit cost,
  // then the next product scanned: the first line is added, the next opens with
  // nothing carried over from the pack before it.
  await page.getByLabel(/^Qty/).pressSequentially('5', { delay: 120 });
  await page.getByLabel(/^Cost \//).pressSequentially('12', { delay: 120 });
  // A person reaches for the scanner: never within 50 ms of their last key.
  await page.waitForTimeout(300);
  await page.keyboard.type(boxEan, { delay: 0 });
  await page.keyboard.press('Enter');
  const lines = page.getByRole('table');
  await expect(lines).toContainText(first!.name);
  // Added with the pack's own expiry (the draft table shows expiry, not batch).
  await expect(lines).toContainText('2028-03-31');
  await expect(page.getByLabel(/^Cost \//)).toHaveValue('');
  // The next product's code is 1D: it says nothing about expiry or batch, so
  // both are asked for from the pack, and the cursor starts at its expiry
  // (PCN-012, Session 2) — nothing carried over from the pack before.
  await expect(page.getByLabel('Batch — from pack')).toHaveValue('');
  await expect(page.getByLabel('Expiry — from pack')).toHaveValue('');
  await expect(page.getByLabel('Expiry — from pack')).toBeFocused();
});

test('on Receive Stock, a barcode-sized number is refused as a quantity', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await search(page).fill('panadol');
  await page.getByRole('option').first().click();

  // Typed slowly, so it is not a scan — the backstop catches it on Add.
  await page.getByLabel(/^Qty/).pressSequentially('8961101721817', { delay: 60 });
  await page.getByLabel(/^Cost \//).fill('10');
  await page.getByLabel(/^Cost \//).press('Enter');
  await expect(page.getByText(/That quantity looks like a barcode/)).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('on Receive Stock, a barcode run into a price is refused, never a crash', async ({ page }) => {
  // What a missed scan into Unit cost used to do: "12" then thirteen digits is
  // more paisa than a number holds exactly, and the page threw instead of
  // refusing.
  const crashes: string[] = [];
  page.on('pageerror', (error) => crashes.push(error.message));
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  await search(page).fill('panadol');
  await page.getByRole('option').first().click();

  await page.getByLabel(/^Qty/).fill('5');
  // Typed slowly, so it is not a scan — the backstop catches it on Add.
  await page.getByLabel(/^Cost \//).pressSequentially('122030297825992', { delay: 60 });
  await page.getByLabel(/^Cost \//).press('Enter');
  await expect(page.getByText(/That price looks like a barcode/)).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(crashes).toEqual([]);
});

/**
 * A scan that lands on no field — the page, or a button just pressed (always,
 * on a tablet) — is not lost, and its Enter presses nothing where it landed.
 * It goes to the screen's own scan field (`data-scan-home`), or is put back
 * with the notice when the screen has none or a dialog is open.
 */
const PANADOL_STRIP = '8964000101018';

async function scanWherever(page: Page, code: string): Promise<void> {
  await page.keyboard.type(code, { delay: 0 });
  await page.keyboard.press('Enter');
}

const guardNotice = (page: Page) =>
  page.getByRole('alert').filter({ hasText: 'That was a barcode' });

test('Sale: a scan with focus off the search still adds the item', async ({ page }) => {
  await openCounter(page);
  await page.locator('aside').click({ position: { x: 5, y: 5 } });
  await expect(search(page)).not.toBeFocused();
  await scanWherever(page, PANADOL_STRIP);
  await expect(cart(page)).toContainText('Panadol');
  await expect(cart(page)).toContainText('1 strip');
});

test('Sale: a scan while paying commits nothing, whatever button has focus', async ({ page }) => {
  await openCounter(page);
  await scan(page, PANADOL_STRIP);
  await expect(cart(page)).toContainText('Panadol');
  await page.keyboard.press('F12');
  const payment = page.getByRole('dialog', { name: 'Payment' });
  await payment.getByRole('button', { name: /^Commit/ }).focus();
  await scanWherever(page, PANADOL_STRIP);
  await expect(guardNotice(page)).toBeVisible();
  await expect(payment).toBeVisible();
  await expect(page.getByText(/Saved — /)).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('Receive Stock: a scan on arrival starts a line, not the supplier picker', async ({
  page,
}) => {
  await openCounter(page);
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);
  // A new invoice starts at the supplier — which is where a scan lands.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.includes('purchase')) localStorage.removeItem(key);
    }
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Supplier' })).toBeFocused({ timeout: 30_000 });
  await scanWherever(page, PANADOL_STRIP);
  await expect(page.getByLabel(/^Qty/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Supplier' })).toHaveCount(0);
});

test('Products: a scan finds the product it belongs to', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F5');
  await expect(page).toHaveURL(/\/products$/);
  await scanWherever(page, PANADOL_STRIP);
  await expect(page).toHaveURL(new RegExp(`q=${PANADOL_STRIP}`), { timeout: 30_000 });
  await expect(page.getByRole('link', { name: /Panadol/ }).first()).toBeVisible();
});

test('Stock: a screen with no scan field says so, and nothing else happens', async ({ page }) => {
  await openCounter(page);
  await page.keyboard.press('F6');
  await expect(page).toHaveURL(/\/stock$/);
  await scanWherever(page, PANADOL_STRIP);
  await expect(guardNotice(page)).toBeVisible();
  await expect(page).toHaveURL(/\/stock$/);
});
