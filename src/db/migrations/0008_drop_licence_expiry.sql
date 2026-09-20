-- PCN-006: the core product is perpetually licensed. The licence is identity-
-- only now; the subscription columns (entitlement/token-expiry/grace/warn) are
-- retired. No grants change — `licences` stays an event table (SELECT+INSERT,
-- UPDATE/DELETE revoked). Dropping columns is additive-safe for the app role.

ALTER TABLE "licences" DROP COLUMN "entitlement_ends_at";--> statement-breakpoint
ALTER TABLE "licences" DROP COLUMN "token_expires_at";--> statement-breakpoint
ALTER TABLE "licences" DROP COLUMN "grace_days";--> statement-breakpoint
ALTER TABLE "licences" DROP COLUMN "warn_days";