import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { cart, openCounter, printedReceipt, search } from './support/counter';

/**
 * PCN-005's promise, made executable.
 *
 * The ladder is covered as arithmetic by `state.test.ts` and against a real
 * database by `licence-queries.integration.test.ts`. What only a browser can
 * prove is the part the decision actually turns on: that a pharmacy whose
 * licence has lapsed still sells, still prints, and can still take its data —
 * while the things off the sale path say so in plain words.
 *
 * The lapse is induced through the product's own door: the Settings panel,
 * with a token whose entitlement is already behind us. No fixture reaches into
 * the database to fake a state the product cannot reach on its own.
 */

/**
 * A licence for the demo pharmacy that ran out a year ago.
 *
 * Minted by shelling out to the real `licence:issue`, rather than importing the
 * signing modules into the Playwright runtime — which cannot resolve the `@/`
 * alias, and which would in any case be a second signing path that could drift
 * from the one the founder actually runs. A back-dated term is ordinary
 * arithmetic on the same command.
 */
/**
 * One licence id for every token this spec mints.
 *
 * Invariant L2 supersedes WITHIN a licence id by `issuedAt`, and across ids by
 * greatest entitlement — so an unrelated older token can never shorten a
 * customer who paid longer. That is correct product behaviour and it is why
 * this spec cannot lapse the pharmacy with a fresh id: on the second run the
 * previous run's renewal would still win.
 *
 * Sharing one id is also what a real downgrade looks like (a customer moving
 * from annual to monthly), so the spec exercises the path rather than working
 * around it, and stays re-runnable against the suite's shared database.
 */
const E2E_LICENCE_ID = '0e2e0e2e-0000-7000-8000-00000000e2e5';

function issueToken(months: number, name: string): string {
  const output = execFileSync(
    'npx',
    [
      'tsx',
      'scripts/licence/issue.ts',
      '--slug',
      'demo',
      '--name',
      name,
      '--months',
      String(months),
      '--licence-id',
      E2E_LICENCE_ID,
    ],
    { cwd: join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );

  const token = output.split('\n').find((line) => line.startsWith('MEHVAR1.'));
  if (token === undefined) throw new Error('licence:issue printed no token');
  return token.trim();
}

test('a lapsed licence stops restocking, and nothing else', async ({ page }) => {
  await openCounter(page);

  // --- Lapse it, through the product's own door. --------------------------
  // Nothing is assumed about the licence state this run starts in. `licences`
  // is append-only and the suite shares one database, so a previous run's rows
  // are still there — a spec that assumed a pristine state would pass once and
  // fail every time after. Installing the lapse outright is idempotent.
  //
  // No fixture reaches into the database to fake a state the product cannot
  // reach on its own.
  await page.goto('/settings');
  await page.getByPlaceholder('MEHVAR1.').fill(issueToken(-13, 'Lapsed Test Pharmacy'));
  await page.getByRole('button', { name: 'Install licence' }).click();
  await expect(page.getByText('Licence installed.')).toBeVisible();

  // The panel names what is paused, and what is not. Two elements say it — the
  // banner and the panel — so this asserts both deliberately rather than
  // picking one and hoping.
  await expect(page.getByText('Paused until renewed:')).toHaveCount(2);
  await expect(page.getByText(/receiving stock/).first()).toBeVisible();
  await expect(
    page.getByText('Selling, printing receipts and exporting your data always keep working.'),
  ).toBeVisible();

  // --- Selling is untouched. P2, and the whole point of the ladder. --------
  await page.goto('/sale');
  await expect(page.getByRole('note', { name: 'Licence' })).toBeVisible();

  await search(page).fill('panadol');
  await expect(page.getByRole('option').first()).toContainText('Panadol');
  await page.keyboard.press('Enter');
  await expect(cart(page)).toContainText('Panadol');

  await page.keyboard.press('F12');
  await page.keyboard.press('Enter');

  // A receipt in hand — T5, printed from local state, never from a licence check.
  await expect(printedReceipt(page)).toContainText('Panadol', { timeout: 15_000 });

  // --- Export is open. T3, and Phase 3 §3 in so many words. ---------------
  const exported = await page.request.get('/api/export');
  expect(exported.status()).toBe(200);
  expect(exported.headers()['content-type']).toContain('zip');

  // --- Renewing brings everything back. -----------------------------------
  // This also leaves the shared database healthy for every other spec, which
  // matters because `licences` is append-only — a lapsed row left behind could
  // not be deleted by the application afterwards.
  await page.goto('/settings');
  await page.getByPlaceholder('MEHVAR1.').fill(issueToken(12, 'Demo Pharmacy'));
  await page.getByRole('button', { name: 'Install licence' }).click();
  await expect(page.getByText('Licence installed.')).toBeVisible();

  await expect(page.getByText('Paused until renewed:')).toHaveCount(0);

  // A healthy licence shows no banner at all: a banner that is always there is
  // furniture, and furniture does not get read.
  await page.goto('/sale');
  await expect(page.getByRole('note', { name: 'Licence' })).toHaveCount(0);
});
