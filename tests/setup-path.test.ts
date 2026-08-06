/**
 * The supported setup path installs everything the application needs to run.
 *
 * THE REGRESSION THIS EXISTS FOR
 *
 * `db:setup` ran migrate, grants and seed. It did not load the medicine
 * catalogue, so every fresh install had an empty `global_products` and the Add
 * Product picker answered "Nothing in the catalogue matches" to every query
 * ever typed. The Windows installer loaded it; the developer path never did.
 *
 * Every other test passed. They had to: each one supplies its own catalogue
 * fixture and then queries it, which proves the query works and says nothing
 * whatsoever about whether a real user's catalogue is ever populated. That gap
 * — a green component with a broken path to it — is the third time in this
 * project's history the same mistake has shipped, so it gets a test aimed
 * directly at the path rather than at the components.
 *
 * WHY THIS IS A SOURCE-LEVEL CHECK
 *
 * The honest alternative is to run `npm run db:setup` against a scratch
 * database inside the suite. That is slow, needs a superuser, and fails for
 * reasons unrelated to what is being asserted. What actually broke was a
 * missing stage in a chain — a fact visible in `package.json` — and a test that
 * reads the chain catches a re-omission immediately, on every run, with no
 * database at all.
 *
 * It cannot prove the stages work. Everything else in the suite does that. This
 * proves they are all *wired in*, which is the part nothing was checking.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

interface PackageJson {
  readonly scripts: Readonly<Record<string, string>>;
}

const scripts: Readonly<Record<string, string>> = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as PackageJson
).scripts;

/** Every npm script a chain refers to, in order. */
function stagesOf(chain: string): string[] {
  return [...chain.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1]!);
}

describe('db:setup — the one command a fresh install runs', () => {
  const setup = scripts['db:setup'];

  it('exists, because the README tells people to run it', () => {
    expect(setup).toBeDefined();
  });

  /*
   * Each stage named individually so a failure says WHICH one went missing.
   * "db:setup is wrong" sends someone to read a file; "db:setup no longer
   * loads the medicine catalogue" sends them to the answer.
   */
  const required: [stage: string, why: string][] = [
    ['db:migrate', 'the schema would not exist'],
    ['db:grants', 'the application role would not exist — Postgres reports that as an auth failure'],
    ['db:seed', 'there would be no demo pharmacy to log into'],
    ['catalog:seed', 'the Add Product picker would find nothing, for every query, forever'],
  ];

  for (const [stage, why] of required) {
    it(`runs ${stage}, or ${why}`, () => {
      expect(stagesOf(setup ?? '')).toContain(stage);
    });
  }

  it('migrates before granting, and grants before seeding', () => {
    // Not independent steps in any order: grants CREATES the role that seed
    // connects as, and both need the tables migrate makes.
    const order = stagesOf(setup ?? '');
    expect(order.indexOf('db:migrate')).toBeLessThan(order.indexOf('db:grants'));
    expect(order.indexOf('db:grants')).toBeLessThan(order.indexOf('db:seed'));
  });
});

describe('catalog:seed — how the bundled catalogue actually arrives', () => {
  const chain = scripts['catalog:seed'] ?? '';

  it('builds the pack from the seed list and then imports it', () => {
    // Built rather than committed, so it cannot drift from its source; and
    // imported, which is the half that was missing.
    expect(stagesOf(chain)).toEqual(['catalog:build', 'catalog:import']);
  });

  it('imports the file it just built, not some other path', () => {
    // Two paths that must agree. If they diverge the import silently reads a
    // stale pack, or fails on a file that was never written.
    const paths = [...chain.matchAll(/dist\/catalog\/[\w.-]+/g)].map((match) => match[0]);
    expect(paths.length).toBe(2);
    expect(new Set(paths).size).toBe(1);
  });
});

describe('the paths that must not drift from db:setup', () => {
  it('e2e:reset uses db:setup rather than restating its stages', () => {
    // It used to spell the chain out, which is how it would come to be missing
    // a stage that db:setup has — the E2E suite then runs against a database
    // unlike any real one.
    expect(stagesOf(scripts['e2e:reset'] ?? '')).toContain('db:setup');
  });

  it('the README tells people to run db:setup', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(readme).toContain('npm run db:setup');
  });
});
