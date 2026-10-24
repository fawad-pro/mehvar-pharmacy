# Phase 10 — Information Architecture, Navigation & Screens

Status: Draft for review
Informed by: Phases 4 (identity, I-principles), 5–7 (domain, workflows), 8 (ADR-3/4/6/7)

This document fixes the screen inventory, navigation model, keyboard map, search interaction, the sale screen's layout logic, design tokens, and receipt spec. Pixel-level execution happens in implementation against the frontend-design discipline; nothing here is decoration — every choice traces to a workflow or principle.

---

## 1. Structural idea: one home, everything one key away

The sale screen is home (Phase 7 rule 1). Every other surface is a sortie: reached by one global key, exited back to Sale with Esc. There is no dashboard-first posture for the counter — the counter's dashboard is the cart. Persistent chrome is minimal: a slim top bar (pharmacy name, active user chip with PIN-switch, connectivity/unsynced badge) and a bottom **key bar** showing the global function keys — the visible-shortcuts principle (I1) rendered as furniture, and a deliberate echo of the DOS-era POS foot rail that Gen-1 (MARS-trained) salesmen already trust.

## 2. Screen inventory

**Counter surfaces (desktop, keyboard-first):**
1. **Sale** (home) — W1, W2, W5, W6 in one surface; payment as overlay
2. **Settle Udhaar** — overlay (from anywhere); W3
3. **Returns** — W4: find sale → select lines → confirm
4. **Purchases** — list + entry form; W7 (resumable drafts — the only draft state in the product)
5. **Products** — catalog list, product detail/edit, completion queue (D3), barcode management
6. **Customers** — list with balances, customer detail = derived ledger (T4 expansion view)
7. **Stock** — low stock, near expiry (30/60/90 tabs), adjustment entry (W8), pending-layer/negative incidents
8. **Day & Reports** — W10 day view (three numbers + exception list + count-drawer ritual), then daily/weekly/monthly/overall report tabs
9. **Settings** — receipt header/footer, users & PINs, printer setup guide, export (Phase 3 §5.2 lives here, owner-only)
10. **Login / PIN switch** — device login once (ADR-7); PIN overlay thereafter

**Owner phone surface (responsive views of the same app, read-only):**
- **Today** (three numbers + exceptions), **Stock** (low/near-expiry counts and lists), **Udhaar** (balances, largest first). Bottom-tab navigation, numerals huge (I6). This is W11 and the concrete pitch artifact ("check your shop from anywhere").

## 3. Global keyboard map

Visible in the key bar always (I1). Letters chosen for reach; function keys for surfaces:

- **F1** Sale (home) · **F2** Purchases · **F3** Products · **F4** Customers · **F5** Day & Reports · **F6** Stock · **F7** Returns · **F8** Settle Udhaar · **F9** Adjustment · **F10** PIN switch · **Esc** back to Sale / close overlay
- Barcode scans are keyboard input everywhere sensible: on Sale they add the item; on Products they find it; on Purchase entry they fill the line's product (I1 "the scanner is a keyboard").

## 4. Sale screen — the 80% surface

Layout logic (not pixels): three zones with fixed roles.

- **Search bar, full width, top.** Focus lives here (rule 1). Beneath it, the results dropdown when typing.
- **Cart, left ~62%.** A dense table (I7): line = name + natural-language quantity ("1 strip + 4 tab", W5) + unit price + line total; selected line editable in place (arrow up into cart, +/- for qty, Delete removes with strike-through until commit, price edit logged as override).
- **Right rail ~38%.** Totals stacked large-to-small: TOTAL in the display's biggest numerals (I6), then discount, then item count. Below: customer strip (empty = cash walk-in; F8-attach shows name + current balance — exposure visible before extending more, W2). Bottom: the two commit actions — **Cash (Enter on payment overlay)** dominant, **Udhaar** secondary (I4: one primary action).

**Payment overlay (Space or F12 from cart):** tendered amount (numpad-first, defaults exact), change rendered enormous, Enter commits → receipt prints (ADR-6) → overlay closes → focus returns to search, cart clears. Split cash/credit lives here when a customer is attached.

**Quantity grammar (I3):** `3*pana` in search = quantity 3 of the selected result; bare selection = qty 1; Tab on the qty cell cycles unit levels (tab/strip/box) where the product defines them.

*Amended 2026-10-24 by PCN-012.* The unit is chosen with visible buttons on the cart line (only the units the product is sold by), beside − qty +; the price column shows the price per chosen unit. Tab still cycles the same buttons.

**States that must be visible calmly (I7):** consuming-batch price change (D1 — line shows "price updated" chip), zero/negative stock (line proceeds, amber chip, D2), unsynced count in top bar (ADR-3), quick-add result row when search is empty (W6: one key → name+price mini-form inline).

## 5. Search interaction spec (ADR-4's front half)

- Results begin rendering from the first keystroke; matching is local, so latency is imperceptible (I2).
- Ranking: exact/starts-with on name → word-boundary match → fuzzy (misspelling-tolerant, tuned for Roman-Urdu transliteration drift: "panadol/pandol/penadol") → formula/salt match (labelled as such — substitution support, Phase 1 §5).
- Result row: **name + strength** (primary), form + manufacturer (secondary), **price** (right-aligned, tabular), stock badge (green/amber/zero-red only when meaningful — semantic color rule).
- Arrow keys navigate, Enter adds, typing continues to refine. No mouse required ever; mouse works anyway.
- Barcode hit bypasses ranking: instant add (unit level per barcode mapping). Unknown barcode → inline prompt: link to product (type-ahead) or quick-add (W6/Phase 6 §4 loop).
- Empty results → quick-add row is the first-class result (P2), not an error state.

## 6. Design tokens (finalizing Phase 4 §5 direction)

- **Palette:** `--green-900 #0B3B2C` (anchor: headers, key bar), `--green-600 #11704F` (primary actions), `--green-100 #E4F1EA` (selection/success tints), `--ink #1B1F1D` (text), `--paper #FAFAF7` (surfaces), `--line #E3E4DF` (rules), `--amber #B7791F` (caution: near-expiry, negative stock, unsynced), `--red #B3372E` (expiry/danger only). Semantic colors appear **only** with meaning (I7); green family carries brand, never alarm.
- **Typography:** Inter (variable), `font-feature-settings: "tnum"` globally on numerals; scale ~13px table base / 15px controls / totals at display sizes. Numerals are the brand (Phase 4): every money and quantity column right-aligned tabular.
- **Density:** compact rows in cart and tables (36px), generous hit targets on actions (44px+), high contrast throughout (bright-shop legibility, Phase 4 §5).
- Tokens ship as CSS variables; shadcn components restyled to them — no default-theme shipping (Phase 8 §2).

## 7. Receipt spec (ADR-6's product surface)

80mm primary / 58mm variant, print-CSS: header = tenant name, phone, address (settings); body = lines (name, qty natural language, amount), subtotal/discount/total; payment = cash/tendered/change or udhaar split; **udhaar receipts and settlements print the mini-statement** (previous balance → this transaction → new balance) — the dispute-ender (T4/T5, W3); footer = sale number, date/time, salesman name, configurable thank-you line, and a modest **"Mehvar"** mark (brand compounding, Phase 4 §6). Monospace-adjacent numeral alignment; no logos-as-images in V1 (thermal dithering risk, P6).

## 8. Empty, loading, error postures

Empty states teach the key that fills them ("F2 — enter your first purchase"). Loading is skeleton-quiet; nothing spins over the sale path (commits are local-fast, ADR-3/§4.4 of Phase 8). Errors follow I5: say the next action, plainly; never a code, never blame. Disconnection posture: purchases/reports/catalog say "needs internet — selling keeps working" (ADR-3's calm sentence).

## 9. Exports

- Phase 11: keyboard map and search ranking are test surfaces (the W1 E2E path asserts the key sequence verbatim); tokens enforced by lint (no raw hex in components).
- Phase 12: printer setup guide content pairs with ADR-6 kiosk configuration; Settings→Export wiring.
- Phase 13: build order within screens — Sale search+cart → payment+receipt → purchases → the rest (mirrors W-order).
