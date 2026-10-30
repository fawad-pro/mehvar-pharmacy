Mehvar Pharmacy is counter software for independent Pakistani pharmacies: keyboard-first, calm under density, and built so the numbers cannot lie. It should feel like a good pharmacy looks — clean, light, quiet and trustworthy. Build every screen from the primitives in this system (`components/bundle.css`, classes prefixed `mv-`) and the layout rules below. Wrap the app in `.mv` and each screen in `.mv-screen`.

## Principles that decide arguments

- **Keyboard-first, shortcuts visible.** Print the key on the control (`Pay F12`, `Attach F4`, `F7 Receive Stock`) from tablet width up; a phone has no F-keys, so it shows no key hints. The key bar is furniture: it never rearranges.
- **One primary action per screen.** Exactly one `mv-btn--primary`; everything else is `--secondary` or `--quiet`.
- **Prevent errors; don't scold.** A message says what to do next, in plain words, never a code and never blame.
- **Glanceable numbers.** Money and quantities are right-aligned in tabular figures, always with the same decimals in a column.
- **Calm under density.** Navy on white. Colour appears only when it means something.

## Content

- Plain English a salesman reads at rush hour, sentence case everywhere (labels too), no jargon, no exclamation marks, no emoji. Speak to the operator as "you"; the product does not say "I".
- Errors name the next step: "That did not save. Try again." · "Attach a customer before putting anything on udhaar." · "This machine could not save the sale. Do not hand over the items — get help."
- Offline is calm: "Needs internet — selling keeps working."
- Empty states teach the key that fills them: "F7 — enter your first purchase."
- A balance never shows a minus sign. The direction is a word ("Owes", "Advance", "Settled up"); the amount is always positive.
- Money is written `Rs 1,250.00` — `Rs`, a space, thousands separated by commas, two decimals in tables and fields. Tiles may drop the decimals (`Rs 48,210`).
- Keep the shop's own words: udhaar, strip, tab, box. A cart line carries one unit: "2 strip", never "1 strip + 2 tab".
- A tile's label names the figure in 14 characters or fewer; its time scope goes in the meta line ("Owed to you" · "all time, 23 customers").

## Colour

The brand is the logo's navy and blue. Status has its own three colours. **The brand never doubles as a status, and a status never decorates.**

| Role | Token | Use |
| --- | --- | --- |
| Brand — text | `navy` | Headings, body text, figures. 14.98:1 on `page`, 16.1:1 on `surface`. |
| Brand — action | `blue-600` (hover `blue-700`) | The one primary button (white text 5.72:1), the active key, the focus ring, links. |
| Selection | `blue-50` | The selected row. Interaction, not status. |
| Done | `green-700` on `green-50` | Synced, received, settled, day closed. 4.69:1 on its ground. |
| Needs attention | `amber` for the mark; `amber-text` for words and figures, on `amber-50` | Near expiry, negative stock, unsynced, money owed, licence notices. `amber-text` 5.41:1 on its ground; `amber` 3.39:1+ is for marks only. |
| Refused | `red` on `red-50` | Expired stock, a commit that cannot go through, a failed load. 5.22:1 on its ground. |

- Surfaces: the page is `page` (a very light blue-grey); cards, tiles, tables, lists, fields, dialogs and the key bar are `surface` (white).
- Secondary text is `ink-2` (6.54:1 on page). Field and secondary-button edges are `border` (3.26:1 — the 3:1 control floor). `mist` is the quiet fill for chips, neutral badges, table headers and skeletons.
- Every state carries a word or an icon as well as a colour.
- No decorative colour: no tinted headings, no coloured category tags, no gradients in the UI. (The logo is a picture and is exempt — see Logo.)

## Type

- One family: Inter (`--font-sans`), loaded from Google Fonts. Tabular figures everywhere.
- Scale: `table` 13px for dense rows on laptop and up, `body-sm` 14px for the same rows on tablet and phone and for helper text, `control` 15px for everything you touch, `heading` 17px for card and dialog titles, `field-lg` 18px for amount entry, `title` / `stat` 24px, `total` 44px, `change` 72px.
- Labels use `label`: 13px, weight 500, sentence case, no letter-spacing, `ink-2`, one line in a fixed `label-height` (18px). Never let a label wrap; write labels of 14 characters or fewer.
- Weights: 400 body, 500 controls, labels and names, 600 titles, figures and the primary button.

## Shape and depth

- Corners: `radius-control` 10px on buttons, fields, selects and key chips; `radius-card` 16px on cards, tiles, tables, lists and inset banners; `radius-dialog` 20px on dialogs; `radius-pill` on badges.
- Depth: white surfaces sit on the page with `shadow-card` — never a grey outline. An interactive card or tile lifts to `shadow-card-hover`. The search dropdown uses `shadow-pop`, dialogs `shadow-dialog`.
- Hairlines (`line`) appear only between rows inside tables and lists.

## Space and density

- Spacing is the 4px scale: `space-1` … `space-10`. 8px between controls, 16px between tiles and cards, 20px inside cards and tiles, 24px inside dialogs, 32px screen gutter from laptop up (16px on phone).
- The counter's cart and every table: `row-height` 36px with 13px text when the screen is 1024px or wider; `row-height-touch` 44px with 14px text below that (tablet and phone). `.mv-screen` makes this automatic.
- `touch-target` 44px for anything actionable, key chips included.
- On a phone, a screen's actions sit in a bar fixed above the tab bar (Pay; Count the drawer and Record a cash movement). The scrolling page gets bottom padding equal to that bar's height, so the last row always scrolls clear of it.

## States

Every primitive defines default, hover, focus, disabled, loading, error and empty (its card shows each; "not applicable" is stated where a state cannot happen).

- **Hover:** fields and secondary buttons darken their edge to `navy`; rows and quiet buttons take `page`/`mist`; primary goes `blue-600` → `blue-700`; cards and tiles lift.
- **Focus:** a solid 2px `blue-600` ring, 2px off the control (5.32:1 on page, 5.72:1 on surface); inset inside lists and tables. Never remove it.
- **Disabled:** 40–50% opacity and `cursor: not-allowed`. Keys a role cannot use stay visible and dim.
- **Loading:** quiet and static — `mist` skeleton bars, or the button's verb in progress ("Saving…") with `aria-busy`. Nothing spins on the sale path.
- **Error:** a 2px `red` field edge plus the next-step message beneath in `red`.
- **Empty:** teach the key that fills it.

## Layout rules

The layout section and the cards under "Layout rules" show each rule as Do / Don't at phone (375), tablet (768), laptop (1280) and desktop (1440). The "Screens" card shows Sale, Payment and Day built from these primitives at laptop and phone width.

1. Tiles in a row share one label style and a fixed one-line label height; equal heights; figures on one baseline.
2. Money right-aligned in tabular figures with constant decimals.
3. One primary action per screen, at the end: full width at the bottom on phones, bottom-right from tablet up.
4. 44px minimum touch targets, 8px apart.
5. A visible focus ring on everything focusable.
6. Green done, amber needs attention, red refused — and nothing else coloured.
7. 36px rows on laptop and desktop, 44px rows and 14px text on tablet and phone; every cart row one height, name on one line, badge straight after the name.

## Key bar and tab bar

Tablet and up: a light bar on `surface` along the bottom: each key a soft `mist` chip (44px, `radius-control`) with the key in navy and its word in `ink-2`; the active key fills `blue-600` with white text; hover `blue-50`. Three bands (counter, goods, owner) split by a short hairline. Chips never shrink.

Phone (below 768px of screen): the key bar gives way to the five-tab bar — Sale, Receive, Customers, Day, More — with More opening the rest of the keys in their order. `.mv-screen` makes the switch.

## Logo and whose name is on screen

The app belongs to the pharmacy. **The top bar carries the pharmacy's name, not Mehvar's.**

- **Top bar:** the pharmacy's name from the session (e.g. "Al-Shifa Pharmacy"), 17px 600 navy, at the top left; on laptop and tablet the screen's name follows after a hairline. A 32px slot before the name is kept for the pharmacy's own small logo, shown only once one is uploaded. On a phone the name is 16px, stays on one line and ends in an ellipsis, never wraps; the tab bar says where you are.
- **Mehvar appears in four places only,** always the blue mark: `mehvar fav blue.png` as the favicon and app (PWA) icon; `Mehvar Logo.png` on the login and splash screens and in Settings → About.
- **Outside the product — full colour:** `mehvar_logo.png` (red heart) and `mehvar fav blend.png` for the installer and marketing. Red on screen always means "refused", so the red heart never appears inside the app.
- **Receipts** print the pharmacy's own header and no logo; the only Mehvar mention is one small "Powered by Mehvar" line at the very bottom, which the owner can switch off (see the Receipt card).
- The marks are pictures: never recolour, crop, stretch or redraw them, and keep clear space of a quarter of their height.

## Iconography

The codebase ships no icon set. The function key itself is the icon (`F7`), set in `kbd` style. Status uses three small solid marks drawn inline (check-in-circle for done, triangle for attention, cross-in-circle for refused), always beside a word. Do not add icon fonts or emoji.

## Using the primitives

Load `tokens.css`, then `components/bundle.css`; wrap the app in `<div class="mv">` and each screen in `.mv-screen`. Each component card's README lists its classes and markup. Preview-only state classes (`is-hover`, `is-focus`) exist so states can be shown statically; real screens rely on `:hover` and `:focus-visible`.

## Not synced

Started from `fawad-pro/mehvar-pharmacy` at `main@abe330f`, then restyled here: the navy and blue brand, white-on-tint surfaces, soft shadows, rounded shapes, sentence-case labels and the light key bar are this system's and are not yet in the code — `src/app/globals.css` still declares the green palette. Font files: none — Inter is loaded by `next/font/google`. Components in `src/components` are app pieces and were not brought in; the primitives here are hand-written from the classes those pieces use.

---

## Consuming this system (generated — do not edit)

Every path named below is under `project/` in this design system: read `project/api/tokens.md`, not `api/tokens.md`.

22 components are documented without a runnable `components/bundle.js`: read each component’s card, and its README where it has one (`components/<Comp>/README.md`), and build to those guidelines. Tokens: the values are on `api/tokens.md`; a Slides deck or Design canvas also takes `tokens.json` by file path. On a Design canvas, also copy `tokens.css` to `project/ds/<folder>/tokens.css` in the call that installs this system, and link it in each artboard that uses this system, right after the `support.js` line and before the system’s other stylesheets: `<link rel="stylesheet" href="ds/<folder>/tokens.css">` (with one `../` in front for each folder the artboard is in).

**Read, per thing:** a component’s props, parts and examples: `api/components/<Comp>.md`; token values: `api/tokens.md`; stored assets and their paths: `api/assets/<Group>.md`. After this README, fetch the cards and fonts you need in ONE message as parallel calls — none depends on another.

**Two rules.** Before you use a thing — a component, a token group, an icon, an asset — read its card from the index below; a value you did not read from a card is a guess. `tokens.json`, `manifest.json` and `design-system.json` are sources for tools: hand them over. `components/<Comp>/README.md` and `assets/<Group>/README.md` are the long-form second read a card links to; `SKILL.md` and `artifact-type/` beside them are authoring guidance, not needed to consume the system.

## Index (generated — do not edit)

**Tokens**

- `api/tokens.md` — Every token: surface, text, palette, type, spacing, radius, shadow. (8.8k)

**Icons and assets**

- `api/assets/Logos.md` — 6 files, by asset id. (2.5k)

**Components** (`api/components/<Comp>.md`, 22; 8 of them showcase pages)

- **Primitives**: `AmountField` — A money input: Rs prefix, right-aligned, tabular, 18px · `Badge` — A 24px pill on a row: a unit, a count, or a state — always a word · `Banner` — A soft tinted panel for a persistent state: done, needs attention, refused · `Button` — Buttons trigger one action each: primary for the screen's single main action, secondary for real alternatives, quiet for everything else · `Card` — A white surface on the page, 16px corners, 20px padding, lifted by shadow-card — no outline — holding one topic · `Dialog` — A modal for one decision: title, the facts needed, at most a field or two, and one primary action bottom-right · `KeyBar` — The bottom function-key bar: a light strip of soft key chips, every global key printed, in three bands (counter, goods, owner) · `ListRow` — A 44px row: name, one meta line, and a right-aligned figure — search results, customers, picker lists · `Select` — A native select restyled to the field: 44px, white, 10px corners, border edge, a navy chevron · `StatTile` — A tile holding one figure: label, figure, one meta line, all fixed-height so a row of tiles is perfectly even · `TabBar` — Phone navigation: five tabs — Sale, Receive, Customers, Day, More — in place of the key bar below 768px of screen · `Table` — A data table on a white surface (16px corners, shadow-card): 36px rows and 13px text on laptop and desktop, 44px rows and 14px text on tablet and phone, a page header, line hairlines between rows, figures right-aligned · `TextField` — A labelled single-line text input with a help or error line
- **Layout rules**: `LayoutColourMeaning` (showcase page) — Rule: green means done, amber needs attention, red refused — always with a word — blue is the brand and never a state, and nothing else is coloured · `LayoutDensity` (showcase page) — Rule: cart and table rows are 36px with 13px text on laptop and desktop, 44px with 14px text on tablet and phone · `LayoutFocusRing` (showcase page) — Rule: a solid 2px blue-600 focus ring, 2px offset, on everything focusable; never outline: none alone · `LayoutMoney` (showcase page) — Rule: money is right-aligned in tabular figures with constant decimals and never wraps · `LayoutPrimaryAction` (showcase page) — Rule: one primary action per screen, always at the end — full width at the bottom on phones, bottom-right from tablet up · `LayoutTileRow` (showcase page) — Rule: tiles in a row share one label style, a fixed one-line label height, equal heights and aligned baselines · `LayoutTouchTarget` (showcase page) — Rule: every control is at least 44 × 44px with 8px between neighbours
- **Print**: `Receipt` — The printed receipt: an 80 mm thermal slip (72 mm printable) that belongs to the pharmacy and the customer, in solid black only
- **Screens**: `Screens` (showcase page) — The Sale, Payment and Day screens built only from these primitives, at laptop (1280 × 800) and phone (375 × 812), to judge the look on real work
