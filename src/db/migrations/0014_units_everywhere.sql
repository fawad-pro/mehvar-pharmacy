ALTER TYPE "public"."adjustment_reason" ADD VALUE 'product_replaced';--> statement-breakpoint
ALTER TABLE "adjustments" DROP CONSTRAINT "adjustments_reason_sign";--> statement-breakpoint
ALTER TABLE "adjustments" ADD COLUMN "unit_key" text;--> statement-breakpoint
ALTER TABLE "adjustments" ADD COLUMN "unit_name" text;--> statement-breakpoint
ALTER TABLE "adjustments" ADD COLUMN "unit_count" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "replaced_by_product_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD COLUMN "unit_key" text;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD COLUMN "unit_name" text;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD COLUMN "unit_count" integer;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN "unit_key" text;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN "unit_name" text;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN "unit_count" integer;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_entered_unit_complete" CHECK (("adjustments"."unit_count" IS NULL AND "adjustments"."unit_name" IS NULL AND "adjustments"."unit_key" IS NULL)
          OR ("adjustments"."unit_count" > 0 AND "adjustments"."unit_name" IS NOT NULL AND "adjustments"."unit_key" IS NOT NULL
              AND abs("adjustments"."qty_base_delta") % "adjustments"."unit_count" = 0));--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_reason_sign" CHECK (("adjustments"."reason"::text IN ('damage', 'expiry_writeoff', 'distributor_return') AND "adjustments"."qty_base_delta" < 0)
          OR ("adjustments"."reason"::text = 'opening_stock' AND "adjustments"."qty_base_delta" > 0)
          OR "adjustments"."reason"::text IN ('count_correction', 'product_replaced'));--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_entered_unit_complete" CHECK (("sale_return_lines"."unit_count" IS NULL AND "sale_return_lines"."unit_name" IS NULL AND "sale_return_lines"."unit_key" IS NULL)
          OR ("sale_return_lines"."unit_count" > 0 AND "sale_return_lines"."unit_name" IS NOT NULL AND "sale_return_lines"."unit_key" IS NOT NULL
              AND "sale_return_lines"."qty_base" % "sale_return_lines"."unit_count" = 0));--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_entered_unit_complete" CHECK (("supplier_returns"."unit_count" IS NULL AND "supplier_returns"."unit_name" IS NULL AND "supplier_returns"."unit_key" IS NULL)
          OR ("supplier_returns"."unit_count" > 0 AND "supplier_returns"."unit_name" IS NOT NULL AND "supplier_returns"."unit_key" IS NOT NULL
              AND "supplier_returns"."qty_base" % "supplier_returns"."unit_count" = 0));