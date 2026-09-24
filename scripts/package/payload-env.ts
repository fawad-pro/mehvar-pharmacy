/**
 * The build machine's `.env` must never reach a pharmacy.
 *
 * Next's `output: 'standalone'` copies the project's `.env*` files into
 * `.next/standalone`, so `package:build` used to ship the packager's `.env` —
 * owner and app database passwords, `SESSION_SECRET`, anything else in it — as
 * `{app}\app\.env` in every installer. Worse than a leak: Next loads that file
 * at startup (`loadEnvConfig` on the standalone dir), so any key the shop's own
 * `C:\ProgramData\Mehvar\.env` did not set was silently configured by the
 * build machine.
 *
 * Nothing the payload needs lives there. The one build-time secret the server
 * does need at runtime, the Server Actions key, is baked into
 * `.next/server/server-reference-manifest.json` by `next build`; Next reads it
 * from the manifest when the environment does not set it.
 *
 * Three layers use this module so they cannot disagree about what counts:
 * `build.ts` strips, `build-installer.ts` refuses a payload that still has one,
 * and `mehvar.iss` excludes the same names from `[Files]`.
 */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** `.env`, `.env.local`, `.env.production`, `.env.example` — the whole family. */
export function isEnvFileName(name: string): boolean {
  return /^\.env(\..+)?$/.test(name);
}

/** The `.env`-family files directly inside `directory` (where Next copies them). */
export function envFilesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isEnvFileName(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** Delete them. Returns what was removed, so the build can say so. */
export function stripEnvFiles(directory: string): string[] {
  const found = envFilesIn(directory);
  for (const name of found) {
    rmSync(join(directory, name), { force: true });
  }
  return found;
}

/** Refuse, naming the files, if any remain. */
export function assertNoEnvFiles(directory: string): void {
  const found = envFilesIn(directory);
  if (found.length === 0) return;
  throw new Error(
    [
      `The payload carries the build machine's environment: ${found.map((name) => join(directory, name)).join(', ')}.`,
      '',
      "Those files hold the packager's database passwords and session secret, and",
      'the server would load them at every pharmacy. Rebuild with',
      '  npm run package:build',
      'which strips them, rather than deleting them by hand.',
    ].join('\n'),
  );
}
