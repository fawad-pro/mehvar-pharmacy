/**
 * The licence gate reaches the right places, and only the right places.
 *
 * Two source-level sweeps and one behavioural assertion, because the two
 * failures this guards are both invisible at runtime:
 *
 *  1. A **new** action that writes something off the sale path and nobody
 *     remembers the gate. The polarity below is what matters: an action either
 *     calls `requireCapability` or appears in `SALE_PATH_EXEMPT` with a reason
 *     somebody typed. A new action therefore defaults to needing a decision.
 *     The inverse — an allowlist of gated actions — silently defaults new code
 *     to ungated, which is this project's third-repeat failure mode.
 *
 *  2. A gate that reaches an **ADR-3 record kind** (Invariant L1). This is the
 *     one that would actually ship: `createQuickItem` lives in
 *     `domain/catalog/writers.ts`, so a gate written against "catalogue writes"
 *     breaks W6's unknown-medicine escape hatch — and because `ingestBatch`
 *     stops at the first non-synced outcome, it strands every offline sale
 *     queued behind that quick item, permanently. A P2 violation one
 *     indirection from where anyone would look for it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALWAYS_PERMITTED, permits } from '../src/domain/licensing/capabilities';

const SRC = join(process.cwd(), 'src');
const COUNTER_DIR = join(SRC, 'app', '(counter)');

/** Calls that reach the database to change something. Mirrors revalidate.test.ts. */
const WRITER =
  /\b(commit[A-Z]\w*|insert[A-Z]\w*|update[A-Z]\w*|create[A-Z]\w*|setUserActive|resetUserPin|removeBarcode|setProductActive)\s*\(/;

/**
 * Writing actions that are deliberately ungated, each with the reason.
 *
 * Every entry here is a decision somebody made on purpose. Adding one is
 * supposed to feel like a decision, which is the whole point of the polarity.
 */
const SALE_PATH_EXEMPT = new Map<string, string>([
  [
    'sync/actions.ts',
    'Invariant L1: the outbox delivers the four ADR-3 record kinds. Gating this ' +
      'strands captured sales in the browser forever — P2, non-negotiable.',
  ],
  ['sale/actions.ts', 'The sale path. P2: the counter never waits for a billing question.'],
  [
    'customers/actions.ts',
    'Invariant L1: `customer` is an ADR-3 record kind, written here and by the outbox.',
  ],
  [
    'products/actions.ts',
    'Invariant L1: W6 quick items are products, and a quick item is what keeps an ' +
      'unknown medicine from blocking a sale. Editing a tenant product is also not ' +
      'one of the four capabilities PCN-005 withholds.',
  ],
  [
    'returns/actions.ts',
    'A return is a money event on the counter (W4) and prints a receipt (T5). ' +
      'PCN-005 withholds nothing that a customer is standing in front of.',
  ],
  [
    'day/actions.ts',
    'Day close is reporting plus a cash movement the owner just counted. Reports ' +
      'go read-only in the UI under `restricted`; the drawer ritual is not one of ' +
      'the four withheld capabilities.',
  ],
  [
    'settings/actions.ts',
    'Invariant L4: the licence is pasted here. A bad licence must never lock the ' +
      'owner out of the screen where licences are fixed.',
  ],
]);

function actionFiles(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      found.push(...actionFiles(full, relative));
      continue;
    }
    if (entry === 'actions.ts') found.push(relative);
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

describe('every writing action gates, or says why it does not', () => {
  const files = actionFiles(COUNTER_DIR);

  it('finds the action files at all — a passing empty suite proves nothing', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const relative of files) {
    const source = readFileSync(join(COUNTER_DIR, relative), 'utf8');
    if (!source.includes("'use server'") || !WRITER.test(source)) continue;

    it(`${relative} calls requireCapability or is declared exempt`, () => {
      const gated = source.includes('requireCapability');
      const exempt = SALE_PATH_EXEMPT.has(relative);

      if (!gated && !exempt) {
        throw new Error(
          `${relative} writes but neither calls requireCapability nor appears in ` +
            'SALE_PATH_EXEMPT. If it belongs on the sale path, add it there with a ' +
            'reason; if it does not, gate it. Silence is the one answer that is wrong.',
        );
      }
      expect(gated || exempt).toBe(true);
    });
  }

  it('has no stale exemptions — every entry names a file that exists', () => {
    for (const relative of SALE_PATH_EXEMPT.keys()) {
      expect(files, `${relative} is exempt but no longer exists`).toContain(relative);
    }
  });
});

describe('Invariant L1 — the ADR-3 record kinds are ungated by kind, not by module', () => {
  /**
   * The writers behind the four kinds, wherever they live. `createQuickItem`
   * and `createCustomerWithId` sit in `domain/catalog` and `domain/udhaar`
   * rather than anywhere that looks like "the sale path", which is exactly why
   * this is asserted by kind.
   */
  const KIND_WRITERS = [
    'src/domain/sales/commit-sale.ts',
    'src/domain/udhaar/commit-settlement.ts',
    'src/domain/catalog/writers.ts',
    'src/domain/sync/ingest.ts',
  ];

  for (const relative of KIND_WRITERS) {
    it(`${relative} contains no licence check`, () => {
      const source = readFileSync(join(process.cwd(), relative), 'utf8');
      expect(source).not.toMatch(/requireCapability|installationPermits|licence\.tier/);
    });
  }

  it('no domain writer anywhere imports the gate', () => {
    // domain/ is pure business logic. A licence check appearing there would
    // mean an offline sale had started meaning something different from an
    // online one — Day 5's rule, and the same guarantee.
    const offenders = sourceFiles(join(SRC, 'domain'))
      .filter((file) => /requireCapability|@\/auth\/capabilities/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(`${process.cwd()}/`, ''));
    expect(offenders).toEqual([]);
  });
});

describe('the three unconditional capabilities', () => {
  it('are permitted in every tier, including restricted', () => {
    for (const tier of ['full', 'full_notice', 'restricted'] as const) {
      for (const capability of ALWAYS_PERMITTED) {
        expect(permits(tier, capability), `${capability} must survive ${tier}`).toBe(true);
      }
    }
  });

  it('export is one of them — T3, and Phase 3 §3 in so many words', () => {
    expect(ALWAYS_PERMITTED).toContain('export');
  });

  it('the export route has no licence check', () => {
    const source = readFileSync(join(SRC, 'app', 'api', 'export', 'route.ts'), 'utf8');
    expect(source).not.toMatch(/requireCapability|licence/i);
  });
});
