# `src/components`

App pieces, and the design system's primitives in `ui/` (PCN-016): Button,
Field, AmountField, Select, Card, StatTile, Badge, Banner, Dialog, the key
chip and TabBar. Screens use the primitives instead of repeating class
strings. **No default-theme shipping.**

- **No raw hex, ever** — enforced by lint (Phase 10 §9). Colour comes from the
  tokens in `src/app/globals.css`.
- **Semantic colour only with meaning** (I7): navy and blue are the brand and
  never a status; green is done, amber needs attention (`amber-text` for
  words), red is refused — each with a word or a mark.
- **Numerals are the brand** (Phase 4 §5): money and quantity columns are
  right-aligned and tabular wherever they appear.
- **One primary action per screen** (I4). Secondary actions exist quietly.
- Density: 36px table rows where work happens, 44px+ hit targets on actions,
  high contrast throughout for bright shops and aging screens.
