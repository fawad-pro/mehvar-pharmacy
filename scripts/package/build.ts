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
 *     app/bin/db/     compiled migrate, grants, init, verify
 *     app/bin/ops/    compiled backup, restore-drill, support-bundle
 *                     (inside app/ so they resolve app/node_modules)
 *     migrations/     drizzle SQL, applied at install and at every update
 *     catalog/        the starter catalogue pack, imported at install
 *     runtime/        the pinned Node runtime (fetched separately)
 *     pgsql/          PostgreSQL binaries (fetched separately)
 *
 * `runtime/` and `pgsql/` are fetched by `packaging/windows/fetch-runtimes.ps1`
 * rather than here: they are large, platform-specific, and change about once a
 * year, so re-downloading them on every application build would be the slowest
 * possible way to get the same bytes.
 *
 * TypeScript, run through `tsx` like every other script in `package.json`. It
 * was `.mjs` until a Windows run found a cross-platform bug in it that
 * `tsc --noEmit` never saw, because `allowJs` is false and a `.mjs` file is
 * therefore checked by nothing at all.
 */

// Loaded first, before anything reads the environment: `warnIfServerActionsKeyMissing`
// checks `process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, which a packager sets
// in `.env` (the same value every release, Phase 12 §2). Without this the key is
// only seen when the shell happens to export it, so a build from a correct `.env`
// would warn and bake a random key anyway — the exact class `script-env.test.ts`
// guards.
import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { npmInvocation } from './npm-command';
import { assertNoEnvFiles, stripEnvFiles } from './payload-env';

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
  'scripts/catalog/import-pack.ts',
  'scripts/ops/backup.ts',
  'scripts/ops/restore-drill.ts',
  'scripts/ops/support-bundle.ts',
  // The service entry point WinSW runs. Bundled so `dotenv` is compiled in.
  'scripts/ops/serve.ts',
];

/**
 * Left for Node to resolve at runtime from `app/node_modules`.
 *
 * The list is exactly what the standalone tree actually ships, and no more.
 * Next traces the *application's* imports: `pg` and `@node-rs/argon2` survive
 * into `node_modules`, but `drizzle-orm` gets inlined into the server chunks
 * and `dotenv` is a devDependency that is never traced at all. Marking either
 * of those external produced ops scripts that died with MODULE_NOT_FOUND on
 * every installed machine while working perfectly in a dev checkout.
 *
 * The rule this encodes: external means "provably present in `app/`", not
 * "feels like a dependency". `assertExternalsArePresent` checks it rather than
 * trusting this comment to stay true.
 */
const EXTERNAL = ['@node-rs/argon2', 'pg', 'pg-native'];

/** Externals that must exist in the standalone tree. `pg-native` is optional. */
const REQUIRED_EXTERNALS = ['@node-rs/argon2', 'pg'];

function step(message: string): void {
  console.log(`\n  ${message}`);
}

/**
 * A build without a pinned Server Actions key ships an update time bomb.
 *
 * Next encrypts every Server Action reference with a key that, when
 * `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is unset, is generated randomly at build
 * time. Each release then gets a different key, so the first thing a pharmacy
 * that updates in place sees is a 404 on any form left open across the update —
 * Save product, Pay, Settle — until the operator reloads. Pinning one stable
 * key across releases removes it.
 *
 * A warning rather than a throw: a very first install has nothing older to be
 * incompatible with, and failing the build would be a worse first experience
 * than the risk it guards. It is loud, and it names the fix (I5).
 */
function warnIfServerActionsKeyMissing(): void {
  if (process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY) return;
  console.warn(
    [
      '',
      '  ⚠ NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is not set for this build.',
      '    Next will bake a random Server Actions key into it, so a shop that',
      '    updates in place will get a 404 on every open form until it reloads.',
      '    Set a stable key (the SAME value for every release) before packaging:',
      '',
      '      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(openssl rand -base64 32)',
      '',
    ].join('\n'),
  );
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
function assertWindowsNativeModules(): void {
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

/**
 * Every external must actually be in the payload we just assembled.
 *
 * `external` is a promise that Node will find the module at runtime. Nothing
 * checks that promise — a wrong entry produces a package that builds cleanly,
 * installs cleanly, and then fails with MODULE_NOT_FOUND the first time the
 * pharmacy's nightly backup runs. This is that check.
 */
function assertExternalsArePresent(): void {
  const missing = REQUIRED_EXTERNALS.filter(
    (name) => !existsSync(join(out, 'app', 'node_modules', name)),
  );
  if (missing.length === 0) return;

  throw new Error(
    [
      `These are marked external but are not in the standalone tree: ${missing.join(', ')}.`,
      '',
      'The ops scripts would fail with MODULE_NOT_FOUND on an installed',
      'machine. Either bundle them (drop from EXTERNAL in this file) or work',
      'out why Next stopped tracing them into app/node_modules.',
    ].join('\n'),
  );
}

/** Run an npm script. See `npm-command.ts` for why this is not one line. */
function runNpm(args: string[]): void {
  const {
    command,
    args: resolved,
    shell,
  } = npmInvocation(args, {
    platform: process.platform,
    env: process.env,
    nodePath: process.execPath,
  });

  execFileSync(command, resolved, { cwd: root, stdio: 'inherit', shell });
}

function packageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
    const { version } = parsed as { version: unknown };
    if (typeof version === 'string') return version;
  }
  throw new Error('package.json has no string "version" — the payload could not be stamped.');
}

async function main(): Promise<void> {
  assertWindowsNativeModules();

  step('Cleaning dist/package');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  warnIfServerActionsKeyMissing();

  step('Building the Next.js standalone server');
  runNpm(['run', 'build']);

  const standalone = join(root, '.next', 'standalone');
  if (!existsSync(standalone)) {
    throw new Error(
      "No .next/standalone directory. Is output: 'standalone' still set in next.config.ts?",
    );
  }

  step('Copying the standalone server');
  cpSync(standalone, join(out, 'app'), { recursive: true });

  // Standalone carries this machine's `.env*` along, and Next would load them
  // at every pharmacy. See payload-env.ts.
  const stripped = stripEnvFiles(join(out, 'app'));
  if (stripped.length > 0) {
    console.log(`  removed ${stripped.join(', ')} (the build machine's, never the shop's)`);
  }

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
    /*
     * INSIDE app/, deliberately. Node resolves a bare import from the importing
     * file's directory upward, so `app/bin/ops/backup.js` finds
     * `app/node_modules` — the only place the externals exist. Hoisting these
     * to a sibling `bin/` breaks every one of them at runtime, silently, on a
     * machine nobody can attach a debugger to.
     */
    outdir: join(out, 'app', 'bin'),
    // Keeps the `db/` and `ops/` split from the source tree:
    // app/bin/db/migrate.js, app/bin/ops/backup.js. mehvar.iss,
    // install-services.ps1 and OPERATIONS.md all name these paths.
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

  assertExternalsArePresent();

  step('Copying migrations');
  cpSync(join(root, 'src', 'db', 'migrations'), join(out, 'migrations'), { recursive: true });

  /*
   * The starter catalogue is BUILT here, not committed.
   *
   * A committed pack would be a second copy of the catalogue living beside the
   * source list, and the two would drift — invisibly, until a pharmacy asked
   * why a medicine that is plainly in the code is missing from its search.
   * Building it as part of the payload means the pack in any given installer
   * was made from that same commit, by definition.
   */
  step('Building the starter catalogue');
  runNpm(['run', 'catalog:build', '--', '--out', join(out, 'catalog', 'starter.json')]);

  assertNoEnvFiles(join(out, 'app'));

  writeFileSync(
    join(out, 'VERSION'),
    `${JSON.stringify({ version: packageVersion(), builtAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );

  console.log(`\n  Package assembled at ${out}`);
  console.log('  Next: packaging/windows/fetch-runtimes.ps1, then compile mehvar.iss.\n');
}

main().catch((error: unknown) => {
  console.error(`\n  Packaging failed:\n\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
