A tile holding one figure: label, figure, one meta line, all fixed-height so a row of tiles is perfectly even.

**Markup:** `<div class="mv-tiles"><div class="mv-tile"><span class="mv-label">Today’s sale</span><span class="mv-tile__value">Rs 48,210</span><span class="mv-tile__meta">62 receipts</span></div>…</div>`. Set `--mv-tiles` to the column count (2 on phones, 4 from tablet).

**The consumer provides** a label of 14 characters or fewer, a figure, and a meta line that carries the time scope ("all time, 23 customers", "in the drawer now"); the meta may be empty — the row stays.

- White, 16px corners, `shadow-card`, 18/20px padding. Rows: 18px label (13px sentence case), 32px figure, 20px meta; figure `stat` style, right-aligned, `navy`. `mv-tile--attention` puts an `amber` dot before the label and turns the figure `amber-text` (5.91:1).
- Loading `is-loading` (skeleton bars), error `is-error` ("—" and a red meta line), empty `is-empty` ("Rs 0" in `ink-2` plus what it means), disabled `is-disabled` (owner-only figures for a salesman).
