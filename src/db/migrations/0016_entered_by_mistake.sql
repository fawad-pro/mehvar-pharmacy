ALTER TYPE "public"."adjustment_reason" ADD VALUE 'entered_by_mistake';--> statement-breakpoint
ALTER TABLE "adjustments" DROP CONSTRAINT "adjustments_reason_sign";--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_reason_sign" CHECK (("adjustments"."reason"::text IN ('damage', 'expiry_writeoff', 'distributor_return', 'entered_by_mistake') AND "adjustments"."qty_base_delta" < 0)
          OR ("adjustments"."reason"::text = 'opening_stock' AND "adjustments"."qty_base_delta" > 0)
          OR "adjustments"."reason"::text IN ('count_correction', 'product_replaced'));