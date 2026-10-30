A 24px pill on a row: a unit, a count, or a state — always a word.

**Markup:** `<span class="mv-badge mv-badge--attention">Expires in 21 days</span>`. Tones: none (neutral), `--done`, `--attention`, `--refused`. Use `<button class="mv-badge">` when it opens something (the unsynced count).

**The consumer provides** the word or count.

- Neutral `mist` for facts (units, categories). Toned only for state, with a dot: done `green-700` on `green-50`, attention `amber-text` on `amber-50` with an `amber` dot, refused `red` on `red-50`.
- No badge for the normal case (in stock, in date).
