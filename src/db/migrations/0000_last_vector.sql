CREATE TYPE "public"."adjustment_reason" AS ENUM('damage', 'expiry_writeoff', 'distributor_return', 'count_correction', 'opening_stock');--> statement-breakpoint
CREATE TYPE "public"."batch_source" AS ENUM('purchase_line', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."cash_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."cash_reason" AS ENUM('opening_float', 'owner_withdrawal', 'expense', 'over_short');--> statement-breakpoint
CREATE TYPE "public"."catalog_quality" AS ENUM('verified', 'reference');--> statement-breakpoint
CREATE TYPE "public"."catalog_source" AS ENUM('drap_seed', 'curated', 'promoted');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."proposal_type" AS ENUM('barcode', 'new_product', 'mrp_signal');--> statement-breakpoint
CREATE TYPE "public"."sale_origin" AS ENUM('online', 'offline_sync');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('device', 'owner_remote');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'salesman');--> statement-breakpoint
CREATE TABLE "adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty_base_delta" integer NOT NULL,
	"reason" "adjustment_reason" NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjustments_delta_nonzero" CHECK ("adjustments"."qty_base_delta" <> 0),
	CONSTRAINT "adjustments_reason_sign" CHECK (("adjustments"."reason" IN ('damage', 'expiry_writeoff', 'distributor_return') AND "adjustments"."qty_base_delta" < 0)
          OR ("adjustments"."reason" = 'opening_stock' AND "adjustments"."qty_base_delta" > 0)
          OR "adjustments"."reason" = 'count_correction')
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"source" "batch_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"batch_number" text,
	"expiry_date" date,
	"unit_cost_paisa" bigint NOT NULL,
	"price_per_base_unit_paisa" bigint NOT NULL,
	"qty_received_base" integer NOT NULL,
	"qty_remaining_base" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_qty_remaining_nonneg" CHECK ("batches"."qty_remaining_base" >= 0),
	CONSTRAINT "batches_qty_received_positive" CHECK ("batches"."qty_received_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" "cash_direction" NOT NULL,
	"amount_paisa" bigint NOT NULL,
	"reason" "cash_reason" NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movements_amount_positive" CHECK ("cash_movements"."amount_paisa" > 0)
);
--> statement-breakpoint
CREATE TABLE "catalog_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "proposal_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"receipt_prefix" text NOT NULL,
	"pairing_key_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_barcodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"global_product_id" uuid NOT NULL,
	"barcode" text NOT NULL,
	"unit_level_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"manufacturer" text,
	"formula_text" text,
	"form" text,
	"strength" text,
	"pack_levels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reference_mrp_paisa" bigint,
	"quality" "catalog_quality" NOT NULL,
	"source" "catalog_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount_paisa" bigint NOT NULL,
	"method" "payment_method" DEFAULT 'cash' NOT NULL,
	"sale_id" uuid,
	"origin" "sale_origin" NOT NULL,
	"client_schema_version" integer NOT NULL,
	"client_committed_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_paisa" > 0)
);
--> statement-breakpoint
CREATE TABLE "product_barcodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"barcode" text NOT NULL,
	"unit_level_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"global_product_id" uuid,
	"name" text NOT NULL,
	"manufacturer" text,
	"form" text,
	"strength" text,
	"formula_text" text,
	"base_unit_name" text NOT NULL,
	"pack_levels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_price_per_base_unit" bigint NOT NULL,
	"current_mrp_per_base_unit" bigint,
	"min_stock_base_units" integer,
	"needs_completion" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_base" integer NOT NULL,
	"bonus_qty_base" integer DEFAULT 0 NOT NULL,
	"unit_cost_paisa" bigint NOT NULL,
	"expiry_date" date,
	"batch_number" text,
	"mrp_at_receiving_paisa" bigint,
	"price_at_receiving_paisa" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_lines_qty_positive" CHECK ("purchase_lines"."qty_base" > 0),
	CONSTRAINT "purchase_lines_bonus_nonneg" CHECK ("purchase_lines"."bonus_qty_base" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid,
	"invoice_ref" text,
	"invoice_date" date,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_line_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"batch_id" uuid,
	"qty_base" integer NOT NULL,
	"unit_cost_paisa" bigint,
	"resolved_by_purchase_line_id" uuid,
	"resolved_by_adjustment_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocations_qty_positive" CHECK ("sale_line_allocations"."qty_base" > 0),
	CONSTRAINT "allocations_single_resolver" CHECK (num_nonnulls("sale_line_allocations"."resolved_by_purchase_line_id", "sale_line_allocations"."resolved_by_adjustment_id") <= 1),
	CONSTRAINT "allocations_pending_has_no_cost" CHECK ("sale_line_allocations"."batch_id" IS NOT NULL OR "sale_line_allocations"."unit_cost_paisa" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"qty_base" integer NOT NULL,
	"entered_unit_level" text NOT NULL,
	"unit_price_paisa" bigint NOT NULL,
	"line_discount_paisa" bigint DEFAULT 0 NOT NULL,
	"price_overridden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_lines_qty_positive" CHECK ("sale_lines"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_return_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_return_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"qty_base" integer NOT NULL,
	"restock_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_return_lines_qty_positive" CHECK ("sale_return_lines"."qty_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"cash_out_paisa" bigint DEFAULT 0 NOT NULL,
	"credit_reduced_paisa" bigint DEFAULT 0 NOT NULL,
	"reason_note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"customer_id" uuid,
	"subtotal_paisa" bigint NOT NULL,
	"invoice_discount_paisa" bigint DEFAULT 0 NOT NULL,
	"total_paisa" bigint NOT NULL,
	"cash_paisa" bigint DEFAULT 0 NOT NULL,
	"credit_paisa" bigint DEFAULT 0 NOT NULL,
	"change_paisa" bigint DEFAULT 0 NOT NULL,
	"origin" "sale_origin" NOT NULL,
	"client_schema_version" integer NOT NULL,
	"client_committed_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_split_equals_total" CHECK ("sales"."cash_paisa" + "sales"."credit_paisa" = "sales"."total_paisa"),
	CONSTRAINT "sales_credit_requires_customer" CHECK ("sales"."credit_paisa" = 0 OR "sales"."customer_id" IS NOT NULL),
	CONSTRAINT "sales_total_is_subtotal_less_discount" CHECK ("sales"."total_paisa" = "sales"."subtotal_paisa" - "sales"."invoice_discount_paisa")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "session_kind" NOT NULL,
	"device_id" uuid,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"pin_hash" text NOT NULL,
	"password_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_pin_attempts" integer DEFAULT 0 NOT NULL,
	"pin_locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_proposals" ADD CONSTRAINT "catalog_proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_barcodes" ADD CONSTRAINT "global_barcodes_global_product_id_global_products_id_fk" FOREIGN KEY ("global_product_id") REFERENCES "public"."global_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_global_product_id_global_products_id_fk" FOREIGN KEY ("global_product_id") REFERENCES "public"."global_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_allocations" ADD CONSTRAINT "sale_line_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_allocations" ADD CONSTRAINT "sale_line_allocations_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_allocations" ADD CONSTRAINT "sale_line_allocations_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_allocations" ADD CONSTRAINT "sale_line_allocations_resolved_by_purchase_line_id_purchase_lines_id_fk" FOREIGN KEY ("resolved_by_purchase_line_id") REFERENCES "public"."purchase_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_allocations" ADD CONSTRAINT "sale_line_allocations_resolved_by_adjustment_id_adjustments_id_fk" FOREIGN KEY ("resolved_by_adjustment_id") REFERENCES "public"."adjustments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_return_id_sale_returns_id_fk" FOREIGN KEY ("sale_return_id") REFERENCES "public"."sale_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_restock_batch_id_batches_id_fk" FOREIGN KEY ("restock_batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustments_tenant_created_idx" ON "adjustments" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "adjustments_product_idx" ON "adjustments" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "batches_fefo_idx" ON "batches" USING btree ("tenant_id","product_id","expiry_date");--> statement-breakpoint
CREATE INDEX "batches_tenant_created_idx" ON "batches" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "cash_movements_tenant_created_idx" ON "cash_movements" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_proposals_status_idx" ON "catalog_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "customers_tenant_idx" ON "customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_name_idx" ON "customers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_tenant_prefix_key" ON "devices" USING btree ("tenant_id","receipt_prefix");--> statement-breakpoint
CREATE INDEX "devices_tenant_idx" ON "devices" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "global_barcodes_barcode_key" ON "global_barcodes" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "payments_tenant_created_idx" ON "payments" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_tenant_customer_idx" ON "payments" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_barcodes_tenant_barcode_key" ON "product_barcodes" USING btree ("tenant_id","barcode");--> statement-breakpoint
CREATE INDEX "product_barcodes_product_idx" ON "product_barcodes" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "products_tenant_idx" ON "products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "products_tenant_name_idx" ON "products" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "products_needs_completion_idx" ON "products" USING btree ("tenant_id") WHERE "products"."needs_completion";--> statement-breakpoint
CREATE INDEX "purchase_lines_purchase_idx" ON "purchase_lines" USING btree ("tenant_id","purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_lines_tenant_created_idx" ON "purchase_lines" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "purchases_tenant_created_idx" ON "purchases" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "allocations_sale_line_idx" ON "sale_line_allocations" USING btree ("tenant_id","sale_line_id");--> statement-breakpoint
CREATE INDEX "allocations_batch_idx" ON "sale_line_allocations" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "allocations_pending_idx" ON "sale_line_allocations" USING btree ("tenant_id") WHERE "sale_line_allocations"."batch_id" IS NULL AND "sale_line_allocations"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sale_lines_sale_idx" ON "sale_lines" USING btree ("tenant_id","sale_id");--> statement-breakpoint
CREATE INDEX "sale_lines_tenant_created_idx" ON "sale_lines" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sale_return_lines_return_idx" ON "sale_return_lines" USING btree ("tenant_id","sale_return_id");--> statement-breakpoint
CREATE INDEX "sale_returns_tenant_created_idx" ON "sale_returns" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tenant_receipt_key" ON "sales" USING btree ("tenant_id","receipt_number");--> statement-breakpoint
CREATE INDEX "sales_tenant_created_idx" ON "sales" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_tenant_customer_idx" ON "sales" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "sessions_tenant_idx" ON "sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_idx" ON "suppliers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_name_key" ON "users" USING btree ("tenant_id","name");