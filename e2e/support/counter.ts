import { expect, type Page } from '@playwright/test';

/**
 * Shared E2E support — one device setup, one set of locators.
 *
 * These were copy-pasted into five spec files, which meant a change to the
 * shell had to be made five times and a setup failure reported itself five
 * different ways. More importantly it meant the *diagnosis* lived nowhere: a
 * device that could not pair failed as "expected /sale, got /login", hiding
 * the perfectly good sentence the login screen had already rendered.
 */

/**
 * How long the counter gets to become ready.
 *
 * Startup is a one-time cost — route compilation on a dev server, the catalog
 * fetch, the receipt context — and it is not what any spec is measuring. Speed
 * budgets belong to the interactions the specs actually assert (I2), not here.
 */
const STARTUP_TIMEOUT_MS = 45_000;

export const DEMO = {
  tenantSlug: 'demo',
  deviceName: 'Counter 1',
  pairingKey: 'counter-one-demo',
  owner: 'Fawad',
  salesman: { name: 'Bilal', pin: '2345' },
};

/**
 * Pairs this browser context with the demo counter.
 *
 * When pairing fails the app redirects to `/login?error=<reason>` and renders
 * the reason (I5). This reads both and fails with them, because every one of
 * those reasons is an environment problem the runner can act on — almost always
 * a database that has not been seeded:
 *
 *     npm run e2e:reset
 */
export async function openCounter(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Pharmacy code').fill(DEMO.tenantSlug);
  await page.getByLabel('Counter name').fill(DEMO.deviceName);
  await page.getByLabel('Setup key').fill(DEMO.pairingKey);
  await page.getByRole('button', { name: 'Set up counter' }).click();

  // Both outcomes, and neither is the state we start in — the form is served
  // from a bare `/login`, so waiting for "/sale or /login" would match before
  // the click had gone anywhere.
  await page.waitForURL(
    (url) => /\/sale$/.test(url.pathname) || url.searchParams.has('error'),
    { timeout: 30_000 },
  );

  if (!/\/sale$/.test(new URL(page.url()).pathname)) {
    const reason = new URL(page.url()).searchParams.get('error') ?? 'unknown';
    const shown = await page
      .getByRole('alert')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      [
        `Device setup failed: ${reason}.`,
        shown ? `The screen said: “${shown.trim()}”` : null,
        reason === 'unknown_device'
          ? 'The demo pharmacy or its counter is missing — the database needs seeding. Run `npm run e2e:reset`.'
          : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  // Two separate things have to arrive before this counter can complete a sale,
  // and waiting for only the first is how a test ends up racing the second:
  // the catalog index (so a keystroke can match), and the receipt context (so a
  // sale can be numbered). The surface says while it is still getting ready, so
  // that notice going away is the honest signal for "ready to sell".
  //
  // Both get a deliberately long deadline. The default five seconds is the
  // right question to ask of an interaction — "did the screen answer the
  // keystroke?" — and the wrong one to ask of startup, where a dev server may
  // still be compiling the route and its client bundle. Getting that wrong
  // reported a perfectly healthy application as seventeen failures.
  await expect(page.getByText(/\d+ products/)).toBeVisible({ timeout: STARTUP_TIMEOUT_MS });
  await expect(page.getByText('Getting this counter ready…')).toBeHidden({
    timeout: STARTUP_TIMEOUT_MS,
  });
}

/**
 * The product search on every screen that has one. Sale's is labelled on
 * screen, "Search or scan" (PCN-016); the screens not yet redrawn keep the
 * screen-reader name "Search products" until their own batch.
 */
export const search = (page: Page) =>
  page.getByRole('combobox', { name: /^Search (or scan|products)$/ });
export const cart = (page: Page) => page.getByRole('table');
export const total = (page: Page) => page.locator('aside p.text-total');
export const printedReceipt = (page: Page) => page.locator('#printable-receipt');
export const lastSale = (page: Page) => page.getByRole('status', { name: 'Last sale' });
export const unsynced = (page: Page) => page.getByRole('status', { name: /waiting to sync/ });

/**
 * Pays the cart (F12, Enter) and waits until the sale has synced and the
 * screen has re-rendered for it. Returns the "Saved — …" text.
 *
 * The wait is about the test, not the product: when the pump delivers a sale,
 * `RefreshOnSync` refreshes the server components, and Next holds a function
 * key's navigation until that refresh lands. A spec that presses a key inside
 * that window measures the refresh, not the key. Known product risk: on a slow
 * server the keys feel dead for as long as the refresh takes.
 */
export async function payAndSettle(page: Page): Promise<string | null> {
  const refreshed = page.waitForResponse((response) => /\/sale\?_rsc=/.test(response.url()), {
    timeout: 30_000,
  });
  await page.keyboard.press('F12');
  await page.keyboard.press('Enter');
  await expect(lastSale(page)).toContainText(/Saved — /);
  const saved = await lastSale(page).textContent();
  await expect(unsynced(page)).toHaveCount(0, { timeout: 30_000 });
  await (await refreshed).finished();
  return saved;
}
