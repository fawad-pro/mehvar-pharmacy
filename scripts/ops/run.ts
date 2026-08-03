/**
 * Running a bundled PostgreSQL binary from an ops script.
 *
 * Shared by `ops:backup` and `ops:restore-drill` so that "the binary is
 * missing" produces the same actionable message in both, rather than Node's
 * bare ENOENT — the person reading it is the founder on a WhatsApp call, not a
 * developer at a terminal (I5 applied to ourselves).
 */

import { spawn } from 'node:child_process';

export interface RunOptions {
  /** Extra environment for the child, merged over the current process's. */
  env?: NodeJS.ProcessEnv;
  /** Suppress stdout — used where the child's chatter is noise, not output. */
  quiet?: boolean;
}

export function run(command: string, args: string[], options: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', options.quiet === true ? 'ignore' : 'inherit', 'inherit'],
      env: { ...process.env, ...options.env },
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(
          new Error(
            `Could not find "${command}". The bundled PostgreSQL provides it — ` +
              `check that its bin directory is on PATH for the service account.`,
          ),
        );
        return;
      }
      reject(new Error(`Could not run ${command}: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
  });
}
