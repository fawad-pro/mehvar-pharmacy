CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"amount_paisa" bigint NOT NULL,
	"method" "payment_method" DEFAULT 'cash' NOT NULL,
	"purchase_id" uuid,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_payments_amount_positive" CHECK ("supplier_payments"."amount_paisa" > 0)
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "cash_paid_paisa" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_payments_tenant_created_idx" ON "supplier_payments" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_payments_tenant_supplier_idx" ON "supplier_payments" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchases_tenant_supplier_idx" ON "purchases" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_cash_paid_nonneg" CHECK ("purchases"."cash_paid_paisa" >= 0);