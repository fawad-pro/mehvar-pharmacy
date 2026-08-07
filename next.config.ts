import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,

  /**
   * Roadmap Phase 1 (PCN-004): the counter server is a Windows machine in the
   * shop, not a platform deployment.
   *
   * `standalone` traces the real dependency graph into `.next/standalone`, so
   * **no `npm install` ever runs on a customer machine** — the single most
   * important packaging property. A pharmacy gets one `.exe`; npm is a
   * developer tool and stays one.
   *
   * It does NOT copy `public/` or `.next/static`. `scripts/package/build.mjs`
   * copies both; a build that skips them starts and serves 404s for every
   * asset, which looks like a broken install rather than a packaging bug.
   */
  output: 'standalone',

  // The E2E harness drives the dev server over the loopback address.
  allowedDevOrigins: ['127.0.0.1'],

  // Phase 12 §1: HTTPS only, HSTS on. TLS terminates at the platform;
  // these headers are the application's half of that posture.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
