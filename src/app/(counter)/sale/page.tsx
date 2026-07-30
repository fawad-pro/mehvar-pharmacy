import { SaleSurface } from './sale-surface';

/**
 * Sale — home (Phase 10 §1). W1, W2, W5, W6 in one surface, payment as overlay.
 *
 * This is the 80% surface and the one the product exists for. Day 2 delivers the
 * search bar and its ranked results against the client-side index (ADR-4); the
 * cart, quantity grammar and payment overlay land in Session 3 on top of it.
 */
export default function SalePage() {
  return <SaleSurface />;
}
