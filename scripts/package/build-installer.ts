/**
 * `npm run package:installer` — compile the Windows installer.
 *
 * Step 4 of the build, after `package:build` and `fetch-runtimes.ps1`. It
 * locates ISCC.exe itself (see `iscc-location.ts`), preflights the payload,
 * and stamps the version from `package.json` so the `.exe` filename and the
 * Add/Remove Programs entry cannot disagree with the build.
 *
 * The preflight is the point. Handed a missing directory, ISCC says
 *
 *     Error on line 55: No files found matching "...\pgsql\*"
 *
 * which is true and unhelpful: the cause is that `fetch-runtimes.ps1` has not
 * run, and the fix is one command that the error does not mention. Checking
 * first turns that into a sentence naming the command.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findIscc } from './iscc-location';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const payload = join(root, 'dist', 'package');
const script = join(root, 'packaging', 'windows', 'mehvar.iss');

/** Every path `[Files]` globs, with the command that produces it. */
const REQUIRED_PAYLOAD: ReadonlyArray<{ path: string; producedBy: string }> = [
  { path: 'app/server.js', producedBy: 'npm run package:build' },
  { path: 'app/.next/static', producedBy: 'npm run package:build' },
  { path: 'app/bin/db/migrate.js', producedBy: 'npm run package:build' },
  { path: 'app/bin/ops/backup.js', producedBy: 'npm run package:build' },
  { path: 'migrations', producedBy: 'npm run package:build' },
  { path: 'VERSION', producedBy: 'npm run package:build' },
  { path: 'runtime/node.exe', producedBy: 'packaging\\windows\\fetch-runtimes.ps1' },
  { path: 'pgsql/bin/initdb.exe', producedBy: 'packaging\\windows\\fetch-runtimes.ps1' },
  // WinSW hosts the counter service; node.exe cannot be one on its own.
  { path: 'winsw/WinSW.exe', producedBy: 'packaging\\windows\\fetch-runtimes.ps1' },
  { path: 'app/bin/ops/serve.js', producedBy: 'npm run package:build' },
];

function assertPayloadComplete(): void {
  const missing = REQUIRED_PAYLOAD.filter((entry) => !existsSync(join(payload, entry.path)));
  if (missing.length === 0) return;

  const commands = [...new Set(missing.map((entry) => entry.producedBy))];
  throw new Error(
    [
      `The payload at ${payload} is incomplete:`,
      '',
      ...missing.map((entry) => `  missing  ${entry.path}`),
      '',
      'Run first:',
      ...commands.map((command) => `  ${command}`),
    ].join('\n'),
  );
}

function packageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
    const { version } = parsed as { version: unknown };
    if (typeof version === 'string') return version;
  }
  throw new Error('package.json has no string "version".');
}

function main(): void {
  if (process.platform !== 'win32') {
    // Not a soft warning: on any other OS this produces nothing, and a build
    // script that "succeeds" without emitting an installer is worse than one
    // that refuses.
    console.error(
      [
        'The Inno Setup compiler is Windows-only, so the installer cannot be',
        `built on ${process.platform}.`,
        '',
        'Everything before this step is cross-platform:',
        '  npm run package:build     assembles dist/package',
        '  npm run lint:ps           checks the PowerShell',
        '',
        'Run this step on Windows.',
      ].join('\n'),
    );
    process.exit(1);
  }

  assertPayloadComplete();

  const { path: iscc, searched } = findIscc({ env: process.env, exists: existsSync });
  if (iscc === undefined) {
    throw new Error(
      [
        'Could not find ISCC.exe (the Inno Setup compiler). Looked in:',
        '',
        ...searched.map((candidate) => `  ${candidate}`),
        '',
        'Install Inno Setup, or point ISCC at the compiler:',
        '  set ISCC=D:\\Tools\\InnoSetup\\ISCC.exe',
      ].join('\n'),
    );
  }

  const version = packageVersion();
  console.log(`\n  Compiling with ${iscc}`);
  console.log(`  Version ${version}\n`);

  execFileSync(iscc, [`/DAppVersion=${version}`, script], { cwd: root, stdio: 'inherit' });

  console.log(`\n  Installer written to ${join(root, 'dist', `MehvarSetup-${version}.exe`)}\n`);
}

try {
  main();
} catch (error: unknown) {
  console.error(
    `\n  Building the installer failed:\n\n${error instanceof Error ? error.message : error}\n`,
  );
  process.exit(1);
}
