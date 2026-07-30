ALTER TABLE "payments" ADD COLUMN "receipt_number" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_receipt_key" ON "payments" USING btree ("tenant_id","receipt_number");