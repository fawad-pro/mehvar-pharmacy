import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isTestDatabaseName, refusalFor } from '../e2e/support/database-guard';

const url = (name: string) => `postgresql://mehvar_app:x@localhost:5432/${name}`;

describe('the E2E database guard', () => {
  it('accepts only names that say they are for tests', () => {
    for (const name of ['mehvar_ci', 'mehvar_test', 'test_mehvar', 'MEHVAR_TEST']) {
      expect(isTestDatabaseName(name), name).toBe(true);
    }
    for (const name of ['mehvar_pharmacy', 'mehvar', 'testing', 'mehvar_ci_backup', 'contest']) {
      expect(isTestDatabaseName(name), name).toBe(false);
    }
  });

  it('refuses the working database, named by either URL', () => {
    expect(refusalFor({ DATABASE_URL: url('mehvar_pharmacy') })).toMatch(/mehvar_pharmacy/);
    expect(
      refusalFor({ DATABASE_URL: url('mehvar_test'), DATABASE_ADMIN_URL: url('mehvar_pharmacy') }),
    ).toMatch(/DATABASE_ADMIN_URL/);
    expect(refusalFor({})).toMatch(/not set/);
    expect(
      refusalFor({ DATABASE_URL: url('mehvar_ci'), DATABASE_ADMIN_URL: url('mehvar_ci') }),
    ).toBeNull();
  });

  it('runs before anything the suite does: the config, and ahead of the reset', () => {
    const config = readFileSync('playwright.config.ts', 'utf8');
    expect(config).toMatch(/refusalFor\(process\.env\)/);
    // A dev server already running may be connected to any database.
    expect(config).toMatch(/reuseExistingServer: false/);
    const scripts = (
      JSON.parse(readFileSync('package.json', 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts['e2e:reset']).toMatch(/^npm run e2e:check-db && npm run db:reset/);
    expect(scripts.e2e).toMatch(/^npm run e2e:check-db && /);
  });
});
