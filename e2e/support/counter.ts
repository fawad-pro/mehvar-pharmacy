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
  await expect(page.getByText(/\d+ products/)).toBeVisible();
  await expect(page.getByText('Getting this counter ready…')).toBeHidden();
}

export const search = (page: Page) => page.getByRole('combobox', { name: 'Search products' });
export const cart = (page: Page) => page.getByRole('table');
export const total = (page: Page) => page.locator('aside p.text-total');
export const printedReceipt = (page: Page) => page.locator('#printable-receipt');
export const lastSale = (page: Page) => page.getByRole('status', { name: 'Last sale' });
export const unsynced = (page: Page) => page.getByRole('status', { name: /waiting to sync/ });
