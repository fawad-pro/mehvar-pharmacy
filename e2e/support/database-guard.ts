/**
 * The E2E suite writes real sales, discounts, returns and cash entries into
 * whatever database `.env` names. Run once against a working pharmacy, it
 * left Rs 999,999 in the day's expected cash. So it refuses any database
 * whose name does not say it is for tests.
 */

/** A database is for tests when its name says so: `mehvar_ci`, `mehvar_test`, `test_…`. */
export function isTestDatabaseName(name: string): boolean {
  return /(^test_|_test$|_ci$)/i.test(name);
}

function databaseName(url: string): string | null {
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
    return name === '' ? null : name;
  } catch {
    return null;
  }
}

/** Why the suite must not run here, or null when every database it would touch is a test one. */
export function refusalFor(env: Readonly<Record<string, string | undefined>>): string | null {
  for (const key of ['DATABASE_URL', 'DATABASE_ADMIN_URL']) {
    const url = env[key];
    if (url === undefined || url === '') continue;
    const name = databaseName(url);
    if (name === null || !isTestDatabaseName(name)) {
      return (
        `Refusing to run the E2E suite: ${key} names the database "${name ?? url}", ` +
        'which is not a test database. The suite writes real sales and cash entries. ' +
        'Point .env at a database whose name ends in _test or _ci (for example ' +
        'mehvar_test), run `npm run db:setup` once, and try again.'
      );
    }
  }
  if ((env.DATABASE_URL ?? '') === '') {
    return 'Refusing to run the E2E suite: DATABASE_URL is not set, so its database cannot be checked.';
  }
  return null;
}
