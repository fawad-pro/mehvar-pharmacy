A data table on a white surface (16px corners, `shadow-card`): 36px rows and 13px text on laptop and desktop, 44px rows and 14px text on tablet and phone, a `page` header, `line` hairlines between rows, figures right-aligned.

**Markup:** `<div class="mv-table-wrap"><table class="mv-table"><thead>…</thead><tbody><tr><td>…</td><td class="mv-num">Rs 400.00</td></tr></tbody></table></div>`. Secondary cells take `mv-sub`.

**The consumer provides** columns and rows; money and quantity columns get `mv-num` on both `th` and `td`.

- Row hover `page`, selected `blue-50`, keyboard row focus inset ring. Density switches by itself inside `.mv-screen` (below 1024px: 44px); `mv-table--touch` forces it. Loading: skeleton rows. Error and empty: a single full-width `mv-table__note` row (`is-error` for red).
- The wrap scrolls horizontally on phones rather than squeezing columns.

**The cart** is a table with `mv-cart` added (fixed layout, set column widths with `<colgroup>`). Each item cell holds `<div class="mv-cart__name"><span class="mv-cart__nm">Flagyl</span><span class="mv-badge mv-badge--attention">Stock −2</span></div><div class="mv-cart__meta">400mg · F0042</div>`.

- Every row is the same height at every width: the name stays on one line with an ellipsis, a status badge sits straight after the name (never floating at the row's end), and strength, batch and expiry go on the one meta line — on phones the batch drops, and strength and the full expiry ("exp 03/2027") stay.
- One unit per line, in the product's own word: "2 strip", "10 tab", "1 box" — never "1 strip + 2 tab".
- 36px rows with 13px names at laptop and desktop; 44px rows with 14px names below 1024px of screen. On phones the Price column is dropped, not squeezed.
