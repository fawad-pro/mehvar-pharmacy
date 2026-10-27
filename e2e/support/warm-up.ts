/**
 * Compiles the counter's routes before the first test touches them.
 *
 * Playwright's `webServer` waits for the dev server to answer one request, and
 * then declares it ready — but a Next dev server compiles routes on demand, so
 * "ready" means only that the root route exists. The first test to open `/sale`
 * pays for compiling that page, its client bundle and `/api/catalog`, and the
 * first to open `/products` pays again. On a fast machine that is a second of
 * noise; on a slower one, with several workers asking at once, it is tens of
 * seconds and every assertion in the startup path times out.
 *
 * That produced a report of seventeen failures which all looked like the
 * application never becoming ready, when it was becoming ready perfectly well
 * some way after the deadline. Paying the compile cost once, here, deletes the
 * whole class of failure rather than papering over it with longer timeouts.
 *
 * Skipped when `E2E_BASE_URL` points at an already-running server: a production
 * build has nothing to compile, and warming someone else's instance is not this
 * file's business.
 */

/*
 * Every route a spec reaches by a function key, not only the ones it opens on.
 * A route left out compiles on its first key press, and the five-second
 * interaction timeout was then measuring the compiler: F2 → /receipts and
 * F7 → /purchases failed that way under full-suite load.
 */
const ROUTES = [
  '/login',
  '/sale',
  '/receipts',
  '/customers',
  '/products',
  '/stock',
  '/purchases',
  '/stock/adjust',
  '/returns',
  '/day',
  '/settings',
  '/owner',
  '/owner/login',
  '/api/catalog',
];

export default async function warmUp(): Promise<void> {
  if (process.env.E2E_BASE_URL) {
    return;
  }

  const port = Number(process.env.PORT ?? 3000);
  const base = `http://127.0.0.1:${port}`;

  // Sequential on purpose: the point is to let the compiler finish one route at
  // a time, which is faster than parallel cold compiles fighting for the
  // same CPU — the exact contention this exists to remove.
  for (const route of ROUTES) {
    try {
      await fetch(`${base}${route}`, { redirect: 'manual' });
    } catch {
      // A route that will not answer is the suite's problem to report, with a
      // real assertion and a real message. Failing here would only obscure it.
    }
  }
}
