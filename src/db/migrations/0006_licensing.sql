-- Licensing (PCN-005, accepted 2026-09-16): the licence history, machine
-- identity, and the clock witness.
--
-- Two of the three are event tables, and that is the load-bearing part:
-- `licences` and `clock_observations` are added to EVENT_TABLES in schema.ts,
-- so `db:grants` gives the app role SELECT and INSERT and explicitly REVOKEs
-- UPDATE and DELETE. The record of what a pharmacy is entitled to, and the
-- record of how far time has reached, become things the running application
-- physically cannot rewrite. That is ADR-1 applied to licensing rather than
-- bolted beside it, and it is why rolling a shop's clock back does not work.
--
-- **Run `npm run db:grants` after this migration.** A new table starts with
-- default privileges, so until grants runs both of these are fully mutable —
-- and an append-only claim that is not enforced is PCN-001's exact failure mode
-- at a new layer: decorative, and appearing enforced.
--
-- `installations` is deliberately NOT an event table (`last_version` and
-- `last_hostname` move with every release) and deliberately NOT tenant-scoped:
-- one Node can serve many tenants when a pharmacy is cloud-hosted, and machine
-- identity is not business identity.
--
-- Additive-safe, per Phase 12 §2: three new tables, no column dropped, nothing
-- backfilled. The previous image runs against this schema unchanged.

CREATE TABLE "clock_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_version" text NOT NULL,
	"last_hostname" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token" text NOT NULL,
	"licence_id" uuid NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"entitlement_ends_at" timestamp with time zone NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"grace_days" integer NOT NULL,
	"warn_days" integer NOT NULL,
	"installation_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "licences" ADD CONSTRAINT "licences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licences" ADD CONSTRAINT "licences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clock_observations_observed_at_idx" ON "clock_observations" USING btree ("observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "licences_tenant_licence_installation_issued_key" ON "licences" USING btree ("tenant_id","licence_id","installation_id","issued_at");--> statement-breakpoint
CREATE INDEX "licences_tenant_idx" ON "licences" USING btree ("tenant_id");
