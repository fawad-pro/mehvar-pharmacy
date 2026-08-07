/**
 * Running a bundled PostgreSQL binary from an ops script.
 *
 * Shared by `ops:backup` and `ops:restore-drill` so that "the binary is
 * missing" produces the same actionable message in both, rather than Node's
 * bare ENOENT — the person reading it is the founder on a WhatsApp call, not a
 * developer at a terminal (I5 applied to ourselves).
 *
 * On an installed machine the bundled `pgsql\bin` is not on PATH, and the
 * nightly backup runs as SYSTEM with a near-empty environment. A bare
 * `pg_dump` resolves fine on a developer's box and fails on every real
 * install, which is the same shape of bug as the packager's bare `npm` — so
 * the installer writes `MEHVAR_PG_BIN` into `.env` and these binaries are
 * resolved against it.
 */

import { spawn } from 'node:child_process';
import { posix, win32 } from 'node:path';

export interface RunOptions {
  /** Extra environment for the child, merged over the current process's. */
  env?: NodeJS.ProcessEnv;
  /** Suppress stdout — used where the child's chatter is noise, not output. */
  quiet?: boolean;
}

/**
 * Where a PostgreSQL executable lives.
 *
 * With `MEHVAR_PG_BIN` set (every installed machine) the binary is addressed
 * absolutely, so PATH is irrelevant. Without it (a developer checkout, or the
 * Docker Compose database) the bare name is used and PATH does the work.
 */
export function resolvePostgresBinary(
  name: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
): string {
  const binDir = env.MEHVAR_PG_BIN;
  if (binDir === undefined || binDir === '') return name;

  // Joined with the separator of the TARGET platform, not the host's. The
  // default `join` is bound to whatever machine is running, which would make
  // the `platform` argument a lie the moment anything passed a value other
  // than its own — and would have silently produced `…\bin/pg_dump.exe`.
  const path = platform === 'win32' ? win32 : posix;
  return path.join(binDir, platform === 'win32' ? `${name}.exe` : name);
}

export function run(command: string, args: string[], options: RunOptions = {}): Promise<void> {
  const executable = resolvePostgresBinary(command);

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ['ignore', options.quiet === true ? 'ignore' : 'inherit', 'inherit'],
      env: { ...process.env, ...options.env },
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(
          new Error(
            `Could not find "${executable}". The bundled PostgreSQL provides it — ` +
              `check that MEHVAR_PG_BIN in the Mehvar .env points at its bin directory.`,
          ),
        );
        return;
      }
      reject(new Error(`Could not run ${executable}: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${executable} exited with code ${code ?? 'unknown'}`));
    });
  });
}
