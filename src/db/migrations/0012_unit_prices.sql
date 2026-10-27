ALTER TABLE "products" ADD COLUMN "units" jsonb;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "unit_key" text;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "unit_name" text;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "unit_count" integer;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "unit_price_paisa_entered" bigint;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "line_amount_paisa" bigint;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_entered_unit_complete" CHECK (("sale_lines"."unit_count" IS NULL AND "sale_lines"."unit_price_paisa_entered" IS NULL AND "sale_lines"."line_amount_paisa" IS NULL AND "sale_lines"."unit_name" IS NULL)
          OR ("sale_lines"."unit_count" > 0 AND "sale_lines"."unit_price_paisa_entered" >= 0 AND "sale_lines"."unit_name" IS NOT NULL
              AND "sale_lines"."line_amount_paisa" = "sale_lines"."unit_count" * "sale_lines"."unit_price_paisa_entered"
              AND "sale_lines"."qty_base" % "sale_lines"."unit_count" = 0));