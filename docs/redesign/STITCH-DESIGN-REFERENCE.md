# Google Stitch Design Reference — Mehvar Pharmacy Mobile Redesign
**Target Screens:** Sale & Receive Stock  
**Document Status:** Compact Reference Document  
**Sources:** `docs/redesign/design-system/` (`README.md`, `layout.md`, `tokens.json`, `tokens.css`, `components/`), `docs/redesign/canvas/` (`sale.css`, PRIMER.md), `src/app/globals.css`, `src/components/ui/`, `src/app/(counter)/`, `docs/PLAN_CHANGE_NOTES.md` (PCN-016, PCN-017, PCN-018).

---

## 1. Brand Colours & Design Tokens

### Core Semantic Principle
- **Brand ≠ Status; Status never decorates.** Blue and navy represent the brand and user actions; they never represent status. Green, amber, and red represent status only; they never decorate neutral elements.
- **Always paired with text or symbols:** Every state or status colour must be accompanied by an explicit word or mark (e.g. dot, triangle, icon).

### Colour Palette & Values

| Token | CSS Variable | Hex / Value | WCAG Contrast & Role |
| :--- | :--- | :--- | :--- |
| **navy** | `--navy` | `#012049` | **Brand Base / Text:** All headings, body text, and figures. Contrast 14.98:1 on `page`, 16.1:1 on `surface`. Never a status. |
| **blue-600** | `--blue-600` | `#0068b8` | **Brand Action:** The one primary button, active key/tab, focus ring (5.32:1 on page, 5.72:1 on surface), links. Never a status. |
| **blue-700** | `--blue-700` | `#00528f` | **Brand Action Hover/Pressed:** Primary button hover and pressed state (8.07:1 on white). |
| **blue-50** | `--blue-50` | `#e9f3fc` | **Selection Ground:** Selected list/table row, active tab pill background, focused field fill. Interaction only, never a status. Navy on it is 14.33:1. |
| **page** | `--page` | `#f4f7fa` | **Background:** Very light blue-grey page background behind cards and tables. |
| **surface** | `--surface` | `#ffffff` | **Card / Surface:** Cards, tiles, tables, lists, fields, dialogs, key bar, bottom action bar. |
| **mist** | `--mist` | `#eef2f7` | **Quiet Fill:** Key chips, neutral badges, skeleton bars, table headers, disabled fields, row hover fill. |
| **ink-2** | `--ink-2` | `#4a5a70` | **Secondary Text:** Labels, meta lines, helper text, table headers, quiet buttons, placeholders (6.54:1 on page, 7.03:1 on surface). |
| **border** | `--border` | `#7d8a9c` | **Control Edge:** Resting edge of fields, selects, and secondary buttons (3.26:1 on page, 3.51:1 on surface — the 3:1 control floor). |
| **line** | `--line` | `#e3e8ef` | **Dividers:** Hairlines inside tables/lists between rows only (1.23:1 on surface). It separates; it never bounds a card or control. |
| **green-700** | `--green-700` | `#1e7a4f` | **Done Mark/Text:** Synced, received, settled, day closed, paid in full. 5.31:1 on surface, 4.69:1 on `green-50`. Status only. |
| **green-50** | `--green-50` | `#e7f4ec` | **Done Ground:** Background for done badges, banners, and saved receipt summaries. |
| **amber** | `--amber` | `#b7791f` | **Attention Mark:** Attention dots, alert triangles, warning rules. 3.39:1+ on page/surface. Strictly for marks, never for text. |
| **amber-text** | `--amber-text`| `#8a5a12` | **Attention Text:** Warning badge words, banner lead word, tile attention figures, short-change amounts. 5.41:1 on `amber-50`. |
| **amber-50** | `--amber-50` | `#fdf4e3` | **Attention Ground:** Background for attention badges and banners. |
| **red** | `--red` | `#b3372e` | **Refused Mark/Text:** Expired stock, rejected actions, validation errors, failed loads. 5.22:1 on `red-50`. |
| **red-50** | `--red-50` | `#fbecea` | **Refused Ground:** Background for refused/error badges and banners. |
| **scrim** | `--scrim` | `rgba(1, 32, 73, 0.4)` | **Modal Backdrop:** Navy at 40% opacity behind dialogs and bottom sheets. |

---

## 2. Typography & Font Hierarchy

### Font Family & Numeral Rules
- **Family:** Single family — Inter (`--font-sans`: `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`).
- **Tabular Numerals Globally:** `font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1, 'cv11' 1;`.
- **Numbers cannot lie:** Money and quantity figures are strictly right-aligned (`mv-num` / `.numeral`), never wrap (`white-space: nowrap`), and retain uniform decimal precision down columns (two decimals in tables and input fields).

### Type Styles

| Style Token | Size / Line Height | Weight | Letter Spacing | Documented Usage |
| :--- | :--- | :--- | :--- | :--- |
| `change` | 72px / 1 | 600 | `-0.02em` | Change due on the payment overlay (navy; `amber-text` when short). |
| `total` | 44px / 1 | 600 | `-0.02em` | Main sale total, large account balances. |
| `title` | 24px / 32px | 600 | `-0.01em` | Screen titles. |
| `stat` | 24px / 32px | 600 | `-0.01em` | StatTile figures, mobile summary totals. |
| `field-lg` | 18px / 28px | 500 | `0` | Large entry fields: cash tendered, main search bar. |
| `heading` | 17px / 24px | 600 | `0` | Card titles, dialog titles, top bar shop name on desktop. |
| `control` | 15px / 22px | 500 | `0` | Primary interactive controls: buttons, text inputs, list row titles. Base body size. |
| `body-sm` | 14px / 20px | 400 | `0` | Helper text, secondary lines, banners, mobile cart/table row text. |
| `table` | 13px / 20px | 400 | `0` | Desktop/laptop dense table rows and cart lines (screen >=1024px). |
| `label` | 13px / 18px | 500 | `0` | Field and tile labels. Sentence case, `ink-2`, fixed 18px height (`--label-height`), single line (<=14 chars, never wraps). |
| `caption` | 12px / 16px | 500 | `0` | Badges, bottom tab bar labels, helper microcopy. |
| `kbd` | 12px / 16px | 600 | `0` | Function key hints on desktop/tablet controls (`F12`, `Esc`, `Enter`). **Hidden on mobile.** |

---

## 3. Spacing, Sizing & Border-Radius Scales

### 4px Spacing Scale
- `space-1` (**4px**): Micro gap inside vertical label/value stacks.
- `space-1-5` (**6px**): Gap from label to field; key icon to word inside chip.
- `space-2` (**8px**): Standard gap between adjacent buttons/controls (prevents tap collisions).
- `space-3` (**12px**): Table cell and field side padding; mobile card padding.
- `space-4` (**16px**): Gap between cards and tiles; mobile screen gutters.
- `space-5` (**20px**): Standard desktop padding inside cards and stat tiles.
- `space-6` (**24px**): Dialog inner padding; major desktop section gaps.
- `space-8` (**32px**): Screen gutters and top-bar horizontal padding on desktop/laptop.
- `space-10` (**40px**): Empty state vertical padding.

### Sizing & Touch Targets
- `touch-target` (**44px**): Absolute minimum touch target size (height and width) for all actionable controls on touch screens.
- `row-height` (**36px**): Table rows on laptop/desktop (screens >=1024px).
- `row-height-touch` (**44px**): Touch table rows (<1024px) and Sale cart rows across all viewports.
- `label-height` (**18px**): Fixed one-line height for input/tile labels (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`).

### Border-Radius Scale
- `radius-control` (**10px**): Buttons, input fields, selects, key chips, tab buttons.
- `radius-card` (**16px**): Cards, tiles, tables, lists, banners.
- `radius-dialog` (**20px**): Modal dialogs, top corners of mobile bottom sheets.
- `radius-pill` (**999px**): Badges, active mobile tab icon indicator pill.

---

## 4. Shadows, Borders & Surface Treatments

- **No Gray Card Outlines:** Surfaces sit on the `--page` (`#f4f7fa`) background lifted purely by shadows, **never bounded by gray outlines or borders**.
- **Shadow Tokens:**
  - `shadow-card`: `0 1px 2px rgba(1, 32, 73, 0.04), 0 4px 16px rgba(1, 32, 73, 0.06)` (resting cards, tiles, tables, lists).
  - `shadow-card-hover`: `0 2px 4px rgba(1, 32, 73, 0.05), 0 8px 24px rgba(1, 32, 73, 0.09)` (interactive cards/tiles on hover).
  - `shadow-pop`: `0 12px 32px -8px rgba(1, 32, 73, 0.18)` (search dropdowns, autocomplete menus).
  - `shadow-dialog`: `0 24px 48px -12px rgba(1, 32, 73, 0.22), 0 8px 16px -8px rgba(1, 32, 73, 0.08)` (modal dialogs).
  - `shadow-bar`: `0 -1px 0 var(--line), 0 -4px 16px rgba(1, 32, 73, 0.04)` (bottom bars: key bar, tab bar, sticky mobile pay bar).
  - `shadow-top`: `0 1px 0 var(--line)` (top header bar hairline separator).
- **Control Borders:**
  - Resting edge: 1px solid `--border` (`#7d8a9c`).
  - Hover edge: 1px solid `--navy` (`#012049`).
  - Focus edge: 1px solid `--blue-600` (`#0068b8`).
  - Error edge: 2px solid `--red` (`#b3372e`).
- **Dividers & Hairlines:**
  - Hairlines: 1px solid `--line` (`#e3e8ef`) between table/list rows and top/bottom bar edges. Hairlines separate rows; they never enclose components.
- **Focus Ring Treatment:**
  - `outline: 2px solid var(--blue-600); outline-offset: 2px;` on all focusable elements.
  - Inset ring (`outline-offset: -2px;`) inside lists, table rows, and options to prevent container clipping.

---

## 5. UI Primitives & Intended Usage

### Button (`mv-btn`)
- **Primary (`mv-btn--primary`):** Filled `blue-600`, white semibold text (5.72:1), 10px corners, subtle shadow (`0 1px 2px rgba(1,32,73,.12)`). Hover: `blue-700`. **Rule:** Strictly at most one primary button per screen, reserved for the screen's definitive forward action (e.g. `Pay`, `Receive stock`). Full-width on mobile.
- **Secondary (`mv-btn--secondary`):** White surface, `border` edge, navy text. Hover: `border-navy`, background `page`. Used for real alternative actions (e.g. `Attach customer`, `Add line`).
- **Quiet (`mv-btn--quiet`):** Borderless, transparent background, `ink-2` text. Hover: background `mist`, text `navy`. Used for secondary/tertiary options, dismissals, or table actions (`Remove`, `Cancel`).
- **Loading State:** Class `is-loading`, `aria-busy="true"`. Replaces action with progressive verb ("Saving…", "Receiving…") with a static 8px dot (`currentColor`, 0.7 opacity). No spinning animations.

### Fields & Inputs (`mv-field`)
- **Structure:** Vertical flex stack (`gap: 6px`). Label on top (`mv-label`), 44px control, optional help text (`mv-help`) or error message (`mv-msg-error`) beneath.
- **Text Input (`mv-input`):** 44px tall, 14px horizontal padding, 10px radius, 15px text. Placeholder in `ink-2`.
- **Amount Field (`mv-amount`):** Specialized currency input with absolute left-aligned `Rs` prefix, right-aligned tabular numerals, 18px medium text (`text-field-lg`), and `inputMode="decimal"`.
- **Select (`mv-select`):** Native select restyled with 12×8px navy SVG chevron at `right: 14px`, 40px right padding, 44px height.
- **Error State:** Field wrapper takes `is-error`, control gets 2px border in `--red`, error message beneath in 14px medium `--red` naming the recovery action.

### Badge (`mv-badge`)
- **24px Height Pill:** `radius-pill` (999px), 12px medium text, 6px dot prefix for status tones.
- **Tones:**
  - *Neutral:* `mist` fill, `navy` text (used for units and quantities: "2 strip", "10 tab").
  - *Done:* `green-50` fill, `green-700` text & dot (synced, settled).
  - *Attention:* `amber-50` fill, `amber-text` text, `amber` dot (low stock, expiring soon).
  - *Refused:* `red-50` fill, `red` text & dot (expired pack, blocked).
- **Rule:** Normal/in-stock states do not get badges. Badges are reserved for exceptions and attention states.

### Banner (`mv-banner`)
- **Persistent State Panel:** Tinted container with 18px SVG mark, bold lead word in status colour, sentence body in `navy`.
- **Tones:** `--done` (`green-50`), `--attention` (`amber-50`), `--refused` (`red-50`).
- **Variants:** Inset in card (`rounded-card`) or edge-to-edge strip below top bar (`mv-banner--strip`, 0 radius).

### Card (`mv-card`)
- **Topic Surface:** White surface, 16px radius, 20px padding (16px on mobile), `shadow-card`, no outline.
- **Interactive Card:** Transitions to `shadow-card-hover` on hover.

### StatTile (`mv-tile`)
- **Fixed 3-Row Grid:** Grid template rows: `18px` (label) / `32px` (figure) / `20px` (meta), `row-gap: 6px`.
- **Grid Symmetry:** Tiles in a row share uniform heights and baseline alignment. Figure right-aligned tabular nums (`text-stat`). Meta line holds time scope ("today", "all time").
- **Columns:** 4 columns on desktop/tablet, 2 columns on mobile (`grid-cols-2`).

### ListRow (`mv-row`)
- **44px Touch Row:** Flex container, 1px `line` hairline divider between rows.
- **Layout:** Title (15px 500), meta line (13px `ink-2`), right-aligned tabular figure or badge. Selected state fills `blue-50`.

---

## 6. Button, Input, Card, Dialog & Bottom-Sheet Conventions

### Mobile Bottom-Sheet Pattern
- **Breakpoint Transformation:**
  - At `>= 768px`: Centered modal dialog (`max-w-[400px]`, `rounded-dialog` 20px, `p-6`, `shadow-dialog`).
  - At `< 768px`: Automatically becomes a **Bottom Sheet** anchored to the viewport bottom.
- **Bottom-Sheet Styling Rules:**
  - Backdrop: `items-end p-0` (anchors panel to bottom edge).
  - Panel: `w-full max-w-none rounded-t-[20px] rounded-b-none px-4 pt-5 pb-6`.
  - Actions: Stacks vertically with primary button full width on top, secondary/quiet button below (`flex-col-reverse items-stretch w-full gap-2`).
- **Dismissal Conventions:**
  - *Pickers (Customer / Supplier):* Non-destructive; dismiss on backdrop tap or Cancel.
  - *Transaction Overlays (Payment / Cash / PIN):* Destructive/critical mid-transaction; backdrop tap is disabled. Requires explicit Cancel button or Esc to prevent accidental loss of typed input.

### Key Hints on Mobile
- **Strictly Hidden on Mobile:** `<kbd>` elements and key hint chips (`F12`, `F4`, `Esc`, `Enter`) are hidden below 768px (`max-md:hidden` / `display: none`). Phones have no function keys; showing them confuses mobile users.

---

## 7. Mobile Navigation & Responsive Layout Principles

### Breakpoints
- **Mobile (Phone):** `< 768px` (primary mobile target, 375px–430px base).
- **Tablet:** `768px` to `1023px`.
- **Desktop / Laptop:** `>= 1024px` (1280px+ base).

### Mobile Bottom Navigation (TabBar)
- **Automatic Swap:** Below 768px, the desktop keyboard `KeyBar` is hidden, and the 5-tab `TabBar` is shown at the screen bottom. Desktop navigation conventions (keyboard shortcuts F1–F10, three bands: counter, goods, owner) remain unchanged.
- **Five Primary Destinations:**
  - *Underlying Design System Baseline:* `Sale` | `Receive` | `Customers` | `Day` | `More`.
  - *Mobile Redesign Product Requirement (Intentional Change):*
    1. **Sale** (`/sale`) — Shopping cart line icon.
    2. **Receive** (`/purchases`) — Delivery box line icon.
    3. **Stock** (`/stock`) — Inventory box/shelf line icon. (*Replaces Customers in the primary tab bar for quick inventory lookup on the floor*).
    4. **Day** (`/day`) — Calendar/drawer line icon (owner only; dims for salesman, never removed).
    5. **More** (opens bottom sheet) — Triple dots icon (*`Customers` moves here alongside Receipts, Products, Adjust, Switch user*).
- **Tab Metrics:** Fixed grid with 5 equal columns (`grid-cols-5`), height >= 52px, 12px caption text in `ink-2`. Active tab has `blue-600` text and `blue-50` pill background behind the 22px icon (`w-12 h-7 rounded-pill`).

### Fixed Mobile Action Bar
- **Positioning:** Fixed sticky bar positioned above the bottom TabBar.
- **Structure:** Surface background, `shadow-bar` (hairline on top + soft upward shadow), padding `12px 16px`, containing summary metadata (item count, total figure) and the full-width 52px primary action button.
- **Scroll Clearance:** The scrolling main content container must have bottom padding >= `88px` (or equal to action bar height + tab bar height) so the last cart row or field scrolls completely clear of fixed bars.

### Software Keyboard & Android Input Behaviour (New Mobile UX Requirement)
*This is an intentional mobile UX requirement for the redesign, differing from desktop home-position autofocus:*
- **No Autofocus on Page Load:** Do not automatically focus search fields or trigger the software keyboard when a page initially mounts. On touch devices, unsolicited keyboards consume >40% of the screen and disorient the user.
- **Deliberate User Trigger Only:** The virtual keyboard opens only after an explicit, intentional tap on an input field.
- **Active Field Visibility:** When the software keyboard expands, the active field must remain in view (auto-scrolling into view if necessary), and critical contextual controls must not be obstructed.
- **Viewport Adaptation for Fixed Elements:** Fixed action bars (Pay / Receive bars) and bottom navigation must cleanly adapt to the resized visual viewport without colliding with or obscuring active inputs.

---

## 8. Screen-Specific Layout & Implementation Conventions

### Screen 1: Sale Screen

#### Desktop vs. Mobile Layout Structure
- **Desktop (>=1024px):** 2-column layout — Cart on left (~62% width), summary/payment rail on right (~38% width).
- **Tablet (768–1023px):** 1-column stack — Cart full width on top, rail below split into a 2-column grid.
- **Mobile (<768px):** Single vertical scroll stack:
  1. Top bar (Shop name 16px on one line with ellipsis, user role, no Mehvar logo).
  2. Search input (full width, 52px high, `text-field-lg` 18px).
  3. Cart container (dense table).
  4. Attached customer card (or "Cash walk-in / Attach customer" prompt).
  5. Last sale summary card (if recently committed).
  6. Sticky bottom Pay bar (Item count + discount on top, full-width `Pay Rs X,XXX.00` primary button).
  7. 5-Tab Bar.

#### Cart Table Mobile Adaptations
- **Row Height:** Uniform 44px (`row-height-touch`) for touch targets.
- **Column Reductions for Phone:**
  - *Desktop columns:* Product Name/Strength, Quantity controls, Unit Price, Discount, Line Total.
  - *Mobile columns:* 3 columns only:
    1. **Product Name & Strength:** Allowed to wrap on phone (`white-space: normal`) to ensure drug name and dosage strength are never truncated. Status badges (`Stock -2`, `Expired`) sit immediately beside name.
    2. **Quantity Stepper:** Compact `− [count] +` buttons (44px touch target) with active unit toggle ("strip" / "tab").
    3. **Line Total & Discount:** Line total amount right-aligned. The separate unit price and discount columns are dropped (`max-md:hidden`).
  - *Inline Discount Trigger on Phone:* Tapping the line total on the active/selected line opens the inline discount popover directly under the amount.

#### Payment Experience & Responsive Behaviour
- **Desktop/Laptop (Inline Checkout — No Modal):**
  - Total, Discount on the bill, Cash received, Owner PIN approval, Change due, and the Pay button remain **inline within the right rail (~38% column)** of the Sale screen.
  - Desktop does not open a modal or sheet for normal payment; the operator keys cash directly while viewing the cart.
- **Mobile (Dedicated Payment Bottom Sheet):**
  - Tapping "Pay" from the sticky mobile bar opens a focused **Payment Bottom Sheet** using standard design-system bottom-sheet conventions (`max-md:items-end`, `rounded-t-[20px] rounded-b-none`, `shadow-dialog`, full-width stacked actions).
  - **State Retention on Dismissal:** The payment interface must retain all entered values (tendered amount, discount input, PIN status) if dismissed and reopened within the same active sale.
  - **Preserve Existing Logic (No Invented Behaviour):** Retains all established business rules:
    - Split payment (Cash vs Udhaar / Credit).
    - Exact change calculation with huge `text-change` (72px) numerals (rendered in `amber-text` when short of total).
    - Bill discount entry and owner PIN approval threshold.
    - Customer attachment and udhaar balance calculation (`PositionInline`: "Owes", "Advance", "Settled up").
    - Receipt issuance and print trigger upon sale completion.

---

### Screen 2: Receive Stock Screen

#### Desktop vs. Mobile Layout Structure
- **Desktop (>=1024px):** Top header with supplier picker & invoice details, line entry form in one horizontal row, lines table below, totals and receive action in right rail.
- **Mobile (<768px):** Single vertical scroll stack:
  1. Top bar (Shop name, "Receive stock" section header).
  2. Supplier & Invoice Card:
     - Supplier picker button: Full width (`col-span-full`), displays selected supplier and live balance ("you owe Rs 4,500.00").
     - Invoice number & Invoice date: Stacked in 2 equal columns (`grid-cols-2`).
  3. Product Search: Barcode/search input with scan target attributes.
  4. Line Entry Form (Active item being added):
     - Desktop's single row transforms on mobile into a 2-column grid (`grid-cols-2`).
     - Fields: Qty, Bonus, Cost each, Expiry (`MM/YYYY`), Batch, MRP of 1 pack, Sells for.
     - "Add line" button spans full width (`col-span-2`) at the bottom of the card.
  5. Received Lines Table: Displays added items with horizontal scroll (`overflow-x-auto min-w-[600px]`), or card-row format with batch & expiry clearly visible.
  6. Sticky Mobile Action Bar: Displays Invoice Total + line count on top, with full-width primary "Receive stock" button (52px tall).
  7. 5-Tab Bar.

#### Date Entry Convention (PCN-017)
- **Expiry Entry:** Typed strictly as month and year (`MM/YY` or `MM/YYYY`), displayed everywhere as `MM/YYYY` (e.g. `03/2028`). Never an exact day picker.

---

## 9. Design System vs. Implementation & Product Decisions

| Area | Documented Design System Rule | Inferred Implementation / Updated Product Decision |
| :--- | :--- | :--- |
| **Mobile Navigation Tabs** | Documented in DS README & `layout.md` as `Sale \| Receive \| Customers \| Day \| More`. | **Intentional Product Redesign Decision:** Updated to `Sale \| Receive \| Stock \| Day \| More` (`Stock` promoted to main bar; `Customers` moved under `More`). Desktop navigation and shortcuts remain unchanged. |
| **Sale Payment Flow** | DS mockups show inline controls on desktop and payment overlay. | **Clarified Responsive Behaviour:** Desktop keeps all checkout controls inline in the right rail (no modal). Mobile uses a dedicated bottom sheet that retains entered values when dismissed and reopened, preserving all underlying payment/udhaar logic. |
| **Keyboard Autofocus** | Desktop is keyboard-first and autofocuses search on initial mount (Phase 7 rule 1). | **New Mobile UX Requirement:** No autofocus or unsolicited software keyboard on initial page load on mobile. Keyboard opens only on deliberate user tap, keeping the active field visible and adapting fixed bars to the viewport. |
| **Sale Cart Row Height** | Originally documented as 36px desktop / 44px mobile in early DS README. | PCN-016 and `sale-surface.tsx` explicitly standardized cart rows to **44px at every width**. |
| **Mobile Cart Columns** | `layout.md` mentions dropping secondary columns on phone. | Implementation (`cart-table.tsx` & `sale.css`) explicitly drops **Unit Price** and **Discount** columns; the line total amount doubles as the discount editor trigger on mobile. |
| **Drug Name Wrapping** | Primitives prescribe single-line truncation (`ellipsis`). | In `sale.css` and `cart-table.tsx`, cart rows allow the first cell to wrap (`white-space: normal`) so drug name and strength are never cut off. |
| **Dialog to Bottom Sheet** | Documented in `layout.md` and PCN-016. | Implemented via `OverlayBackdrop` with `max-md:items-end` and action row `max-md:flex-col-reverse max-md:items-stretch`. |
| **Fixed Mobile Action Bar** | Documented in `layout.md` Rule 3. | Implemented in `sale.css` with `.sv-paybar` (`bottom: 66px`, 52px button) and `.sv-scroll` with `padding-bottom: 88px` for clearance. |

---

## 10. Information Not Established from Sources

1. **Secondary SVG Icon Set:** Outside the line icons for the mobile `TabBar` (sale, receive, stock/box, day, more) and the 3 status banner marks, no dedicated icon set exists. Inline SVGs and chevrons are hand-drawn in CSS/SVG.
2. **Gesture Dismissal for Bottom Sheets:** Existing bottom sheets use CSS positioning (`items-end`) and close via backdrop tap or cancel buttons; touch drag-down/swipe-to-dismiss velocity thresholds are not defined.
3. **Near-Expiry Cart Badge Data:** The "Expires soon" badge for cart items was deferred in PCN-018 pending backend catalog payload updates.
4. **Virtual Keyboard Framework Hook:** While mobile UX requirements for keyboard avoidance (no autofocus on load, viewport adaptation, active field visible) are now specified for the redesign, specific viewport resize implementation hooks (e.g. `window.visualViewport` listeners or CSS `interactive-widget`) are not yet present in the existing codebase.
