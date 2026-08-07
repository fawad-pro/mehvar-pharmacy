/**
 * Finding the migrations folder.
 *
 * This was `path.join(process.cwd(), 'src/db/migrations')`, which is true in a
 * developer checkout and false everywhere else. On the first real Windows
 * install the working directory was wherever Setup happened to launch
 * PowerShell, the folder was not found, and — because a missing folder was
 * treated as "no migrations yet" — `migrate` printed a cheerful message and
 * **exited zero without creating a single table**. `grants` then failed on
 * `GRANT ... ON "tenants"`, and the installer reported "code 1".
 *
 * Two lessons, both already written down in `CLAUDE.md`:
 *
 *   - A path derived from `process.cwd()` is a guess about who launched you.
 *   - "A documented no-op is a promise to keep, not a comment to outlive its
 *     own accuracy." The clean exit was correct in Session 0, when there were
 *     no migrations. There are five now, and it had become a way for a fatal
 *     misconfiguration to look like success.
 *
 * Pure and parameterised so the search can be tested without a real install.
 */

import { join } from 'node:path';

export interface MigrationsContext {
  env: Readonly<Record<string, string | undefined>>;
  /** `__dirname` of the running script. */
  scriptDir: string;
  /** `process.cwd()`. */
  cwd: string;
  /** Usually a check for a directory holding at least one `.sql` file. */
  looksLikeMigrations: (path: string) => boolean;
}

/**
 * Where to look, in order of how much we trust it.
 *
 * The environment variable comes first because the installer sets it and knows
 * exactly where the files landed. The script-relative paths cover both layouts
 * without anyone having to configure anything: `scripts/db/` in a checkout,
 * `app/bin/db/` in a package. `cwd` is last and is only a convenience for
 * someone running from the repository root.
 */
export function migrationsCandidates(context: MigrationsContext): string[] {
  const candidates: string[] = [];

  const configured = context.env.MEHVAR_MIGRATIONS_DIR;
  if (configured !== undefined && configured.trim() !== '') {
    candidates.push(configured.trim());
  }

  // Packaged: app/bin/db/migrate.js  ->  <install root>/migrations
  candidates.push(join(context.scriptDir, '..', '..', '..', 'migrations'));
  // Checkout: scripts/db/migrate.ts  ->  src/db/migrations
  candidates.push(join(context.scriptDir, '..', '..', 'src', 'db', 'migrations'));
  candidates.push(join(context.cwd, 'src', 'db', 'migrations'));

  return [...new Set(candidates)];
}

export interface MigrationsLocation {
  folder: string | undefined;
  searched: string[];
}

export function resolveMigrationsFolder(context: MigrationsContext): MigrationsLocation {
  const searched = migrationsCandidates(context);
  return { folder: searched.find((path) => context.looksLikeMigrations(path)), searched };
}
