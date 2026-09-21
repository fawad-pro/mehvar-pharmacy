import { expect, test } from '@playwright/test';

import { cart, lastSale, openCounter, search, total } from './support/counter';

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
  await expect(total(page)).toHaveText('305.00');

  // F12 opens the payment overlay; Enter commits the exact tendered amount
  // (Phase 10 §4's default).
  await page.keyboard.press('F12');
  await expect(page.getByRole('dialog', { name: 'Payment' })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);
  await expect(lastSale(page)).toContainText('305.00');

  // The cart clears and focus returns for the next customer (W1).
  await expect(total(page)).toHaveText('0.00');
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
  await expect(total(page)).toHaveText('70.00');

  // Tab cycles the unit level and re-expresses the same count at the new one.
  await page.keyboard.press('Tab');
  await expect(cart(page)).toContainText('2 box');

  // − steps back down, and taking it to zero removes the line.
  await page.keyboard.press('-');
  await expect(cart(page)).toContainText('1 box');
  await page.keyboard.press('-');
  await expect(page.getByText('Search above to start a sale.')).toBeVisible();
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
  await expect(cart(page)).toContainText(/more than in stock|not in stock/);

  await page.keyboard.press('F12');
  await page.keyboard.press('Enter');

  // The sale is not refused; the shortfall is surfaced (D2).
  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);
  await expect(lastSale(page)).toContainText('Sold more than the system had');
});

test('receipt numbers advance per device and never repeat', async ({ page }) => {
  await openCounter(page);

  const numbers: string[] = [];
  for (let sale = 0; sale < 3; sale += 1) {
    await search(page).fill('disprin');
    await page.keyboard.press('Enter');
    await page.keyboard.press('F12');
    await page.keyboard.press('Enter');

    const text = (await lastSale(page).textContent()) ?? '';
    const match = /A-(\d+)/.exec(text);
    expect(match, 'a receipt number was issued').not.toBeNull();
    numbers.push(match![1]!);
    await expect(total(page)).toHaveText('0.00');
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
  await expect(page.getByRole('option').first()).toContainText(/On hand: -?\d+/);
});

test('a fixed PKR discount reduces the total and shows in the totals rail', async ({ page }) => {
  await openCounter(page);

  // Disprin: Rs 2.50/tab, strip of 10 — one strip is Rs 25.00 (a round number
  // that makes the arithmetic in this test readable).
  await search(page).fill('disprin');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('25.00');

  await page.getByLabel('Discount').fill('5');
  await expect(page.getByText('Discount −5.00')).toBeVisible();
  await expect(total(page)).toHaveText('20.00');

  await page.keyboard.press('F12');
  await expect(page.getByRole('dialog', { name: 'Payment' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText('20.00');

  // A discount belongs to the sale it was entered for, not the next customer.
  await expect(page.getByLabel('Discount')).toHaveValue('');
  await expect(total(page)).toHaveText('0.00');
});

test('a percentage discount is computed off the subtotal', async ({ page }) => {
  await openCounter(page);

  await search(page).fill('disprin');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('25.00');

  await page.getByLabel('Discount').fill('10%');
  await expect(page.getByText('Discount −2.50')).toBeVisible();
  await expect(total(page)).toHaveText('22.50');
});

test('a discount can never exceed the cart, and never raises the price', async ({ page }) => {
  await openCounter(page);

  await search(page).fill('disprin');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('25.00');

  // Fat-fingering a bigger discount than the cart is worth clamps to the cart,
  // never a negative total (same posture `cartTotals` already takes).
  await page.getByLabel('Discount').fill('500');
  await expect(total(page)).toHaveText('0.00');

  // Junk or a negative entry is zero — never a price ABOVE the catalogue price
  // wearing a discount's clothes.
  await page.getByLabel('Discount').fill('-5');
  await expect(total(page)).toHaveText('25.00');
});
