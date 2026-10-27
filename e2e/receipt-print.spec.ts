import { expect, test } from '@playwright/test';

import { DEMO, openCounter, printedReceipt } from './support/counter';

/**
 * The receipt as the print engine sees it — ADR-6, Phase 10 §7.
 *
 * Measured in print media, because the receipt is `display: none` on screen.
 * 1 mm = 96 / 25.4 CSS px, so 72 mm is about 272 px and 50 mm about 189 px.
 * What paper actually does is a hardware check; this pins what the page asks
 * the printer for: the printable width, solid black, readable sizes.
 */

const MM = 96 / 25.4;

test('the receipt prints at the 80 mm roll’s printable width, in solid black', async ({ page }) => {
  await openCounter(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Print test receipt' }).click({ timeout: 30_000 });
  await page.emulateMedia({ media: 'print' });

  const receipt = printedReceipt(page);
  await expect(receipt).toBeVisible();

  const box = await receipt.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(71 * MM);
  expect(box?.width ?? 0).toBeLessThan(73 * MM);

  // Every piece of text is pure black: grey reaches a thermal driver as dots.
  const colours = await receipt.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('*')]
      .filter((el) => (el.textContent ?? '').trim() !== '')
      .map((el) => getComputedStyle(el).color),
  );
  expect(new Set(colours)).toEqual(new Set(['rgb(0, 0, 0)']));

  // Body text is at least 13px; the amount due is the largest figure.
  const due = receipt.getByText('Amount Due').locator('..');
  const dueStyle = await due.evaluate((el) => {
    const style = getComputedStyle(el);
    return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight) };
  });
  expect(dueStyle.size).toBeGreaterThanOrEqual(16);
  // Largest by size, not weight: extra-bold bled on the thermal head.
  expect(dueStyle.weight).toBeLessThanOrEqual(500);
  const bodySize = await receipt.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(bodySize).toBeGreaterThanOrEqual(13);

  // The owner's layout: date and time directly under the shop's own lines,
  // items in QTY | ITEM | AMT columns with a bare number under QTY, the
  // salesman beside the receipt number, and the mark in capitals.
  await expect(receipt.locator('header p').last()).toHaveText(
    /^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}\s?(am|pm)$/i,
  );
  for (const heading of ['QTY', 'ITEM', 'AMT']) {
    await expect(receipt.getByText(heading, { exact: true })).toBeVisible();
  }
  await expect(
    receipt.getByText('Test receipt — not a sale').locator('xpath=preceding-sibling::span[1]'),
  ).toHaveText('1');
  await expect(receipt.locator('footer')).toContainText(`Served by ${DEMO.owner}`);
  await expect(receipt.locator('footer')).toContainText('MEHVAR');

  // The page the print engine gets: 72 mm wide and one receipt tall. A static
  // `size: 72mm auto` was invalid CSS that Chrome dropped silently, so the slip
  // printed at ~75% on the pilot counter — while every check above passed,
  // because they measure the receipt, not the page. These measure the page.
  const pageRule = await page.evaluate(() => {
    const sheet = [...document.styleSheets].find(
      (candidate) => (candidate.ownerNode as Element | null)?.id === 'receipt-page',
    );
    const rule = sheet?.cssRules[0] as CSSPageRule | undefined;
    return rule ? rule.style.getPropertyValue('size') : '';
  });
  const [widthMm, heightMm] = pageRule.split(' ').map((part) => parseFloat(part));
  expect(pageRule, 'a size Chrome accepted').toMatch(/^72mm \d+mm$/);
  expect(widthMm).toBe(72);
  expect(heightMm! * MM).toBeGreaterThanOrEqual(box?.height ?? Infinity);

  const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1');
  const mediaBox = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/.exec(pdf);
  // 72 mm in PDF points (1 pt = 1/72 in); Letter would be 612.
  expect(Number(mediaBox?.[1])).toBeCloseTo((72 / 25.4) * 72, 0);

  // The test receipt's measured bars, at true size.
  const check = receipt.getByRole('region', { name: 'Printer check' });
  const bars = await check
    .locator('div')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  expect(bars[0]).toBeCloseTo(50 * MM, 0);
  expect(bars[1]).toBeCloseTo(72 * MM, 0);
  // …and the 72 mm bar starts at the page's left edge, so it measures the page.
  const barLeft = await check
    .locator('div')
    .nth(1)
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(barLeft).toBeCloseTo(box?.x ?? -1, 0);
});
