import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end — Phase 11 §3.5: "One E2E path: W1 verbatim by keyboard —
 * search → select → qty → pay → receipt DOM rendered — asserting the Phase 10
 * §3/§4 key sequence. One, not many (P6): it guards the surface that is the
 * product."
 *
 * That spec lands in Session 8 / Day 8. Until then this config carries only the
 * scaffold smoke check, so the harness is proven before the test that matters
 * depends on it.
 */
const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * Set PLAYWRIGHT_CHROMIUM_PATH to run against a Chromium already on the machine
 * instead of Playwright's downloaded build — useful on the counter's own
 * hardware, and in sandboxes that ship a browser but block the download.
 */
const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],

  /**
   * One worker, deliberately — this is correctness, not just pacing.
   *
   * The suite shares one database, one paired device, and therefore one
   * device-scoped receipt sequence (Phase 9 §3). Two workers are two "counters"
   * with the same prefix minting the same numbers, which is a real condition the
   * system is designed to survive (it re-mints on collision) but a rare one, and
   * hammering it constantly makes the suite nondeterministic while testing
   * nothing the ingestion suite does not already prove. A real shop's second
   * counter has its own prefix.
   *
   * It also removes several cold Turbopack compiles racing each other, which is
   * what turned a slow first minute into seventeen startup timeouts on a
   * four-worker machine.
   */
  workers: 1,

  /** Generous: a cold dev-server compile can eat most of the default 30s. */
  timeout: 60_000,

  globalSetup: './e2e/support/warm-up.ts',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // The counter is a desktop browser at the till (Phase 8 §1).
      name: 'counter',
      use: {
        ...devices['Desktop Chrome'],
        ...(CHROMIUM_PATH ? { launchOptions: { executablePath: CHROMIUM_PATH } } : {}),
      },
    },
  ],
  // Point E2E_BASE_URL at an already-running instance to skip the managed server.
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
