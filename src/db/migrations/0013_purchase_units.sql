ALTER TABLE "purchase_corrections" DROP CONSTRAINT "purchase_corrections_changes_something";--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "cost_total_paisa" bigint;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "prices_at_receiving" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "mrp_paisa" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "mrp_unit_key" text;--> statement-breakpoint
ALTER TABLE "purchase_corrections" ADD COLUMN "corrected_unit_cost_paisa_entered" bigint;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "unit_key" text;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "unit_name" text;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "unit_count" integer;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "bonus_unit_count" integer;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "unit_cost_paisa_entered" bigint;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "line_cost_paisa" bigint;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD COLUMN "price_paisa_entered" bigint;--> statement-breakpoint
ALTER TABLE "purchase_corrections" ADD CONSTRAINT "purchase_corrections_changes_something" CHECK ("purchase_corrections"."qty_delta_base" <> 0 OR "purchase_corrections"."bonus_delta_base" <> 0 OR "purchase_corrections"."corrected_unit_cost_paisa" IS NOT NULL
          OR "purchase_corrections"."corrected_unit_cost_paisa_entered" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_entered_unit_complete" CHECK (("purchase_lines"."unit_count" IS NULL AND "purchase_lines"."bonus_unit_count" IS NULL AND "purchase_lines"."unit_cost_paisa_entered" IS NULL
           AND "purchase_lines"."line_cost_paisa" IS NULL AND "purchase_lines"."unit_name" IS NULL AND "purchase_lines"."unit_key" IS NULL
           AND "purchase_lines"."price_paisa_entered" IS NULL)
          OR ("purchase_lines"."unit_count" > 0 AND "purchase_lines"."bonus_unit_count" >= 0 AND "purchase_lines"."unit_cost_paisa_entered" >= 0
              AND "purchase_lines"."unit_name" IS NOT NULL AND "purchase_lines"."unit_key" IS NOT NULL AND "purchase_lines"."price_paisa_entered" > 0
              AND "purchase_lines"."line_cost_paisa" = "purchase_lines"."unit_count" * "purchase_lines"."unit_cost_paisa_entered"
              AND "purchase_lines"."qty_base" % "purchase_lines"."unit_count" = 0
              AND "purchase_lines"."bonus_qty_base" * "purchase_lines"."unit_count" = "purchase_lines"."bonus_unit_count" * "purchase_lines"."qty_base"));