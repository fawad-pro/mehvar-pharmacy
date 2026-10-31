import { afterEach, describe, expect, it } from 'vitest';

import { isMobileBrowser } from './device';

describe('isMobileBrowser', () => {
  const originalWindow = globalThis.window;
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    globalThis.window = originalWindow;
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  it('returns false when window is undefined (SSR)', () => {
    // @ts-expect-error test SSR
    delete globalThis.window;
    expect(isMobileBrowser()).toBe(false);
  });

  it('returns false on desktop viewport with fine pointer', () => {
    globalThis.window = {
      innerWidth: 1280,
      matchMedia: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    } as unknown as Window & typeof globalThis;

    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
      configurable: true,
    });

    expect(isMobileBrowser()).toBe(false);
  });

  it('returns true on mobile viewport (< 768px)', () => {
    globalThis.window = {
      innerWidth: 390,
      matchMedia: (query: string) => ({
        matches: query.includes('max-width: 767px'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    } as unknown as Window & typeof globalThis;

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
      configurable: true,
    });

    expect(isMobileBrowser()).toBe(true);
  });

  it('returns true on mobile user agent with coarse pointer even if viewport is wider (landscape)', () => {
    globalThis.window = {
      innerWidth: 844,
      matchMedia: (query: string) => ({
        matches: query.includes('pointer: coarse'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    } as unknown as Window & typeof globalThis;

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Mobile Safari/537.36',
      configurable: true,
    });

    expect(isMobileBrowser()).toBe(true);
  });
});
