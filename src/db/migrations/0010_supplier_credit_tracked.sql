-- Supplier credit, corrected: purchases recorded before supplier credit existed
-- must not read as owed (PCN-007, docs/PLAN_CHANGE_NOTES.md).
--
-- 0009 added purchases.cash_paid_paisa with DEFAULT 0, so every purchase that
-- predated it reads as entirely unpaid and every supplier balance became the
-- sum of the shop's whole purchase history. That 0 was never a fact: those
-- purchases were entered with no "Paid now" field at all.
--
-- Two steps, and the ORDER is the point. Added with DEFAULT false, every row
-- that already exists reads false -- PostgreSQL stores the default; no row is
-- rewritten or updated, so no historical transaction changes. The default then
-- becomes true, so every purchase recorded from here on is tracked. drizzle-kit
-- generates the one-step form (DEFAULT true), which would mark the whole
-- history as tracked and leave the debt in place; the snapshot records the
-- final state, which is what drizzle compares.
--
-- No payment is invented. A purchase that is untracked simply contributes
-- nothing to what is owed; its cash_paid_paisa stays exactly as it was.
ALTER TABLE "purchases" ADD COLUMN "credit_tracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "credit_tracked" SET DEFAULT true;
