import { expect, test } from '@playwright/test';

import { DEMO, openCounter as setUpCounter } from './support/counter';

/**
 * Day 1's "done when": `db:reset && db:migrate && db:seed` yields a logged-in
 * shell with a switchable user (Phase 13 §3).
 *
 * This is not the W1 keyboard path — that is Session 8's single E2E test (Phase
 * 11 §3.5). This one asserts the foundation the whole week stands on: device
 * login, the shell's furniture, and a PIN switch that actually changes who is
 * acting.
 */

test('device login, shell furniture, and PIN switch', async ({ page }) => {
  await setUpCounter(page);

  // Sale is home, and focus lives in search (Phase 10 §1, Phase 7 rule 1).
  await expect(page.getByRole('combobox', { name: 'Search products' })).toBeFocused();

  // The key bar is furniture, and it prints the whole map (I1, Phase 10 §3).
  const keyBar = page.getByRole('navigation', { name: 'Function keys' });
  for (const key of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']) {
    await expect(keyBar.getByText(key, { exact: true })).toBeVisible();
  }

  // A fresh device acts as the owner until someone identifies themselves.
  await expect(page.getByRole('button', { name: new RegExp(DEMO.owner) })).toBeVisible();

  // F2 reaches Purchases without the mouse.
  await page.keyboard.press('F7');
  await expect(page).toHaveURL(/\/purchases$/);

  // Esc returns to Sale.
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/sale$/);

  // F10 opens the PIN switch — ADR-7's central interaction.
  await page.keyboard.press('F10');
  const overlay = page.getByRole('dialog', { name: 'Switch user' });
  await expect(overlay).toBeVisible();

  await overlay.getByRole('button', { name: new RegExp(DEMO.salesman.name) }).click();
  await overlay.getByLabel('PIN').fill(DEMO.salesman.pin);
  await overlay.getByRole('button', { name: 'Switch' }).click();

  // Attribution has moved: every record from here on carries Bilal (T1).
  await expect(overlay).toBeHidden();
  await expect(page.getByRole('button', { name: new RegExp(DEMO.salesman.name) })).toBeVisible();

  // A salesman has no report access beyond the current day (Phase 5 §2), so F9
  // is dimmed — visible but not permitted. The map stays put either way.
  await expect(keyBar.getByText('F9', { exact: true })).toBeVisible();
});

test('a wrong PIN says what to do next, without blame (I5)', async ({ page }) => {
  // A fresh browser context carries no session cookie; every counter starts at
  // setup, which is itself worth re-asserting.
  await setUpCounter(page);
  await page.keyboard.press('F10');

  const overlay = page.getByRole('dialog', { name: 'Switch user' });
  await overlay.getByRole('button', { name: new RegExp(DEMO.salesman.name) }).click();
  await overlay.getByLabel('PIN').fill('9999');
  await overlay.getByRole('button', { name: 'Switch' }).click();

  await expect(overlay.getByRole('alert')).toHaveText('That PIN is not right. Try again.');

  // Then get it right, which is what actually happens at a counter — and which
  // clears the failed-attempt counter (Phase 12 §5). Without this the suite
  // leaves a real lockout behind: five runs against one database and Bilal is
  // locked out for five minutes, breaking the switch test above for reasons
  // that have nothing to do with the code under test.
  await overlay.getByLabel('PIN').fill(DEMO.salesman.pin);
  await overlay.getByRole('button', { name: 'Switch' }).click();
  await expect(overlay).toBeHidden();
});

test('on a short screen the names scroll and Switch stays in reach', async ({ page }) => {
  // A shop with many users, or a small counter screen: the same overflow. The
  // shared database once held fourteen users and the Switch button sat below
  // the bottom of the screen, unclickable.
  await setUpCounter(page);
  await page.setViewportSize({ width: 1024, height: 300 });
  await page.keyboard.press('F10');

  const overlay = page.getByRole('dialog', { name: 'Switch user' });
  await expect(overlay.getByRole('button', { name: 'Switch' })).toBeInViewport({ ratio: 1 });
  await expect(overlay.getByLabel('PIN')).toBeInViewport({ ratio: 1 });

  const salesman = overlay.getByRole('button', { name: new RegExp(DEMO.salesman.name) });
  await salesman.scrollIntoViewIfNeeded();
  await salesman.click();
  await overlay.getByLabel('PIN').fill(DEMO.salesman.pin);
  await overlay.getByRole('button', { name: 'Switch' }).click();
  await expect(overlay).toBeHidden();
});
