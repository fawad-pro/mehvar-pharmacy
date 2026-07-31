-- Allocation resolution — the first of ADR-8's two sanctioned mutations.
--
-- Day 1 predicted this migration would be needed and why: event tables are
-- INSERT-only for the application role, which is ADR-1 expressed as a database
-- privilege rather than a code convention. Resolving a pending allocation is
-- nonetheless an UPDATE on `sale_line_allocations`, and it is legitimate —
-- Phase 9 §3 designed the row with a nullable `resolved_by` precisely so it
-- could be filled in later, and ADR-8 names allocation resolution one of the
-- only two mutations the system permits anywhere.
--
-- The wrong fix would be granting the app role UPDATE on the table: that opens
-- every column of every allocation row forever, to buy one narrow capability.
-- Instead the owner defines this function, and the app role is granted EXECUTE
-- on it and nothing else. The role still cannot UPDATE the table directly; it
-- can only ask for this one transition, under these conditions:
--
--   * the row must belong to the calling tenant (no cross-tenant reach);
--   * the row must still be pending — `batch_id IS NULL AND resolved_at IS NULL`
--     — so a settled allocation can never be rewritten, and resolution can
--     never happen twice;
--   * only the four resolution columns move. Quantity, sale line and tenant are
--     untouchable, so the sale itself remains exactly what it was.
--
-- Returns true when a row actually moved, so a caller that raced another
-- resolver learns it lost rather than assuming it won.
--
-- `SET search_path` is not decoration on a SECURITY DEFINER function: without
-- it, a caller controlling their own search_path could shadow `now()` or the
-- table name and have the definer execute it with owner privileges.

CREATE OR REPLACE FUNCTION resolve_sale_line_allocation(
  p_tenant_id uuid,
  p_allocation_id uuid,
  p_batch_id uuid,
  p_unit_cost_paisa bigint,
  p_purchase_line_id uuid,
  p_adjustment_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  moved integer;
BEGIN
  UPDATE sale_line_allocations
     SET batch_id = p_batch_id,
         unit_cost_paisa = p_unit_cost_paisa,
         resolved_by_purchase_line_id = p_purchase_line_id,
         resolved_by_adjustment_id = p_adjustment_id,
         resolved_at = now()
   WHERE id = p_allocation_id
     AND tenant_id = p_tenant_id
     AND batch_id IS NULL
     AND resolved_at IS NULL;

  GET DIAGNOSTICS moved = ROW_COUNT;
  RETURN moved = 1;
END;
$$;
--> statement-breakpoint

-- Nobody gets this by default; `npm run db:grants` hands EXECUTE to the
-- configured application role by name, the same way it grants everything else.
REVOKE ALL ON FUNCTION resolve_sale_line_allocation(uuid, uuid, uuid, bigint, uuid, uuid) FROM PUBLIC;
