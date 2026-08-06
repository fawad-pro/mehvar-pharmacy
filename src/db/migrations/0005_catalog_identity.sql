-- Catalogue identity keys and applied-pack history.
--
-- `identity_key` is added NOT NULL with no backfill, which is safe only because
-- `global_products` has never had a writer: the table exists from Day 1's
-- schema and nothing has ever inserted into it. If that were untrue this
-- statement would fail loudly, which is the correct outcome — the key is
-- computed by `domain/catalog/identity.ts` and cannot be derived in SQL, so a
-- backfill would have to invent values, and inventing values in a UNIQUE column
-- that decides whether two medicines are the same is not a thing to do quietly.
--
-- The unique index is the last line of defence behind the importer's own
-- idempotency. Both exist because the cost of a duplicated global identity is
-- paid by every pharmacy that later links to the wrong one of the pair.

CREATE TABLE "catalog_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"catalog_version" text NOT NULL,
	"pack_format" integer NOT NULL,
	"product_count" integer NOT NULL,
	"inserted_count" integer NOT NULL,
	"updated_count" integer NOT NULL,
	"generated_at" text,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "global_products" ADD COLUMN "identity_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "global_products" ADD COLUMN "equivalence_key" text;--> statement-breakpoint
ALTER TABLE "global_products" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "global_products_identity_key" ON "global_products" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "global_products_equivalence_idx" ON "global_products" USING btree ("equivalence_key");--> statement-breakpoint
CREATE INDEX "global_products_name_idx" ON "global_products" USING btree ("name");