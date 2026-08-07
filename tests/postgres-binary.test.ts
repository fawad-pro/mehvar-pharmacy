/**
 * The same bug class as `npm-command.test.ts`: a bare command name that
 * resolves on the developer's machine and not on the customer's.
 *
 * On an installed pharmacy the bundled `pgsql\bin` is not on PATH, and the
 * nightly backup task runs as SYSTEM with almost no environment — so bare
 * `pg_dump` would ENOENT every night, silently, until someone read a support
 * bundle and noticed the backup-age warning.
 */

import { describe, expect, it } from 'vitest';

import { resolvePostgresBinary } from '../scripts/ops/run';

describe('with MEHVAR_PG_BIN set (every installed machine)', () => {
  it('addresses the binary absolutely, so PATH is irrelevant', () => {
    const env = { MEHVAR_PG_BIN: 'C:\\Program Files\\Mehvar\\pgsql\\bin' };

    expect(resolvePostgresBinary('pg_dump', env, 'win32')).toBe(
      'C:\\Program Files\\Mehvar\\pgsql\\bin\\pg_dump.exe',
    );
  });

  it('appends .exe only on Windows', () => {
    const env = { MEHVAR_PG_BIN: '/opt/mehvar/pgsql/bin' };

    expect(resolvePostgresBinary('psql', env, 'linux')).toBe('/opt/mehvar/pgsql/bin/psql');
    expect(resolvePostgresBinary('psql', env, 'darwin')).toBe('/opt/mehvar/pgsql/bin/psql');
  });

  it('covers every binary the ops scripts actually spawn', () => {
    const env = { MEHVAR_PG_BIN: '/opt/pg/bin' };

    for (const binary of ['pg_dump', 'pg_restore', 'psql']) {
      expect(resolvePostgresBinary(binary, env, 'linux')).toBe(`/opt/pg/bin/${binary}`);
    }
  });
});

describe('without MEHVAR_PG_BIN (developer checkout, Docker Compose database)', () => {
  it('falls back to the bare name so PATH still works', () => {
    expect(resolvePostgresBinary('pg_dump', {}, 'linux')).toBe('pg_dump');
    expect(resolvePostgresBinary('pg_dump', {}, 'win32')).toBe('pg_dump');
  });

  it('treats an empty value as unset rather than as the root directory', () => {
    // An installer that wrote `MEHVAR_PG_BIN=` with no value would otherwise
    // look for the binary at the filesystem root.
    expect(resolvePostgresBinary('psql', { MEHVAR_PG_BIN: '' }, 'linux')).toBe('psql');
  });
});
