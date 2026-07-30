# `src/components`

shadcn/ui primitives restyled to the Mehvar Pharmacy tokens (Phase 8 §2, Phase
10 §6). **No default-theme shipping.**

- **No raw hex, ever** — enforced by lint (Phase 10 §9). Colour comes from the
  tokens in `src/app/globals.css`.
- **Semantic colour only with meaning** (I7): amber is caution (near-expiry,
  negative stock, unsynced), red is expiry/danger. The green family carries the
  brand and never alarm.
- **Numerals are the brand** (Phase 4 §5): money and quantity columns are
  right-aligned and tabular wherever they appear.
- **One primary action per screen** (I4). Secondary actions exist quietly.
- Density: 36px table rows where work happens, 44px+ hit targets on actions,
  high contrast throughout for bright shops and aging screens.
