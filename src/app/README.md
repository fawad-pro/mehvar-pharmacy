# `src/app` — routes

Phase 10 §1: **the sale screen is home.** Every other surface is a sortie,
reached by one global key and exited back to Sale with Esc. There is no
dashboard-first posture for the counter — the counter's dashboard is the cart.

## Counter surfaces (desktop, keyboard-first) — Phase 10 §2

`sale` (home, W1/W2/W5/W6) · `purchases` (W7) · `products` (+ completion queue)
· `customers` · `stock` (W8/W12) · `day` (W10 + reports) · `settings` (+ export)
· `login` / PIN switch

Settle Udhaar (W3) and Returns (W4) are overlays reachable from anywhere.

## Owner surface (phone-first, read-only) — W11

`today` · `stock` · `udhaar`. Bottom-tab navigation, numerals huge (I6).

## Rules

- Persistent chrome is minimal: a slim top bar (pharmacy name, active user chip
  with PIN switch, connectivity/unsynced badge) and a bottom **key bar** showing
  the global function keys — I1 rendered as furniture.
- Authorization is enforced **server-side per role on every mutation**, never by
  hiding UI (Phase 12 §5).
- Empty states teach the key that fills them. Loading is skeleton-quiet; nothing
  spins over the sale path. Errors say the next action plainly — never a code,
  never blame (I5, Phase 10 §8).
