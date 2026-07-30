import { expect, test, type Page } from '@playwright/test';

/**
 * Day 1's "done when": `db:reset && db:migrate && db:seed` yields a logged-in
 * shell with a switchable user (Phase 13 §3).
 *
 * This is not the W1 keyboard path — that is Session 8's single E2E test (Phase
 * 11 §3.5). This one asserts the foundation the whole week stands on: device
 * login, the shell's furniture, and a PIN switch that actually changes who is
 * acting.
 */

const DEMO = {
  tenantSlug: 'demo',
  deviceName: 'Counter 1',
  pairingKey: 'counter-one-demo',
  owner: 'Fawad',
  salesman: { name: 'Bilal', pin: '2345' },
};

/** Pairs this browser context with the demo counter. */
async function setUpCounter(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Pharmacy code').fill(DEMO.tenantSlug);
  await page.getByLabel('Counter name').fill(DEMO.deviceName);
  await page.getByLabel('Setup key').fill(DEMO.pairingKey);
  await page.getByRole('button', { name: 'Set up counter' }).click();
  await expect(page).toHaveURL(/\/sale$/);
}

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
  await page.keyboard.press('F2');
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

  // A salesman has no report access beyond the current day (Phase 5 §2), so F5
  // is dimmed — visible but not permitted. The map stays put either way.
  await expect(keyBar.getByText('F5', { exact: true })).toBeVisible();
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
});
