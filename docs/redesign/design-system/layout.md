# Layout rules

These rules guarantee symmetry across phone (375px), tablet (768px), laptop (1280px) and desktop (1440px). Each has a card under "Layout rules" with a Do and a Don't at all four widths. Wrap each screen in `.mv-screen` so the width-dependent rules follow the screen, not the window.

## 1. Tile rows are symmetrical

- Every tile in a row uses `mv-tile`: label in the `label` style (13px, sentence case), one line, fixed `label-height` (18px) with ellipsis — labels never wrap to different line counts. Write labels of 14 characters or fewer so nothing truncates at phone width, and put the time scope in the meta line, not the label ("Owed to you" · "all time, 23 customers").
- Tiles are equal height: a fixed three-row grid (18px label, 32px figure, 20px meta). A tile with no meta keeps the empty row.
- Figures share one baseline and are right-aligned in the `stat` style.
- Tiles are white on the page, lifted by `shadow-card`, 16px corners. Columns: 2 on phone, 4 from tablet up, `space-4` gaps (12px on phone).

## 2. Money

- Right-align every amount (`mv-num`) in tabular figures. Same decimals down a column (two in tables and fields).
- Never wrap an amount: `white-space: nowrap`.
- Totals sit in the same column as the lines they sum.

## 3. One primary action, in one place

- One `mv-btn--primary` (`blue-600`) per screen, labelled with its verb and key (`Receive stock F12`).
- It sits at the end of the form or rail: full width at the bottom on phones (quiet actions stack below it), bottom-right from tablet up with quiet actions to its left.
- On a phone the actions live in a bar fixed above the tab bar, and the page above gets bottom padding equal to the bar's height — nothing is ever hidden under it.
- Key hints on buttons (F12, F4, Esc, Enter) print from tablet width up only.
- Dialogs follow the same rule: the primary is the last button, bottom-right.

## 4. Touch targets

- Anything actionable is at least 44 × 44px (`touch-target`), with at least 8px (`space-2`) between neighbours. Key chips too.

## 5. Focus

- `:focus-visible` draws a solid 2px `blue-600` ring with a 2px offset; inside lists and tables the ring sits inset (-2px).
- Never ship `outline: none` without this ring.

## 6. Colour carries meaning

- Green: done. Amber: needs attention. Red: refused. Blue is the brand and the one action — never a status.
- Rows, titles and names stay `navy`. Categories and tags are neutral `mist` badges.
- A state always has a word beside its colour.

## 7. Density follows the device

- Screen 1024px and wider (laptop, desktop): cart and table rows `row-height` 36px, 13px text.
- Below 1024px (tablet, phone): `row-height-touch` 44px, 14px text. On phones drop secondary columns (unit price) rather than shrink them.
- Every cart row is the same height at every width: the name on one line with an ellipsis, a status badge straight after the name, strength, batch and expiry on the one meta line (`mv-cart`). On phones the batch drops; strength and the full expiry ("exp 03/2027") stay.

## 8. Navigation follows the device

- Tablet and up: the key bar, every global key printed.
- Phone (below 768px): the five-tab bar — Sale, Receive, Customers, Day, More.
