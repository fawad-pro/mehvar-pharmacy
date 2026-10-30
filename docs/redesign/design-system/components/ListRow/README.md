A 44px row: name, one meta line, and a right-aligned figure — search results, customers, picker lists.

**Markup:** `<ul class="mv-list"><li><button type="button" class="mv-row"><span class="mv-row__main"><span class="mv-row__name">…</span><span class="mv-row__meta">…</span></span><span class="mv-row__end">Rs 30.00</span></button></li></ul>`.

**The consumer provides** name, meta and the figure; `aria-selected="true"` on the active row.

- The list is a white surface with 16px corners and `shadow-card`; rows are split by `line` hairlines. Hover `page`; selected `blue-50`; focus ring inset. Disabled: 40% with the reason in meta. Error: meta in `red`. Empty: one row that says nothing matched and which key adds it.
