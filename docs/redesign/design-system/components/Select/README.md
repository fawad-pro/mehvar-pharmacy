A native select restyled to the field: 44px, white, 10px corners, `border` edge, a navy chevron.

**Markup:** `<label class="mv-field"><span class="mv-label">Supplier</span><select class="mv-select">…</select></label>`.

**The consumer provides** the options, pre-selecting the common case.

- Loading: one disabled option "Loading suppliers…" with `aria-busy`. Error: "Choose who this stock came from." Empty: disabled "No suppliers yet" plus a help line naming the key that adds one.
- Use it for short known lists; long lists (products, customers) use search with ListRow results.
