ALTER TABLE "payments" DROP CONSTRAINT "payments_amount_positive";--> statement-breakpoint
ALTER TABLE "supplier_payments" DROP CONSTRAINT "supplier_payments_amount_positive";--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "reverses_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reverses_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD COLUMN "reverses_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_reverses_id_cash_movements_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."cash_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_id_payments_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_reverses_id_supplier_payments_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."supplier_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_movements_tenant_reverses_key" ON "cash_movements" USING btree ("tenant_id","reverses_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_reverses_key" ON "payments" USING btree ("tenant_id","reverses_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_payments_tenant_reverses_key" ON "supplier_payments" USING btree ("tenant_id","reverses_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_signed" CHECK (("payments"."reverses_id" IS NULL AND "payments"."amount_paisa" > 0) OR ("payments"."reverses_id" IS NOT NULL AND "payments"."amount_paisa" < 0));--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_signed" CHECK (("supplier_payments"."reverses_id" IS NULL AND "supplier_payments"."amount_paisa" > 0) OR ("supplier_payments"."reverses_id" IS NOT NULL AND "supplier_payments"."amount_paisa" < 0));