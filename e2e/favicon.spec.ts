import { expect, test } from '@playwright/test';
import { openCounter } from './support/counter';

test.describe('Favicon & PWA Icons', () => {
  test('emits correct icon link tags and serves valid icon assets', async ({ page, request }) => {
    await openCounter(page);

    // 1. Verify manifest link
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest');

    // 2. Fetch and verify manifest content
    const manifestRes = await request.get('/manifest.webmanifest');
    expect(manifestRes.ok()).toBe(true);
    const manifest = await manifestRes.json();
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }),
        expect.objectContaining({ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }),
      ]),
    );

    // 3. Verify icon tags in document head
    const iconLinks = await page.locator('link[rel*="icon"]').evaluateAll((els) =>
      els.map((el) => ({
        rel: el.getAttribute('rel'),
        href: el.getAttribute('href'),
        sizes: el.getAttribute('sizes'),
        type: el.getAttribute('type'),
      })),
    );
    expect(iconLinks.length).toBeGreaterThan(0);
    console.log('Discovered icon links:', iconLinks);

    // Confirm no reference to the old icon.svg
    expect(iconLinks.some((l) => l.href?.includes('icon.svg'))).toBe(false);

    // 4. Verify all icon endpoints respond 200 OK with valid images
    const urls = ['/favicon.ico', '/icon-192.png', '/icon-512.png', '/apple-icon.png', '/icon.png'];
    for (const url of urls) {
      const res = await request.get(url);
      expect(res.status(), `${url} should return 200`).toBe(200);
      const body = await res.body();
      expect(body.length, `${url} should have image bytes`).toBeGreaterThan(100);
    }
  });
});
