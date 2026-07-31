import { expect, test } from '@playwright/test';

import { lastSale, openCounter, search } from './support/counter';

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
  await expect(lastSale(page)).toContainText(/Saved — A-\d+/);

  // The uplink dies and the machine is restarted mid-shift.
  await context.setOffline(true);
  await page.reload();

  // It comes back to a working counter rather than a browser error page.
  await expect(search(page)).toBeVisible({ timeout: 20_000 });

  await context.setOffline(false);
});
