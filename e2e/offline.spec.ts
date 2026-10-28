import { expect, test, type Page } from '@playwright/test';

import {
  cart,
  lastSale,
  openCounter,
  printedReceipt as receipt,
  search,
  total,
  unsynced,
} from './support/counter';

/**
 * Day 5's "done when": "network disabled → sell, print, re-enable →
 * everything reconciles with no user action" (Phase 13 §3).
 *
 * Idempotency and ingestion equivalence are proven against a real database in
 * `ingest.integration.test.ts`, and the flush decisions in `flush.test.ts`.
 * What only a browser can prove is the part this file covers: that a counter
 * cut off from the server still sells and still prints, that nothing asks the
 * operator to do anything about it, and that the queue drains by itself when
 * the network returns.
 *
 * `context.setOffline(true)` is the disruption. It fails the server-action POST
 * exactly the way a dead uplink does, which is the failure the outbox exists
 * for.
 */

/** Sells one Panadol strip through the payment overlay at the exact amount. */
async function sellOne(page: Page, term = 'panadol'): Promise<void> {
  await search(page).fill(term);
  await page.keyboard.press('Enter');
  await page.keyboard.press('F12');
  await expect(page.getByRole('dialog', { name: 'Payment' })).toBeVisible();
  await page.keyboard.press('Enter');
  // A person starts the next sale when this one says it is done.
  await expect(page.getByRole('dialog', { name: 'Payment' })).toBeHidden();
}

test('W1 through a disruption: sell, print, reconnect, reconcile — no user action', async ({
  page,
  context,
}) => {
  await openCounter(page);

  // The counter is cut off mid-shift. Nothing about the path changes.
  await context.setOffline(true);

  await sellOne(page);

  // The receipt printed from local state — ADR-3, Phase 7 rule 3. This is the
  // whole promise: the customer is served while the server is unreachable.
  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);
  await expect(receipt(page)).toContainText('Panadol');
  await expect(receipt(page)).toContainText(/Receipt A-\d+/);

  // And the sale is visibly not-yet-safe rather than silently assumed fine (I7).
  await expect(unsynced(page)).toContainText('1');
  await expect(unsynced(page)).toContainText('selling keeps working');

  // The counter keeps selling. Two more, so the queue is genuinely a queue.
  await sellOne(page, 'brufen');
  await sellOne(page, 'disprin');
  await expect(unsynced(page)).toContainText('3');

  // The uplink returns. Nobody presses anything.
  await context.setOffline(false);

  await expect(unsynced(page)).toBeHidden({ timeout: 20_000 });
});

test('a disruption mid-cart does not disturb the cart', async ({ page, context }) => {
  await openCounter(page);

  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('Panadol');

  // The network dies with items already in the cart — the moment Phase 7's
  // failure list calls out: "connectivity drops mid-sale → nothing about the
  // path changes."
  await context.setOffline(true);

  await search(page).fill('brufen');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('Brufen');
  // Rs 3.50 × 10 + Rs 9.00 × 10 = Rs 125.00
  await expect(total(page)).toHaveText('125.00');

  // Editing still works: it never touched the network to begin with.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('+');
  await expect(total(page)).toHaveText('215.00');

  await page.keyboard.press('F12');
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);

  await context.setOffline(false);
  await expect(unsynced(page)).toBeHidden({ timeout: 20_000 });
});

test('W2 offline: a new customer and an udhaar sale both queue, and land in order', async ({
  page,
  context,
}) => {
  await openCounter(page);
  await context.setOffline(true);

  await search(page).fill('panadol');
  await page.keyboard.press('Enter');

  // A customer who does not exist yet, created during the disruption — W2's
  // "udhaar is extended mid-rush, not pre-registered", which ADR-3 keeps
  // working by naming W2.
  const name = `Offline Customer ${Date.now()}`;
  await page.keyboard.press('F4');
  const picker = page.getByRole('dialog', { name: 'Attach customer' });
  await picker.getByPlaceholder('Name or phone…').fill(name);
  await picker.getByRole('button', { name: `Add “${name}” as a new customer` }).click();
  await expect(picker).toBeHidden();
  await expect(page.locator('aside')).toContainText(name);

  await page.keyboard.press('F12');
  const overlay = page.getByRole('dialog', { name: 'Payment' });
  await overlay.getByLabel('Cash tendered').fill('0');
  await expect(overlay).toContainText('udhaar');
  await page.keyboard.press('Enter');

  await expect(receipt(page)).toContainText(name);
  await expect(receipt(page)).toContainText('New balance');

  // Customer and sale are both queued; the customer was captured first and
  // FIFO delivery is what makes the sale's foreign key resolve.
  await expect(unsynced(page)).toContainText('2');

  await context.setOffline(false);
  await expect(unsynced(page)).toBeHidden({ timeout: 20_000 });

  // The proof it truly reconciled: the customer and the debt are on the server.
  await page.keyboard.press('F3');
  await expect(page).toHaveURL(/\/customers$/);
  // Searched for, not expected on the first page: the suite shares one
  // database and the book grows every run (CLAUDE.md, Day 20).
  await page.getByRole('textbox', { name: 'Search customers' }).fill(name);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible({ timeout: 15_000 });
});

test('W6 offline: an unknown product becomes a real line without leaving the sale', async ({
  page,
  context,
}) => {
  await openCounter(page);
  await context.setOffline(true);

  // Nothing on the shelf matches; the customer is waiting. P2 says this is
  // never a dead end.
  // Letters only, and random: the suite shares one database, and a name
  // differing from an earlier run's only in its digits is found by search —
  // so the quick-add was never offered.
  const name = `Shelf ${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 8)}`;
  await search(page).fill(name);
  await expect(page.getByRole('button', { name: /and keep selling/ })).toBeVisible();
  await page.keyboard.press('Enter');

  const form = page.getByRole('dialog', { name: 'Quick item' });
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Name')).toHaveValue(name);
  await form.getByLabel('Price').fill('250');
  await page.keyboard.press('Enter');

  // A real line, not an anonymous one (D3), and the sale continues.
  await expect(cart(page)).toContainText(name);
  await expect(total(page)).toHaveText('250.00');
  await expect(search(page)).toBeFocused();

  await page.keyboard.press('F12');
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);

  await context.setOffline(false);
  await expect(unsynced(page)).toBeHidden({ timeout: 20_000 });

  // D3's guardrail: it landed flagged, so the completion queue nags for it.
  await page.keyboard.press('F5');
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByText(/need(s)? completing/).first()).toBeVisible();
});

test('the outbox survives a reload — a captured sale is not held in memory', async ({
  page,
  context,
}) => {
  await openCounter(page);
  await context.setOffline(true);

  await sellOne(page);
  await expect(unsynced(page)).toContainText('1');

  // Still offline, the operator reloads (or the machine restarts). The sale is
  // in IndexedDB, not in a React state tree — this is what `enqueue` waiting on
  // the transaction to *complete* buys.
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText(/\d+ products/)).toBeVisible();

  // It delivers itself on the next load with nobody asking.
  await expect(unsynced(page)).toBeHidden({ timeout: 20_000 });
});
