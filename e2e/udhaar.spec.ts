import { expect, test, type Page } from '@playwright/test';

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

const DEMO = {
  tenantSlug: 'demo',
  deviceName: 'Counter 1',
  pairingKey: 'counter-one-demo',
};

async function openCounter(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Pharmacy code').fill(DEMO.tenantSlug);
  await page.getByLabel('Counter name').fill(DEMO.deviceName);
  await page.getByLabel('Setup key').fill(DEMO.pairingKey);
  await page.getByRole('button', { name: 'Set up counter' }).click();
  await expect(page).toHaveURL(/\/sale$/);
  await expect(page.getByText(/\d+ products/)).toBeVisible();
}

const search = (page: Page) => page.getByRole('combobox', { name: 'Search products' });
const total = (page: Page) => page.locator('aside p.text-total');
const receipt = (page: Page) => page.locator('#printable-receipt');

test('payment overlay: tendered above the total shows change (Phase 10 §4)', async ({ page }) => {
  await openCounter(page);

  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  // Rs 35.00 for one strip.
  await expect(total(page)).toHaveText('35.00');

  await page.keyboard.press('F12');
  const overlay = page.getByRole('dialog', { name: 'Payment' });
  await expect(overlay).toBeVisible();

  const tendered = overlay.getByLabel('Cash tendered');
  await tendered.fill('100');
  await expect(overlay).toContainText('65.00');

  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Saved');
  await expect(receipt(page)).toContainText('Change');
  await expect(receipt(page)).toContainText('65.00');
});

test('W2: attaching a customer mid-sale splits cash and credit, with a mini-statement on the receipt', async ({
  page,
}) => {
  await openCounter(page);

  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await expect(total(page)).toHaveText('35.00');

  // F8 with items in the cart attaches a customer (defect C5), not Settle Udhaar.
  await page.keyboard.press('F8');
  const picker = page.getByRole('dialog', { name: 'Attach customer' });
  await expect(picker).toBeVisible();

  const name = `Udhaar Customer ${Date.now()}`;
  await picker.getByPlaceholder('Name or phone…').fill(name);
  await picker.getByRole('button', { name: `Add “${name}” as a new customer` }).click();
  await expect(picker).toBeHidden();

  // The right rail shows who the sale is billed to.
  await expect(page.locator('aside')).toContainText(name);

  await page.keyboard.press('F12');
  const overlay = page.getByRole('dialog', { name: 'Payment' });
  await expect(overlay).toContainText(`Billing to ${name}`);

  // Half in cash, the rest goes on the customer's account.
  await overlay.getByLabel('Cash tendered').fill('15');
  await expect(overlay).toContainText('udhaar');

  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Saved');

  // The mini-statement is the dispute-ender (T4/T5): previous → this → new.
  await expect(receipt(page)).toContainText(name);
  await expect(receipt(page)).toContainText('Previous balance');
  await expect(receipt(page)).toContainText('Udhaar (this sale)');
  await expect(receipt(page)).toContainText('New balance');
  await expect(receipt(page)).toContainText('20.00');

  // Attaching a customer does not persist across sales (T1 — each sale states
  // its own attribution); the next one starts unattached.
  await expect(page.locator('aside')).not.toContainText(name);
});

test('credit with nobody attached is blocked at the overlay, not silently discounted', async ({
  page,
}) => {
  await openCounter(page);

  await search(page).fill('panadol');
  await page.keyboard.press('Enter');

  await page.keyboard.press('F12');
  const overlay = page.getByRole('dialog', { name: 'Payment' });

  // Tendering less than the total, with nobody attached, has nowhere to put
  // the shortfall — the overlay says so and will not commit it silently.
  await overlay.getByLabel('Cash tendered').fill('10');
  await expect(overlay).toContainText('Attach a customer (F8) to put the rest on udhaar.');
  await expect(overlay.getByRole('button', { name: /Commit/ })).toBeDisabled();

  await overlay.getByRole('button', { name: 'Esc to cancel' }).click();
  await expect(overlay).toBeHidden();
});

test('W3: F8 on an empty cart opens Settle Udhaar and prints a mini-statement', async ({ page }) => {
  await openCounter(page);

  // The cart is empty — F8 has nothing of its own to do, so it falls back to
  // the global Settle Udhaar overlay (defect C5).
  await page.keyboard.press('F8');
  const picker = page.getByRole('dialog', { name: 'Settle udhaar' });
  await expect(picker).toBeVisible();

  const name = `Settling Customer ${Date.now()}`;
  await picker.getByPlaceholder('Name or phone…').fill(name);
  await picker.getByRole('button', { name: `Add “${name}” as a new customer` }).click();

  const overlay = page.getByRole('dialog', { name: 'Settle udhaar' });
  await expect(overlay).toContainText(name);

  await overlay.getByLabel('Amount paid').fill('50');
  await page.keyboard.press('Enter');

  await expect(overlay).toContainText('Previous balance');
  await expect(overlay).toContainText('New balance');
  // A brand-new customer has no debt yet; paying anyway leaves them in credit
  // — Phase 5 invariant 3 has no floor (W3: overpayment is legal).
  await expect(overlay).toContainText('-50.00');

  await expect(receipt(page)).toContainText(name);
  await expect(receipt(page)).toContainText('Paid');
  await expect(receipt(page)).toContainText(/Receipt A-\d+/);

  await overlay.getByRole('button', { name: 'Done — Esc' }).click();
  await expect(overlay).toBeHidden();

  // Esc returned control to the counter, not to a full page reload.
  await expect(search(page)).toBeVisible();
});
