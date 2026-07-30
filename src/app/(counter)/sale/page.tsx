import { SurfacePlaceholder } from '@/components/surface-placeholder';

/**
 * Sale — home (Phase 10 §1). W1, W2, W5, W6 in one surface, payment as overlay.
 *
 * This is the 80% surface and the one the product exists for. Its search bar,
 * cart and right rail are built in Session 3 (Day 3) on top of the client-side
 * index from Session 2.
 */
export default function SalePage() {
  return (
    <SurfacePlaceholder
      title="Sale"
      workflow="Search, cart, quantity grammar and the payment overlay — the surface the product exists for (W1, W2, W5, W6)."
      session="Session 2 (search) and Session 3 (cart and commit)"
    />
  );
}
