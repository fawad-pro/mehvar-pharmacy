import { expect, test, type Page } from '@playwright/test';

/**
 * The PWA shell — ADR-3's other half.
 *
 * `offline.spec.ts` proves a *running* counter sells through a disruption. This
 * proves the case the outbox alone cannot cover: a counter that reloads, or is
 * opened cold, while the network is gone.
 *
 * **Only meaningful against a production build.** The worker is registered in
 * production only, deliberately — Next's dev server ships chunks that change on
 * every edit, and a caching worker in that loop serves stale JavaScript. So this
 * spec skips when no worker takes control, exactly as the integration suites
 * skip without a database: green here is not proof, and the real run is
 *
 *     npm run build && npm run start
 *     E2E_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/pwa.spec.ts
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

test('a cold reload with no network still boots a sale screen', async ({ page, context }) => {
  await openCounter(page);

  const controlled = await page
    .waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
      timeout: 10_000,
    })
    .then(() => true)
    .catch(() => false);

  test.skip(!controlled, 'no service worker — this is a development build');

  // A sale captured first, so the reload has something to protect.
  await search(page).fill('panadol');
  await page.keyboard.press('Enter');
  await page.keyboard.press('F12');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: 'Last sale' })).toContainText(/Saved — A-\d+/);

  // The uplink dies and the machine is restarted mid-shift.
  await context.setOffline(true);
  await page.reload();

  // It comes back to a working counter rather than a browser error page.
  await expect(search(page)).toBeVisible({ timeout: 20_000 });

  await context.setOffline(false);
});
