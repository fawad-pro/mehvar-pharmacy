/**
 * Chokepoint construction — the first half of Day 1's "chokepoint enforcement"
 * test, discharging Phase 12 §5's requirement that "a test asserts that no query
 * path constructs without tenant context".
 *
 * The second half — that a scoped query genuinely cannot see another tenant's
 * rows — needs a real database and lives in `scoped.integration.test.ts`.
 *
 * ADR-2 buys one-week delivery by putting tenant isolation in one module rather
 * than in the database. The price of that trade is that these two files are the
 * proof, and they are the reason the trade is honest.
 */

import { eq, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { MissingTenantContextError, TenantScope } from './scoped';
import { customers, products } from './schema';

const TENANT = '01890a5d-ac96-774b-bcce-b302099a8057';
const USER = '01890a5d-ac96-774b-bcce-b302099a8058';
const OTHER_TENANT = '01890a5d-ac96-774b-bcce-b302099a8059';

/** No query is executed in this file; the executor is never touched. */
const NO_EXECUTOR = {} as never;

function scope(tenantId = TENANT, userId = USER): TenantScope {
  return new TenantScope(NO_EXECUTOR, { tenantId, userId });
}

describe('a scope cannot be constructed without tenant context', () => {
  it('rejects a missing tenant id', () => {
    expect(() => scope('', USER)).toThrow(MissingTenantContextError);
  });

  it('rejects a missing acting user — attribution is not optional (T1)', () => {
    expect(() => scope(TENANT, '')).toThrow(MissingTenantContextError);
  });

  it('rejects a context that is absent entirely', () => {
    expect(
      () =>
        new TenantScope(NO_EXECUTOR, undefined as unknown as { tenantId: string; userId: string }),
    ).toThrow(MissingTenantContextError);
  });

  it('rejects values that merely look like identifiers', () => {
    // A slug, a name, or an empty-ish string are all things a careless caller
    // might pass. None of them is a tenant.
    expect(() => scope('demo', USER)).toThrow(MissingTenantContextError);
    expect(() => scope('   ', USER)).toThrow(MissingTenantContextError);
    expect(() => scope(TENANT, 'the-owner')).toThrow(MissingTenantContextError);
  });

  it('rejects non-string values', () => {
    expect(() => scope(null as unknown as string, USER)).toThrow(MissingTenantContextError);
    expect(() => scope(TENANT, 42 as unknown as string)).toThrow(MissingTenantContextError);
  });

  it('accepts a well-formed context', () => {
    const built = scope();
    expect(built.tenantId).toBe(TENANT);
    expect(built.userId).toBe(USER);
  });
});

describe('every predicate the scope builds carries its own tenant', () => {
  const dialect = new PgDialect();

  /** Compiles a predicate the way the driver would, and returns its bound values. */
  function boundValues(predicate: SQL): unknown[] {
    return dialect.sqlToQuery(predicate).params;
  }

  /** The compiled SQL text, for asserting the shape of the conjunction. */
  function compiled(predicate: SQL): string {
    return dialect.sqlToQuery(predicate).sql;
  }

  it('binds the scope tenant', () => {
    expect(boundValues(scope().scopeOf(products))).toContain(TENANT);
  });

  it('keeps two scopes over the same table separate', () => {
    const mine = scope(TENANT).scopeOf(customers);
    const theirs = scope(OTHER_TENANT).scopeOf(customers);

    expect(boundValues(mine)).toContain(TENANT);
    expect(boundValues(mine)).not.toContain(OTHER_TENANT);
    expect(boundValues(theirs)).toContain(OTHER_TENANT);
    expect(boundValues(theirs)).not.toContain(TENANT);
  });

  it('conjoins caller conditions rather than letting them replace the tenant filter', () => {
    const predicate = scope().scopeOf(products, eq(products.name, 'Panadol'));
    const values = boundValues(predicate);

    expect(values).toContain(TENANT);
    expect(values).toContain('Panadol');
    // Conjunction, not replacement: both predicates survive.
    expect(compiled(predicate)).toMatch(/tenant_id.*and.*name/is);
  });
});
