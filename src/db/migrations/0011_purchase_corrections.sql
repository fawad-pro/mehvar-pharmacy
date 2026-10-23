CREATE TABLE "purchase_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_line_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"qty_delta_base" integer DEFAULT 0 NOT NULL,
	"bonus_delta_base" integer DEFAULT 0 NOT NULL,
	"corrected_unit_cost_paisa" bigint,
	"effective_unit_cost_paisa" bigint NOT NULL,
	"invoice_delta_paisa" bigint NOT NULL,
	"note" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_corrections_changes_something" CHECK ("purchase_corrections"."qty_delta_base" <> 0 OR "purchase_corrections"."bonus_delta_base" <> 0 OR "purchase_corrections"."corrected_unit_cost_paisa" IS NOT NULL),
	CONSTRAINT "purchase_corrections_cost_nonneg" CHECK ("purchase_corrections"."corrected_unit_cost_paisa" IS NULL OR "purchase_corrections"."corrected_unit_cost_paisa" >= 0),
	CONSTRAINT "purchase_corrections_note_present" CHECK (length(trim("purchase_corrections"."note")) > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"qty_base" integer NOT NULL,
	"credit_paisa" bigint NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_returns_qty_positive" CHECK ("supplier_returns"."qty_base" > 0),
	CONSTRAINT "supplier_returns_credit_nonneg" CHECK ("supplier_returns"."credit_paisa" >= 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_corrections" ADD CONSTRAINT "purchase_corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_corrections" ADD CONSTRAINT "purchase_corrections_purchase_line_id_purchase_lines_id_fk" FOREIGN KEY ("purchase_line_id") REFERENCES "public"."purchase_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_corrections" ADD CONSTRAINT "purchase_corrections_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_corrections" ADD CONSTRAINT "purchase_corrections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_corrections_tenant_created_idx" ON "purchase_corrections" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_corrections_line_idx" ON "purchase_corrections" USING btree ("tenant_id","purchase_line_id");--> statement-breakpoint
CREATE INDEX "purchase_corrections_batch_idx" ON "purchase_corrections" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE INDEX "supplier_returns_tenant_created_idx" ON "supplier_returns" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_returns_tenant_supplier_idx" ON "supplier_returns" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_returns_batch_idx" ON "supplier_returns" USING btree ("tenant_id","batch_id");