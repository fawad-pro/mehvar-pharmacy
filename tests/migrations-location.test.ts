/**
 * The bug that made the first real Windows install fail.
 *
 * `migrate` derived its migrations folder from `process.cwd()`. Under Setup the
 * working directory is wherever it launched PowerShell, so the folder was not
 * found — and a missing folder was treated as "no migrations yet", so migrate
 * printed a friendly message and exited ZERO against an empty database. Grants
 * then failed on the first table that did not exist, and all the operator saw
 * was "code 1".
 */

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  migrationsCandidates,
  resolveMigrationsFolder,
  type MigrationsContext,
} from '../scripts/db/migrations-location';

/** Pretend only these paths hold migrations. */
function only(...present: string[]) {
  return (path: string) => present.includes(path);
}

function context(overrides: Partial<MigrationsContext> = {}): MigrationsContext {
  return {
    env: {},
    scriptDir: '/repo/scripts/db',
    cwd: '/repo',
    looksLikeMigrations: () => false,
    ...overrides,
  };
}

describe('a packaged install', () => {
  it('finds migrations beside the install root, not relative to the cwd', () => {
    // app/bin/db/migrate.js  ->  <install root>/migrations
    const scriptDir = 'C:\\Program Files\\Mehvar\\app\\bin\\db';
    const expected = join(scriptDir, '..', '..', '..', 'migrations');

    const found = resolveMigrationsFolder(
      // The cwd Setup happens to hand us is irrelevant, and that is the point.
      context({ scriptDir, cwd: 'C:\\Windows\\system32', looksLikeMigrations: only(expected) }),
    );

    expect(found.folder).toBe(expected);
  });

  it('prefers MEHVAR_MIGRATIONS_DIR, which the installer sets explicitly', () => {
    const configured = 'C:\\Program Files\\Mehvar\\migrations';

    const found = resolveMigrationsFolder(
      context({ env: { MEHVAR_MIGRATIONS_DIR: configured }, looksLikeMigrations: () => true }),
    );

    expect(found.folder).toBe(configured);
  });

  it('ignores a blank MEHVAR_MIGRATIONS_DIR rather than searching for ""', () => {
    expect(migrationsCandidates(context({ env: { MEHVAR_MIGRATIONS_DIR: '  ' } }))).not.toContain(
      '',
    );
  });
});

describe('a developer checkout', () => {
  it('finds src/db/migrations relative to the script', () => {
    const expected = join('/repo/scripts/db', '..', '..', 'src', 'db', 'migrations');

    expect(resolveMigrationsFolder(context({ looksLikeMigrations: only(expected) })).folder).toBe(
      expected,
    );
  });

  it('still honours the repository root as a last resort', () => {
    const expected = join('/repo', 'src', 'db', 'migrations');

    expect(
      resolveMigrationsFolder(
        context({ scriptDir: '/elsewhere', looksLikeMigrations: only(expected) }),
      ).folder,
    ).toBe(expected);
  });
});

describe('when nothing is found', () => {
  it('reports undefined rather than a path that does not exist', () => {
    // The caller turns this into a fatal error. It must never look like
    // "no migrations yet", which is how an empty database passed for success.
    expect(resolveMigrationsFolder(context()).folder).toBeUndefined();
  });

  it('lists both layouts it tried, so the error can name them', () => {
    const { searched } = resolveMigrationsFolder(context());

    // The packaged layout and the checkout layout, which is what a reader of
    // the error needs to see to know which assumption was wrong.
    expect(searched).toContain(join('/repo/scripts/db', '..', '..', '..', 'migrations'));
    expect(searched).toContain(join('/repo/scripts/db', '..', '..', 'src', 'db', 'migrations'));
  });

  it('does not repeat a path, even when two rules produce the same one', () => {
    // In an ordinary checkout the script-relative and cwd-relative candidates
    // are the same directory. Listing it twice would make the error message
    // look like two different things were tried.
    const { searched } = resolveMigrationsFolder(context());

    expect(new Set(searched).size).toBe(searched.length);
  });
});
