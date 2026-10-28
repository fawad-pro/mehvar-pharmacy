ALTER TABLE "sale_lines" ADD COLUMN "invoice_discount_share_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_invoice_share_nonnegative" CHECK ("sale_lines"."invoice_discount_share_paisa" >= 0);--> statement-breakpoint
-- [PCN-014] Backfill: a sale written before shares were stored, with a bill
-- discount, gets its lines' shares by the same rule as
-- `invoiceDiscountShares` (domain/sales/sale-command.ts): in proportion to
-- each line's total after its item discount, floored, with the paisa left
-- over going to the largest remainders, ties to the line id that sorts first.
-- `invoice-discount-backfill.integration.test.ts` runs this statement and
-- requires the TypeScript's answer. Lines of a sale with no discount keep 0.
UPDATE "sale_lines" AS target
SET "invoice_discount_share_paisa" = ranked.floor_share
  + CASE WHEN ranked.place <= ranked.leftover THEN 1 ELSE 0 END
FROM (
  SELECT
    weighted.id,
    weighted.floor_share,
    weighted.discount - sum(weighted.floor_share) OVER (PARTITION BY weighted.sale_id) AS leftover,
    row_number() OVER (
      PARTITION BY weighted.sale_id
      ORDER BY weighted.remainder DESC, weighted.id::text ASC
    ) AS place
  FROM (
    SELECT
      totals.id,
      totals.sale_id,
      least(totals.invoice_discount, totals.base) AS discount,
      div(least(totals.invoice_discount, totals.base) * totals.line_total, totals.base) AS floor_share,
      mod(least(totals.invoice_discount, totals.base) * totals.line_total, totals.base) AS remainder
    FROM (
      SELECT
        line.id,
        line.sale_id,
        sale.invoice_discount_paisa::numeric AS invoice_discount,
        greatest(0, coalesce(line.line_amount_paisa, line.unit_price_paisa * line.qty_base)
          - line.line_discount_paisa)::numeric AS line_total,
        sum(greatest(0, coalesce(line.line_amount_paisa, line.unit_price_paisa * line.qty_base)
          - line.line_discount_paisa)) OVER (PARTITION BY line.sale_id)::numeric AS base
      FROM "sale_lines" AS line
      JOIN "sales" AS sale ON sale.id = line.sale_id
      WHERE sale.invoice_discount_paisa > 0
    ) AS totals
    WHERE totals.base > 0
  ) AS weighted
) AS ranked
WHERE target.id = ranked.id;
