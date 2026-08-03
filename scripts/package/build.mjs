/**
 * `npm run package:build` — assemble the Mehvar Node payload.
 *
 * Turns a development checkout into the tree the Windows installer wraps
 * (roadmap Phase 1, PCN-004). The customer never sees npm, and never runs it:
 * `output: 'standalone'` has already traced the real dependency graph, so the
 * payload carries its own `node_modules` and nothing is installed on a shop
 * machine.
 *
 * Output layout, which `packaging/windows/mehvar.iss` mirrors exactly:
 *
 *   dist/package/
 *     app/            the standalone server (server.js, node_modules, .next)
 *     app/public/     copied — standalone does NOT include it
 *     app/.next/static/  copied — standalone does NOT include it either
 *     bin/db/         compiled migrate, grants, init, verify
 *     bin/ops/        compiled backup, restore-drill, support-bundle
 *     migrations/     drizzle SQL, applied at install and at every update
 *     runtime/        the pinned Node runtime (fetched separately)
 *     pgsql/          PostgreSQL binaries (fetched separately)
 *
 * `runtime/` and `pgsql/` are fetched by `packaging/windows/fetch-runtimes.ps1`
 * rather than here: they are large, platform-specific, and change about once a
 * year, so re-downloading them on every application build would be the slowest
 * possible way to get the same bytes.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'dist', 'package');

/**
 * Scripts the shop machine runs. Bundled to plain JS so the installed product
 * needs neither `tsx` nor a TypeScript toolchain — a pharmacy has no developer
 * tools, which is the entire point of the phase.
 */
const OPS_ENTRYPOINTS = [
  'scripts/db/migrate.ts',
  'scripts/db/grants.ts',
  'scripts/db/init.ts',
  'scripts/db/verify.ts',
  'scripts/ops/backup.ts',
  'scripts/ops/restore-drill.ts',
  'scripts/ops/support-bundle.ts',
];

/**
 * Left for Node to resolve at runtime from the standalone tree.
 *
 * `@node-rs/argon2` is a native module and cannot be bundled at all; `pg` and
 * `drizzle-orm` pull in optional native paths that esbuild would resolve
 * incorrectly.
 */
const EXTERNAL = ['@node-rs/argon2', 'pg', 'pg-native', 'drizzle-orm', 'dotenv'];

function step(message) {
  console.log(`\n  ${message}`);
}

/**
 * Refuse to build a package that would fail at the counter.
 *
 * `@node-rs/argon2` ships a per-platform binary chosen at install time. A build
 * run on Linux resolves the Linux binary, and the resulting installer would get
 * all the way to a pharmacy before failing — at the first PIN hash, which is
 * the login screen, which is the first thing anybody does. That is the worst
 * possible place to discover a packaging mistake, so it is checked here.
 */
function assertWindowsNativeModules() {
  const candidates = [
    'node_modules/@node-rs/argon2-win32-x64-msvc',
    'node_modules/@node-rs/argon2-win32-arm64-msvc',
  ];
  if (candidates.some((candidate) => existsSync(join(root, candidate)))) return;

  throw new Error(
    [
      'No Windows build of @node-rs/argon2 is installed, so this package would',
      'fail at the first PIN hash — the login screen — on a shop machine.',
      '',
      'Build the package on Windows, or install the Windows binary first:',
      '',
      '  npm install --os=win32 --cpu=x64 --include=optional',
      '',
      `(found: ${process.platform}-${process.arch})`,
    ].join('\n'),
  );
}

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
}

async function main() {
  assertWindowsNativeModules();

  step('Cleaning dist/package');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  step('Building the Next.js standalone server');
  run('npm', ['run', 'build']);

  const standalone = join(root, '.next', 'standalone');
  if (!existsSync(standalone)) {
    throw new Error(
      "No .next/standalone directory. Is output: 'standalone' still set in next.config.ts?",
    );
  }

  step('Copying the standalone server');
  cpSync(standalone, join(out, 'app'), { recursive: true });

  /*
   * The two directories `standalone` deliberately omits. Without them the
   * server starts, serves HTML, and 404s every stylesheet and script — which
   * reads as a broken install rather than a packaging bug, and is the single
   * most common way this build goes wrong.
   */
  step('Copying public/ and .next/static (standalone omits both)');
  if (existsSync(join(root, 'public'))) {
    cpSync(join(root, 'public'), join(out, 'app', 'public'), { recursive: true });
  }
  cpSync(join(root, '.next', 'static'), join(out, 'app', '.next', 'static'), { recursive: true });

  step('Bundling ops scripts to plain JavaScript');
  await build({
    entryPoints: OPS_ENTRYPOINTS.map((entry) => join(root, entry)),
    outdir: join(out, 'bin'),
    // Keeps the `db/` and `ops/` split from the source tree: bin/db/migrate.js,
    // bin/ops/backup.js. mehvar.iss and OPERATIONS.md both name these paths.
    outbase: join(root, 'scripts'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: EXTERNAL,
    // The ops scripts import `server-only`, which exists to break a browser
    // build. Off the browser it must be a no-op, not a throw.
    alias: { 'server-only': join(root, 'tests', 'server-only-stub.ts') },
    logLevel: 'warning',
  });

  step('Copying migrations');
  cpSync(join(root, 'src', 'db', 'migrations'), join(out, 'migrations'), { recursive: true });

  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  writeFileSync(
    join(out, 'VERSION'),
    `${JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );

  console.log(`\n  Package assembled at ${out}`);
  console.log('  Next: packaging/windows/fetch-runtimes.ps1, then compile mehvar.iss.\n');
}

main().catch((error) => {
  console.error(`\n  Packaging failed:\n\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
