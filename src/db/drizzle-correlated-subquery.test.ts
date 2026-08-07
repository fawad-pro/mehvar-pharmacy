/**
 * When Drizzle qualifies an interpolated column, and when it does not.
 *
 * CLAUDE.md carries a rule from Day 3: "Never build a verifier query with a
 * correlated `sql` subquery. Drizzle renders the interpolated outer column
 * unqualified, and it resolves silently against the inner table."
 *
 * That is true, but only under a condition the rule does not name — and the
 * missing condition makes the rule dangerous in an unusual way. A correlated
 * subquery written inside a query that HAS A JOIN renders correctly and passes
 * every test you point at it. Someone checking the rule that way would conclude
 * it was folklore and start using correlated subqueries freely; the next one
 * they write in a single-table query would then be silently wrong, which is
 * exactly the Day 3 failure again.
 *
 * So the behaviour is pinned here, both branches, in the query builder's own
 * terms. This test asserts on rendered SQL rather than on results because the
 * whole hazard is that both versions RUN — one just answers wrongly.
 *
 * The practical rule this supports, stated properly:
 *
 *   A correlated `sql` subquery is only correct while its outer query keeps a
 *   join. Nothing enforces that, a future edit can remove it, and the failure
 *   is silent. Prefer a grouped aggregate, which depends on nothing but itself.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { customers, saleReturns, sales } from './schema';

// No connection is made — `toSQL()` only renders.
const db = drizzle({} as never);

const correlated = sql<number>`(select count(*) from ${saleReturns} where ${saleReturns.saleId} = ${sales.id})`;

describe('correlated sql subqueries in Drizzle', () => {
  it('renders BOTH columns unqualified when the outer query is a single table', () => {
    const { sql: rendered } = db.select({ id: sales.id, n: correlated }).from(sales).toSQL();

    // `"sale_id" = "id"` — inside the subquery both names bind to
    // `sale_returns`, so this compares a return's sale_id to its own id and
    // counts zero, for every row, forever. Postgres raises nothing: both
    // columns exist on the inner table.
    expect(rendered).toContain('where "sale_id" = "id"');
    expect(rendered).not.toContain('"sales"."id"');
  });

  it('qualifies both columns as soon as the outer query has a join', () => {
    const { sql: rendered } = db
      .select({ id: sales.id, n: correlated })
      .from(sales)
      .leftJoin(customers, eq(sales.customerId, customers.id))
      .toSQL();

    // The same expression, now correct — which is why the rule cannot be
    // checked by writing one example and observing that it works.
    expect(rendered).toContain('where "sale_returns"."sale_id" = "sales"."id"');
  });

  it('differs between the two forms, which is the entire hazard', () => {
    const single = db.select({ id: sales.id, n: correlated }).from(sales).toSQL().sql;
    const joined = db
      .select({ id: sales.id, n: correlated })
      .from(sales)
      .leftJoin(customers, eq(sales.customerId, customers.id))
      .toSQL().sql;

    // One source expression, two meanings, decided by something written
    // elsewhere in the statement.
    expect(single).not.toEqual(joined);
  });
});
