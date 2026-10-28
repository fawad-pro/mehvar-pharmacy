import { expect, test } from '@playwright/test';

import {
  cart,
  DEMO,
  lastSale,
  openCounter,
  printedReceipt as receipt,
  search,
  total,
} from './support/counter';

/**
 * Day 3's "done when": "a keyboard-only cash sale commits, stock derives
 * correctly, and the verifier agrees" (Phase 13 §3).
 *
 * The transaction itself is covered against a real database by
 * `commit-sale.integration.test.ts`, and the arithmetic by the rebuild-
 * equivalence suite. What this file proves is the part only a browser can: that
 * W1's path works end to end with the hands never leaving the keyboard (I1).
 */

test('W1: a cash sale, start to finish, without touching the mouse', async ({ page }) => {
  await openCounter(page);

  // Focus is already in search — home position (Phase 7 rule 1).
  await expect(search(page)).toBeFocused();

  // Type, pick, and the line lands with focus back in search for the next item.
  await search(page).press('p');
  await search(page).press('a');
  await search(page).press('n');
  await expect(page.getByRole('option').first()).toContainText('Panadol');
  await page.keyboard.press('Enter');

  await expect(cart(page)).toContainText('Panadol');
  // A strip is the pre-selected level (I3), so one selection is ten tablets.
  await expect(cart(page)).toContainText('1 strip');
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue('');

  // A second item, by quantity grammar: three strips in one gesture.
  await search(page).fill('3*brufen');
  await expect(page.getByText(/Quantity 3/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('3 strip');

  // Rs 3.50 × 10 + Rs 9.00 × 30 = Rs 305.00
  await expect(total(page)).toHaveText('Rs 305.00');

  // F12 opens the payment overlay; Enter commits the exact tendered amount
  // (Phase 10 §4's default).
  await page.keyboard.press('F12');
  await expect(page.getByRole('dialog', { name: 'Payment' })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);
  await expect(lastSale(page)).toContainText('305.00');

  // The cart clears and focus returns for the next customer (W1).
  await expect(total(page)).toHaveText('Rs 0.00');
  await expect(search(page)).toBeFocused();
});

test('editing a line in place, by keyboard (Phase 10 §4)', async ({ page }) => {
  await openCounter(page);

  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('1 strip');

  // ArrowUp out of search enters the cart; + steps by the entered unit.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('+');
  await expect(cart(page)).toContainText('2 strip');
  await expect(total(page)).toHaveText('Rs 70.00');

  // Tab cycles the unit level and re-expresses the same count at the new one.
  await page.keyboard.press('Tab');
  await expect(cart(page)).toContainText('2 box');

  // − steps back down, and taking it to zero removes the line.
  await page.keyboard.press('-');
  await expect(cart(page)).toContainText('1 box');
  await page.keyboard.press('-');
  await expect(page.getByText('Scan a barcode or type a name — Enter puts it on the bill.')).toBeVisible();
  await expect(search(page)).toBeFocused();
});

test('a scanned barcode adds the item at the level the code means', async ({ page }) => {
  await openCounter(page);

  // The seeded Panadol code is a strip code.
  await search(page).fill('8964000101018');
  await page.keyboard.press('Enter');

  await expect(cart(page)).toContainText('Panadol');
  await expect(cart(page)).toContainText('1 strip');
});

test('selling more than the system has proceeds, and says so (D2, P2)', async ({ page }) => {
  await openCounter(page);

  // Rocephin is seeded with a small quantity; ask for far more than exists.
  // It is this spec's product: the suite shares one database, so a spec that
  // *receives* stock must reach for something no selling spec depends on being
  // short of (purchases.spec.ts uses Hydryllin for exactly that reason).
  await search(page).fill('rocephin');
  await expect(page.getByRole('option').first()).toContainText('Rocephin');
  await page.keyboard.press('Enter');

  await page.keyboard.press('ArrowUp');
  for (let press = 0; press < 40; press += 1) {
    await page.keyboard.press('+');
  }
  // Either wording is the same D2 exposure: "not in stock" once earlier sales
  // have already emptied it, "more than in stock" while some remains. The suite
  // shares a database, so which one appears depends on what ran before.
  await expect(cart(page)).toContainText(/More than in stock|Not in stock/);

  await page.keyboard.press('F12');
  await page.keyboard.press('Enter');

  // The sale is not refused; the shortfall is surfaced (D2).
  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);
  await expect(lastSale(page)).toContainText('Sold more than the system had');
  // Said to the shop, never to the customer: the receipt is theirs to keep.
  await expect(receipt(page)).toContainText('Rocephin');
  await expect(receipt(page)).not.toContainText(/system|exception|stock/i);
});

test('receipt numbers advance per device and never repeat', async ({ page }) => {
  await openCounter(page);

  const numbers: string[] = [];
  for (let sale = 0; sale < 3; sale += 1) {
    await search(page).fill('disprin');
    await page.keyboard.press('Enter');
    await page.keyboard.press('F12');
    await page.keyboard.press('Enter');

    // Wait for THIS sale's number. Reading the status straight after Enter can
    // catch the previous sale's text, which read as a repeated number.
    await expect(lastSale(page)).toContainText(/Saved — A-\d+/);
    const previous = numbers.at(-1);
    if (previous !== undefined) {
      await expect(lastSale(page)).not.toContainText(new RegExp(`A-${previous}(?!\\d)`));
    }
    const text = (await lastSale(page).textContent()) ?? '';
    const match = /A-(\d+)/.exec(text);
    expect(match, 'a receipt number was issued').not.toBeNull();
    numbers.push(match![1]!);
    await expect(total(page)).toHaveText('Rs 0.00');
  }

  expect(new Set(numbers).size).toBe(3);
  const counters = numbers.map(Number);
  expect(counters[1]).toBeGreaterThan(counters[0]!);
  expect(counters[2]).toBeGreaterThan(counters[1]!);
});

test('search results show the compact on-hand figure for every row', async ({ page }) => {
  await openCounter(page);

  await search(page).fill('disprin');
  await expect(page.getByRole('option').first()).toContainText('Disprin');
  // Regardless of level: the suite shares a database, so the exact count moves
  // as other specs sell or receive it — only the shape is asserted here. The
  // existing colour-coded low/zero badge (StockBadge) is untouched by this.
  // An amount in the product's units, or "Short by …" — never a minus sign
  // (PCN-012 decision 8).
  await expect(page.getByRole('option').first()).toContainText(/On hand: (Short by )?\d+ \w/);
  await expect(page.getByRole('option').first()).not.toContainText(/On hand: -/);
});

test('a fixed PKR line discount reduces that line and the total, by keyboard', async ({ page }) => {
  await openCounter(page);

  // Disprin: Rs 2.50/tab, strip of 10 — one strip is Rs 25.00 (a round number
  // that makes the arithmetic in this test readable).
  await search(page).fill('disprin');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('Rs 25.00');

  // ArrowUp out of search selects the line; '%' opens its discount field.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('%');
  await page.getByLabel('Discount for Disprin').fill('5');
  await page.keyboard.press('Enter');

  await expect(cart(page)).toContainText('Rs 5.00');
  await expect(total(page)).toHaveText('Rs 20.00');
  // Focus returns to the row, not to search, after a line-level edit.
  await expect(search(page)).not.toBeFocused();

  await page.keyboard.press('F12');
  await expect(page.getByRole('dialog', { name: 'Payment' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText('20.00');

  // A discount belongs to the line it was entered on; the next sale starts
  // with a fresh cart and nothing carries over.
  await expect(total(page)).toHaveText('Rs 0.00');
});

test('a no-discount receipt: Subtotal equals Amount Due, with no Discount row', async ({
  page,
}) => {
  await openCounter(page);

  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('Rs 35.00');

  await page.keyboard.press('F12');
  await page.keyboard.press('Enter'); // exact tender — no change, no udhaar

  await expect(receipt(page)).toContainText('Subtotal');
  await expect(receipt(page)).toContainText('Amount Due');
  await expect(receipt(page)).not.toContainText('Discount');
  // Both figures are the SAME number: nothing was discounted.
  const text = (await receipt(page).textContent()) ?? '';
  expect(text.match(/35\.00/g)?.length).toBeGreaterThanOrEqual(2);
});

test('a discounted receipt: Subtotal is the pre-discount gross, Discount is the amount taken off, Amount Due is net', async ({
  page,
}) => {
  await openCounter(page);

  // Disprin: Rs 2.50/tab, strip of 10 — one strip is Rs 25.00 gross.
  await search(page).fill('disprin');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('%');
  await page.getByLabel('Discount for Disprin').fill('5');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('Rs 20.00');

  await page.keyboard.press('F12');
  await page.keyboard.press('Enter'); // exact tender against the discounted total

  // This is the bug this guards: before the fix, Subtotal was built from the
  // already-discounted line total, so it read the same as Amount Due (20.00)
  // and the customer had no way to see a discount was ever applied.
  await expect(receipt(page)).toContainText('Subtotal');
  await expect(receipt(page)).toContainText('25.00'); // gross, before the discount
  await expect(receipt(page)).toContainText('Discount');
  await expect(receipt(page)).toContainText('-5.00'); // the amount taken off
  await expect(receipt(page)).toContainText('Amount Due');
  await expect(receipt(page)).toContainText('20.00'); // net — what was actually charged
  // Amount Due must equal Subtotal minus Discount, and the paper never asks
  // the customer to do that arithmetic themselves.
  await expect(receipt(page)).not.toContainText('Change');
});

test('a percentage line discount is computed off that line, not the cart', async ({ page }) => {
  await openCounter(page);

  // Two lines, so a per-line discount touching only one is actually proven.
  await search(page).fill('disprin');
  await page.keyboard.press('Enter');
  await search(page).fill('brufen');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('Disprin');
  await expect(cart(page)).toContainText('Brufen');

  // ArrowUp selects the LAST line added (Brufen); apply 10% there only.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('%');
  await page.getByLabel('Discount for Brufen').fill('10%');
  await page.keyboard.press('Enter');

  await expect(cart(page)).toContainText('Rs 9.00'); // 10% of Rs 90.00
  // Disprin's row must show no discount at all — the empty-state dash in its
  // Discount cell (the row's other "−" is the quantity button, PCN-012).
  const disprinDiscount = cart(page).locator('tr', { hasText: 'Disprin' }).locator('td').nth(3);
  await expect(disprinDiscount).toHaveText('—');
});

test('the Discount column is clickable, no keyboard shortcut required', async ({ page }) => {
  await openCounter(page);

  await search(page).fill('disprin');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('Rs 25.00');

  // A first-time salesman who has never learned '%' can still find the
  // control: the empty cell itself is a button, named for what it does.
  await cart(page).getByRole('button', { name: 'Add a discount on Disprin' }).click();
  await page.getByLabel('Discount for Disprin').fill('10%');
  await page.keyboard.press('Enter');

  await expect(cart(page)).toContainText('Rs 2.50');
  await expect(total(page)).toHaveText('Rs 22.50');

  // Re-opening by clicking the now-filled cell offers the current value
  // pre-selected (auto-select on focus), so typing over it replaces rather
  // than appending — no manual clearing needed.
  await cart(page).getByRole('button', { name: 'Change discount on Disprin' }).click();
  const field = page.getByLabel('Discount for Disprin');
  await expect(field).toHaveValue('2.5');
  await field.pressSequentially('5');
  await page.keyboard.press('Enter');

  await expect(cart(page)).toContainText('Rs 5.00');
  await expect(total(page)).toHaveText('Rs 20.00');
});

test('a re-typed percentage on the same line does not compound', async ({ page }) => {
  await openCounter(page);

  await search(page).fill('disprin');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');

  await page.keyboard.press('%');
  await page.getByLabel('Discount for Disprin').fill('10%');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('Rs 2.50'); // 10% of Rs 25.00

  // Opening the field again and re-entering the SAME "10%" must land on the
  // same Rs 2.50 — not 10% of the already-discounted Rs 22.50. The field is
  // offered back pre-filled with the CURRENT discount ("2.5"), so it is
  // cleared before typing, exactly as an operator retyping the value would.
  await page.keyboard.press('%');
  await page.getByLabel('Discount for Disprin').fill('10%');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('Rs 2.50');
  await expect(total(page)).toHaveText('Rs 22.50');
});

test('a line discount can never exceed that line, and rejects a negative entry', async ({
  page,
}) => {
  await openCounter(page);

  await search(page).fill('disprin');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');

  // Fat-fingering a bigger discount than the line is worth clamps to the
  // line, never a negative total (same posture `cartTotals` already takes).
  await page.keyboard.press('%');
  await page.getByLabel('Discount for Disprin').fill('500');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('Rs 0.00');

  // Junk or a negative entry is zero — never a price ABOVE the catalogue
  // price wearing a discount's clothes.
  await page.keyboard.press('%');
  await page.getByLabel('Discount for Disprin').fill('-5');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('Rs 25.00');
  await expect(cart(page)).toContainText('—');
});

test('Escape cancels an in-progress discount edit without changing anything', async ({ page }) => {
  await openCounter(page);

  await search(page).fill('disprin');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');

  await page.keyboard.press('%');
  await page.getByLabel('Discount for Disprin').fill('10%');
  await page.keyboard.press('Escape');

  await expect(total(page)).toHaveText('Rs 25.00');
  await expect(cart(page)).toContainText('—');

  // The row is still selected and usable — Escape closed the field, not the
  // whole cart line.
  await page.keyboard.press('+');
  await expect(cart(page)).toContainText('2 strip');
});

test('the receipt names whoever is selling, after a PIN switch', async ({ page }) => {
  // The receipt context used to capture the acting user's name once, when the
  // counter opened as the owner, so every receipt for the rest of the session
  // named the owner however many times the PIN switch moved the counter on.
  // The sale itself was always attributed correctly; only the paper was wrong.
  await openCounter(page);

  await page.keyboard.press('F10');
  const overlay = page.getByRole('dialog', { name: 'Switch user' });
  await overlay.getByRole('button', { name: new RegExp(DEMO.salesman.name) }).click();
  await overlay.getByLabel('PIN').fill(DEMO.salesman.pin);
  await overlay.getByRole('button', { name: 'Switch' }).click();
  await expect(overlay).toBeHidden();
  await expect(page.getByRole('button', { name: new RegExp(DEMO.salesman.name) })).toBeVisible();

  await search(page).fill('panadol');
  await expect(page.getByRole('option').first()).toContainText('Panadol');
  await page.keyboard.press('Enter');
  await page.keyboard.press('F12');
  await expect(page.getByRole('dialog', { name: 'Payment' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);

  await expect(receipt(page)).toContainText(DEMO.salesman.name);
});
