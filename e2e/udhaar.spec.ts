import { expect, test } from '@playwright/test';

import { lastSale, openCounter, printedReceipt as receipt, search, total } from './support/counter';

/**
 * Day 4's "done when": "W1, W2, W3 complete end-to-end on real hardware with a
 * printed receipt in hand" (Phase 13 §3).
 *
 * The transaction semantics are covered against a real database by
 * `commit-sale.integration.test.ts` and `commit-settlement.integration.test.ts`,
 * and the arithmetic by the rebuild-equivalence suite. What this file proves is
 * the part only a browser can: the payment overlay, the F8 contextual switch
 * (defect C5), and the printed receipt's mini-statement, all by keyboard.
 *
 * The receipt is asserted by reading `#printable-receipt`'s text content
 * directly — it stays in the DOM (`display: none` outside `@media print`, see
 * `globals.css`), and `textContent` does not care about CSS visibility, so
 * there is no need to actually trigger the browser's print engine to prove the
 * receipt was assembled correctly.
 */

test('tendered above the total shows change (Phase 10 §4)', async ({ page }) => {
  await openCounter(page);

  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  // Rs 35.00 for one strip.
  await expect(total(page)).toHaveText('Rs 35.00');

  const received = page.getByLabel('Cash received');
  await received.fill('100');
  await expect(page.locator('aside')).toContainText('65.00');

  await page.keyboard.press('F12');
  await expect(lastSale(page)).toContainText('Saved');

  // The change calculation is the payment screen's job (already proven above,
  // before commit); the printed slip states what was handed over and stops
  // there, so the customer never has to do the subtraction off a receipt.
  await expect(receipt(page)).toContainText('Paid');
  await expect(receipt(page)).toContainText('100.00');
  await expect(receipt(page)).not.toContainText('Change');
});

test('W2: attaching a customer mid-sale splits cash and credit, with a mini-statement on the receipt', async ({
  page,
}) => {
  await openCounter(page);

  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('Rs 35.00');

  // F8 with items in the cart attaches a customer (defect C5), not Settle Udhaar.
  await page.keyboard.press('F4');
  const picker = page.getByRole('dialog', { name: 'Attach a customer' });
  await expect(picker).toBeVisible();

  const name = `Udhaar Customer ${Date.now()}`;
  await picker.getByPlaceholder('Name or phone…').fill(name);
  await picker.getByRole('button', { name: `Add “${name}” as a new customer` }).click();
  await expect(picker).toBeHidden();

  // The right rail shows who the sale is billed to.
  await expect(page.locator('aside')).toContainText(name);

  await expect(page.locator('aside')).toContainText(name);

  // Half in cash, the rest goes on the customer's account.
  await page.getByLabel('Cash received').fill('15');
  await expect(page.locator('aside')).toContainText('udhaar');

  await page.keyboard.press('F12');
  await expect(lastSale(page)).toContainText('Saved');
  // And the confirmation says where the money went.
  await expect(lastSale(page)).toContainText(`Rs 15.00 cash · Rs 20.00 on ${name}’s udhaar`);

  // The mini-statement is the dispute-ender (T4/T5): previous → this → new.
  await expect(receipt(page)).toContainText(name);
  await expect(receipt(page)).toContainText('Previous balance');
  await expect(receipt(page)).toContainText('Udhaar (this sale)');
  await expect(receipt(page)).toContainText('New balance');
  await expect(receipt(page)).toContainText('20.00');

  // Attaching a customer does not persist across sales (T1 — each sale states
  // its own attribution); the next one starts unattached: no customer block,
  // whose control is "remove". The last sale's own line still names who it
  // went to, which is the point of it.
  await expect(
    page.locator('aside').getByRole('button', { name: 'Remove customer from this sale' }),
  ).toHaveCount(0);
});

test('remaining is computed the instant cash received falls short — no separate calculator', async ({
  page,
}) => {
  await openCounter(page);

  // Brufen: Rs 9.00/tab, strip of 10 — one strip is Rs 90.00 (Amount Due).
  await search(page).fill('brufen');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('Rs 90.00');

  // Amount Due Rs 90.00, received Rs 50.00 → Remaining Rs 40.00, shown the
  // moment the figure is typed — before any customer is attached, before
  // anything is committed.
  await page.getByLabel('Cash received').fill('50');
  await expect(page.locator('aside')).toContainText('Remaining');
  await expect(page.locator('aside')).toContainText('40.00');
  await expect(page.locator('aside')).not.toContainText('Change');
});

test('credit with nobody attached is blocked, not silently discounted', async ({
  page,
}) => {
  await openCounter(page);

  await search(page).fill('panadol');
  await page.keyboard.press('Enter');

  // Receiving less than the total, with nobody attached, has nowhere to put
  // the shortfall — the screen says so and will not commit it silently.
  await page.getByLabel('Cash received').fill('10');
  await expect(page.locator('aside')).toContainText('Attach a customer (F4) to put the rest on udhaar.');
  await expect(page.getByRole('button', { name: /^Pay/ })).toBeDisabled();
});

test('W3: F8 on an empty cart opens Settle Udhaar and prints a mini-statement', async ({
  page,
}) => {
  await openCounter(page);

  // The cart is empty — F8 has nothing of its own to do, so it falls back to
  // the global Settle Udhaar overlay (defect C5).
  await page.keyboard.press('F4');
  const picker = page.getByRole('dialog', { name: 'Settle udhaar' });
  await expect(picker).toBeVisible();

  const name = `Settling Customer ${Date.now()}`;
  await picker.getByPlaceholder('Name or phone…').fill(name);
  await picker.getByRole('button', { name: `Add “${name}” as a new customer` }).click();

  const overlay = page.getByRole('dialog', { name: 'Settle udhaar' });
  await expect(overlay).toContainText(name);

  await overlay.getByLabel('Amount paid').fill('50');

  /*
   * Said BEFORE it is committed, not after.
   *
   * Overpaying is legal and is recorded exactly as asked, but unannounced it
   * produced the single most confusing thing in the product: a balance that
   * appeared to move the wrong way after a payment. The rule is "never
   * surprise", not "never allow".
   */
  await expect(overlay).toContainText('is kept as an advance');
  await expect(overlay).toContainText('is kept as an advance');

  await page.keyboard.press('Enter');

  // The slip speaks the position vocabulary: a balance is never a signed
  // number with a minus sign, so "Previous/New balance" became "Before/Now".
  await expect(overlay).toContainText(', before');
  await expect(overlay).toContainText('Now');
  /*
   * A brand-new customer has no debt yet; paying anyway leaves them in credit.
   * Overpayment is legal (W3 caps nothing) and the derivation still has no
   * floor — Phase 5 invariant 3 is unchanged.
   *
   * What changed is how it is SAID. This used to assert "-50.00", and a
   * balance rendered with a minus sign is exactly the thing that made the
   * udhaar screens unreadable: "TOTAL OWED TO YOU -Rs 100.00" reads as the
   * software having lost track of the money. The direction is now a word and
   * the amount is always positive.
   */
  await expect(overlay).toContainText('Advance Rs 50.00');
  await expect(overlay).toContainText('50.00');
  await expect(overlay).not.toContainText('-50.00');

  await expect(receipt(page)).toContainText(name);
  await expect(receipt(page)).toContainText('Paid');
  await expect(receipt(page)).toContainText(/Receipt A-\d+/);
  // And the paper says it the same way: the customer takes this home.
  await expect(receipt(page)).toContainText('New balance50.00 advance');
  await expect(receipt(page)).not.toContainText(/-[\d,]+\.\d{2}/);

  await overlay.getByRole('button', { name: /^Done/ }).click();
  await expect(overlay).toBeHidden();

  // Esc returned control to the counter, not to a full page reload.
  await expect(search(page)).toBeVisible();
});

test('W4: returning an udhaar sale prints a refund slip that reduces udhaar, never "Paid"', async ({
  page,
}) => {
  await openCounter(page);
  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await page.keyboard.press('F4');
  const picker = page.getByRole('dialog', { name: 'Attach a customer' });
  const name = `Return Customer ${Date.now()}`;
  await picker.getByPlaceholder('Name or phone…').fill(name);
  await picker.getByRole('button', { name: `Add “${name}” as a new customer` }).click();
  await expect(picker).toBeHidden();
  await page.locator('#cash-received').fill('0');
  await page.keyboard.press('F12');
  const saved = await lastSale(page).textContent();
  const receiptNumber = saved?.match(/Saved — ([A-Za-z]+-\d+)/)?.[1] ?? '';
  expect(receiptNumber).toBeTruthy();

  await page.goto(`/returns?receipt=${receiptNumber}`);
  await expect(page.getByRole('table')).toContainText('Panadol', { timeout: 30_000 });
  await page.getByLabel(/Return quantity for Panadol/).fill('1');
  await page
    .getByRole('group', { name: 'Refund method' })
    .getByRole('button', { name: 'Reduce credit' })
    .click();
  await page.getByRole('button', { name: 'Confirm return' }).click();
  await expect(page.getByRole('status')).toContainText('Returned');

  await expect(receipt(page)).toContainText(`RETURN — against receipt ${receiptNumber}`);
  await expect(receipt(page)).toContainText('Refund');
  await expect(receipt(page)).toContainText('Udhaar reduced');
  await expect(receipt(page)).toContainText('Returned');
  await expect(receipt(page)).not.toContainText('Amount Due');
  await expect(receipt(page)).not.toContainText(/\bPaid\b/);
  await expect(receipt(page)).not.toContainText(/-[\d,]+\.\d{2}/);
});
