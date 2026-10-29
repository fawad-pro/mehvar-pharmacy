/**
 * `npm run package:cloud` — assemble the cloud image's payload (PCN-019).
 *
 * The Linux sibling of `build.ts`, run by the Dockerfile after `next build`.
 * Same shape on purpose, so the one bundled set of scripts (migrate, grants,
 * catalogue import, provisioning, verify, backup) behaves identically in a
 * shop and in the cloud — "one codebase, one image" (PCN-004):
 *
 *   dist/cloud/
 *     app/          the standalone server, public/, .next/static, bin/
 *     migrations/   drizzle SQL — `app/bin/db/migrate.js` finds it two levels up
 *     catalog/      the starter catalogue pack
 *
 * `build.ts` is not reused because it is the Windows installer's: it refuses to
 * run without the Windows argon2 binary and stamps a VERSION for an `.exe`.
 * `tests/cloud-build.test.ts` pins that the two bundle the same scripts, so the
 * lists cannot drift.
 */
import 'dotenv/config';

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { assertNoEnvFiles, stripEnvFiles } from './payload-env';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'dist', 'cloud');

/** Everything a shop runs, except the WinSW service entry point. */
const CLOUD_OPS_ENTRYPOINTS = [
  'scripts/db/migrate.ts',
  'scripts/db/grants.ts',
  'scripts/db/init.ts',
  'scripts/db/verify.ts',
  'scripts/catalog/import-pack.ts',
  'scripts/ops/backup.ts',
  'scripts/ops/restore-drill.ts',
  'scripts/ops/restore.ts',
  'scripts/ops/support-bundle.ts',
  'scripts/ops/provision-tenant.ts',
];

/** Provably present in `app/node_modules` (see `build.ts`), nothing else. */
const EXTERNAL = ['@node-rs/argon2', 'pg', 'pg-native'];
const REQUIRED_EXTERNALS = ['@node-rs/argon2', 'pg'];

async function main(): Promise<void> {
  const standalone = join(root, '.next', 'standalone');
  if (!existsSync(standalone)) {
    throw new Error('No .next/standalone. Run `npm run build` first (output: standalone).');
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  cpSync(standalone, join(out, 'app'), { recursive: true });
  stripEnvFiles(join(out, 'app'));

  // Standalone omits both; without them every asset 404s.
  if (existsSync(join(root, 'public'))) {
    cpSync(join(root, 'public'), join(out, 'app', 'public'), { recursive: true });
  }
  cpSync(join(root, '.next', 'static'), join(out, 'app', '.next', 'static'), { recursive: true });

  await build({
    entryPoints: CLOUD_OPS_ENTRYPOINTS.map((entry) => join(root, entry)),
    // Inside app/, so bare imports resolve app/node_modules.
    outdir: join(out, 'app', 'bin'),
    outbase: join(root, 'scripts'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: EXTERNAL,
    alias: { 'server-only': join(root, 'tests', 'server-only-stub.ts') },
    logLevel: 'warning',
  });

  const missing = REQUIRED_EXTERNALS.filter(
    (name) => !existsSync(join(out, 'app', 'node_modules', name)),
  );
  if (missing.length > 0) {
    throw new Error(`Marked external but not in the standalone tree: ${missing.join(', ')}.`);
  }

  cpSync(join(root, 'src', 'db', 'migrations'), join(out, 'migrations'), { recursive: true });

  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      '--conditions=react-server',
      join(root, 'scripts', 'catalog', 'build-pack.ts'),
      '--out',
      join(out, 'catalog', 'starter.json'),
    ],
    { cwd: root, stdio: 'inherit' },
  );

  assertNoEnvFiles(join(out, 'app'));
  console.log(`\n  Cloud payload assembled at ${out}\n`);
}

main().catch((error: unknown) => {
  console.error(
    `\n  Cloud packaging failed:\n\n${error instanceof Error ? error.message : error}\n`,
  );
  process.exit(1);
});
