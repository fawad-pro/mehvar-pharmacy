ALTER TABLE "product_barcodes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "product_barcodes_tenant_updated_idx" ON "product_barcodes" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE INDEX "products_tenant_updated_idx" ON "products" USING btree ("tenant_id","updated_at");