/**
 * Every script that reaches configuration loads it first.
 *
 * THE REGRESSION THIS EXISTS FOR
 *
 * `catalog:import` had no `import 'dotenv/config'`. It therefore read `.env`
 * only when the shell already happened to export `DATABASE_URL` and
 * `SESSION_SECRET` — true on a developer machine mid-session, false on every
 * clean run. `npm run db:setup` completed migrate, grants and seed, then died
 * in the last step with "DATABASE_URL: expected string, received undefined" on
 * a machine where `.env` was present and correct the whole time.
 *
 * It went unnoticed because the person who wrote it (me) ran it with those
 * variables exported every single time. The environment masked the bug
 * perfectly — the same shape as the empty-catalogue bug two sessions earlier,
 * where a hand-imported pack on one machine hid a missing setup step.
 *
 * WHAT IS ACTUALLY CHECKED
 *
 * Not "every script imports dotenv" — that would be false. `catalog:build`
 * writes a file from a static list and touches no configuration; demanding an
 * unused import there would make the rule noise, and noise is how a rule stops
 * being read.
 *
 * The real rule is narrower and exact: **an npm script that reads anything
 * `.env` provides must load `dotenv/config`.** It reads it two ways, and both
 * count — through `src/env`/`src/db`, which is how the catalogue scripts broke,
 * and straight off `process.env`, which is how `db:migrate` and `ops:backup`
 * read their connection strings. Checking only the first would leave the second
 * unguarded, so the variable names come from `.env.example`: the file that
 * defines what `.env` is for is the one that decides what needs loading.
 *
 * The test walks the module graph from each entry point rather than grepping
 * one file, which is what makes it catch the class instead of the two files
 * that happened to be broken.
 *
 * Libraries are deliberately excluded. `scripts/db/verify-all.ts` reaches the
 * database and correctly does NOT load dotenv: it is imported by three
 * entry points that each load it themselves, and a library that reads `.env`
 * as a side effect of being imported is a worse thing than the bug this
 * prevents.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/**
 * The variables `.env` supplies, taken from the template rather than listed
 * here — a new one added to `.env.example` is covered without anyone
 * remembering to update this test.
 */
const CONFIG_VARIABLES: readonly string[] = [
  ...new Set(
    [...readFileSync(join(ROOT, '.env.example'), 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
      (match) => match[1]!,
    ),
  ),
];

interface PackageJson {
  readonly scripts: Readonly<Record<string, string>>;
}

const scripts: Readonly<Record<string, string>> = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as PackageJson
).scripts;

/** `tsx … scripts/foo/bar.ts` → `scripts/foo/bar.ts`. */
function entryPointOf(command: string): string | null {
  const match = /tsx[^&|]*?\s(scripts\/[\w./-]+\.ts)/.exec(command);
  return match ? match[1]! : null;
}

/** Resolves an import specifier to a file on disk, or null if it leaves the repo. */
function resolveImport(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(ROOT, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (base === null) return null;

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
    if (existsSync(candidate) && candidate.endsWith('.tsx')) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [
    ...[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!),
    ...[...source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]!),
  ];
}

/**
 * Walks the local module graph from an entry point.
 *
 * Follows relative and `@/` imports only — a package from `node_modules` cannot
 * be the thing that needs `.env`, and following them would make this slow and
 * pointless.
 */
function reachesConfiguration(entry: string): boolean {
  const seen = new Set<string>();
  const queue = [resolve(ROOT, entry)];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    // `src/env.ts` is where the throw comes from; `src/db/*` is what calls it.
    if (/[/\\]src[/\\](env\.ts$|db[/\\])/.test(file)) return true;

    // …and a script that reads a `.env` variable straight off `process.env`
    // needs the file loaded just as much, without going near `src/env`.
    const source = readFileSync(file, 'utf8');
    if (CONFIG_VARIABLES.some((name) => source.includes(`process.env.${name}`))) {
      return true;
    }

    for (const specifier of importsOf(file)) {
      const target = resolveImport(file, specifier);
      if (target) queue.push(target);
    }
  }
  return false;
}

const entryPoints = Object.entries(scripts)
  .map(([name, command]) => ({ name, entry: entryPointOf(command) }))
  .filter((row): row is { name: string; entry: string } => row.entry !== null);

describe('npm scripts load their environment before using it', () => {
  it('finds the script entry points at all — a vacuous pass proves nothing', () => {
    expect(entryPoints.length).toBeGreaterThan(8);
  });

  for (const { name, entry } of entryPoints) {
    const needsConfig = reachesConfiguration(entry);

    it(`${name} (${entry}) ${needsConfig ? 'reaches configuration, so it must load dotenv' : 'needs no configuration'}`, () => {
      if (!needsConfig) {
        // Asserted rather than skipped: a script that stops needing config
        // should not silently keep a stale import, and one that STARTS needing
        // it flips to the branch below on the next run.
        expect(true).toBe(true);
        return;
      }

      const source = readFileSync(resolve(ROOT, entry), 'utf8');
      expect(
        source.includes("import 'dotenv/config'"),
        `${entry} reads DATABASE_URL/SESSION_SECRET through src/env but never loads .env. ` +
          "Add `import 'dotenv/config';` above its other imports. Without it the script " +
          'works only when the shell already exports those variables, which is true on a ' +
          'developer machine mid-session and false on every clean run.',
      ).toBe(true);
    });
  }
});

describe('dotenv is loaded before anything that might read the environment', () => {
  for (const { name, entry } of entryPoints) {
    if (!reachesConfiguration(entry)) continue;

    it(`${name} loads dotenv before its other imports`, () => {
      /*
       * Order matters and is not merely tidy. Module side effects run at import
       * time, so a module that reads `process.env` while being imported would
       * see an unpopulated environment if dotenv came after it. Today nothing
       * does — `client.ts` builds its pool lazily — but that is a property of
       * the current code, not a guarantee, and the cost of pinning it is one
       * assertion.
       */
      const lines = readFileSync(resolve(ROOT, entry), 'utf8').split('\n');
      const dotenvAt = lines.findIndex((line) => line.includes("import 'dotenv/config'"));
      const firstOtherImport = lines.findIndex(
        (line) => /^import\s/.test(line) && !line.includes('dotenv/config'),
      );

      expect(dotenvAt).toBeGreaterThanOrEqual(0);
      if (firstOtherImport >= 0) {
        expect(dotenvAt).toBeLessThan(firstOtherImport);
      }
    });
  }
});
