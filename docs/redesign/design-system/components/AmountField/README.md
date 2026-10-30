A money input: `Rs` prefix, right-aligned, tabular, 18px.

**Markup:** `<label class="mv-field"><span class="mv-label">Tendered</span><span class="mv-amount"><span class="mv-amount__unit">Rs</span><input class="mv-input" inputmode="decimal"></span></label>`.

**The consumer provides** the value formatted with thousands separators and two decimals, and a default (the exact total) as the placeholder.

- Same states as TextField. The error message states the gap and the fix: "Rs 350 short of the total. Take Rs 1,250 or more."
- Never show a minus sign; direction is a word elsewhere on the screen.
