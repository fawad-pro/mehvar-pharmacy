import { expect, test, type Page } from '@playwright/test';

import { openCounter } from './support/counter';

/**
 * A request that gets no answer says so.
 *
 * Seen on a pilot machine: Settings opened while its requests failed, and each
 * section sat on "Loading…" for good — Save did nothing, and the user list
 * looked like a shop with no users. The browser's only trace was an
 * unhandled "Failed to fetch".
 *
 * Server actions are POSTs carrying a `next-action` header; aborting exactly
 * those is the failure the pilot saw, with the page itself still served.
 */

/**
 * Cuts server actions until the returned function is called. A switch, not
 * `unroute`: a request reaching the handler while it was being removed was
 * left open for good, and Next sends actions one at a time, so every later
 * one queued behind it.
 */
async function cutServerActions(page: Page): Promise<() => void> {
  let cut = true;
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (cut && request.method() === 'POST' && request.headers()['next-action']) {
      await route.abort('failed');
    } else {
      await route.fallback();
    }
  });
  return () => {
    cut = false;
  };
}

test('Settings: a section that cannot load says so, and Try again loads it', async ({ page }) => {
  await openCounter(page);
  const restore = await cutServerActions(page);
  await page.goto('/settings');

  for (const what of [
    'The receipt settings',
    'The selling settings',
    'The list of users',
    'The licence',
  ]) {
    await expect(page.getByRole('alert').filter({ hasText: `${what} did not load` })).toBeVisible({
      timeout: 30_000,
    });
  }

  restore();
  const selling = page.getByRole('alert').filter({ hasText: 'The selling settings did not load' });
  await selling.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Discount limit without the owner (%)')).not.toHaveValue('');
  const users = page.getByRole('alert').filter({ hasText: 'The list of users did not load' });
  await users.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('owner', { exact: true }).first()).toBeVisible();
});

test('Settings: a save with no answer says it did not save, and Save works again', async ({
  page,
}) => {
  await openCounter(page);
  await page.goto('/settings');
  const field = page.getByLabel('Discount limit without the owner (%)');
  await expect(field).not.toHaveValue('', { timeout: 30_000 });
  const saved = await field.inputValue();

  const restore = await cutServerActions(page);
  await page.getByRole('button', { name: 'Save selling setting' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'That did not save' })).toBeVisible();
  // Not left saying "Saving…" with the button dead.
  await expect(page.getByRole('button', { name: 'Save selling setting' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Save selling setting' })).toHaveText('Save');

  restore();
  await page.getByRole('button', { name: 'Save selling setting' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  // Nothing changed: the value saved is the one that was there.
  await page.reload();
  await expect(page.getByLabel('Discount limit without the owner (%)')).toHaveValue(saved, {
    timeout: 30_000,
  });
});

test('Returns: a search with no answer is not "No sales found"', async ({ page }) => {
  await openCounter(page);
  const restore = await cutServerActions(page);
  await page.goto('/returns');
  const failed = page.getByRole('alert').filter({ hasText: 'The sales did not load' });
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('No sales found.')).toHaveCount(0);

  restore();
  await failed.getByRole('button', { name: 'Try again' }).click();
  await expect(failed).toHaveCount(0);
});

test('Add product: a catalogue search with no answer says so, not "nothing matches"', async ({
  page,
}) => {
  await openCounter(page);
  await page.goto('/products/new');
  const field = page.getByLabel('Which medicine?');
  await expect(field).toBeVisible({ timeout: 30_000 });
  await cutServerActions(page);
  await field.fill('panadol');
  await expect(
    page.getByRole('alert').filter({ hasText: 'The catalogue did not answer' }),
  ).toBeVisible();
  await expect(page.getByText(/Nothing in the catalogue matches/)).toHaveCount(0);
});

test('a correction with no answer says it did not save, and leaves the record as it was', async ({
  page,
}) => {
  await openCounter(page);
  await page.goto('/customers?q=Rashid');
  await page.getByRole('link', { name: 'Rashid Sahib' }).first().click({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Rashid Sahib' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Edit name or phone' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Rashid Sahib (not saved)');

  await cutServerActions(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'That did not save' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();

  // Exact: the ledger's "Cancel entry" buttons are also called Cancel…
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Rashid Sahib' })).toBeVisible({
    timeout: 30_000,
  });
});
