-- Signed revocations (Stage 2): a founder-signed statement that a licence is no
-- longer valid, delivered by the refresh endpoint and honoured immediately.
--
-- In EVENT_TABLES, which is the point: `db:grants` gives the app role SELECT and
-- INSERT and explicitly REVOKEs UPDATE and DELETE. A revocation is a record of
-- something that happened; it is corrected only by a superseding signed
-- statement, never erased. The token is stored verbatim and re-verified against
-- the trust root at read time — the columns are a query convenience.
--
-- **Run `npm run db:grants` after this migration.** A new table starts fully
-- mutable until granted, which would make the append-only claim decorative.
--
-- Additive-safe, per Phase 12 §2: one new table, nothing dropped or backfilled.

CREATE TABLE "revocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token" text NOT NULL,
	"licence_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "revocations" ADD CONSTRAINT "revocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revocations" ADD CONSTRAINT "revocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "revocations_tenant_token_key" ON "revocations" USING btree ("tenant_id","token");--> statement-breakpoint
CREATE INDEX "revocations_tenant_licence_idx" ON "revocations" USING btree ("tenant_id","licence_id");