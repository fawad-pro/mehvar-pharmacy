# Redesign — session primer

Read this, then `CLAUDE.md`, then PCN-016 and PCN-017 in
`docs/PLAN_CHANGE_NOTES.md`. Those two notes are the decisions; this file is
how to build them. Nothing here re-opens a decision: a flaw found while
building is a new plan-change note, raised before it is patched (CLAUDE.md,
"The one rule").

## The sources

- **Design system:** https://claude.ai/artifact/953PukwddDp5xxwrHjg5yr.
  Read its `project/README.md` and `project/tokens.json` first (Artifact
  `read` with `path`). Its primitives are plain CSS in
  `project/components/bundle.css` (classes `mv-*`); each component has a
  `project/components/<Name>/README.md`.
- **Screens:** the canvas https://claude.ai/artifact/BCxabuTecHxqCBjyutwCUw,
  242 boards on 10 pages. Board files are `project/<prefix>-….dc.html`; read
  only the boards for the screen in hand, with `paths`. Page styles are in
  `project/sale.css`, `suppliers.css`, `receipts.css` and the other page
  stylesheets beside them.

| Page                 | Prefix                                               | App folder                                                   |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| Sale (first page)    | `Main`, `Laptop-*`, `Tablet-*`, `Phone-*`, `Payment` | `src/app/(counter)/sale/`                                    |
| Dialogs              | `D-`, `Dialogs`                                      | `src/components/` settle, picker, quick item, PIN switch     |
| Receive stock        | `R-`                                                 | `src/app/(counter)/purchases/`                               |
| Invoices & suppliers | `S-`                                                 | `purchases/[purchaseId]`, `…/correct`, `purchases/suppliers` |
| Receipts & returns   | `X-`                                                 | `receipts/`, `returns/`                                      |
| Customers            | `C-`                                                 | `customers/`                                                 |
| Products             | `P-`                                                 | `products/` and below                                        |
| Stock & Adjust       | `K-`                                                 | `stock/`, `stock/adjust/`                                    |
| Day                  | `Y-`                                                 | `day/`                                                       |
| Settings & sign-in   | `G-`                                                 | `settings/`, `src/app/login/`, `src/app/owner/`              |

The boards are mockups: their figures are sample data, their markup is the
design system's classes, and they mark state with `is-hover`/`is-focus`. The
app's behaviour, copy and keys win wherever a board disagrees, unless PCN-016
says otherwise. A board that shows something PCN-016 does not list is a
question, not a decision.

**Which source wins.** PCN-016, then the canvas, then the design system. The
design system is for tokens, primitives and rules; its sample screens (the
Screens card, the Table and layout-rule examples) were drawn before the
screen rounds and are out of date where the canvas changed them. Known
differences:

- **Sale cart rows are one line:** name and strength, then a badge only
  when something needs attention ("More than in stock", "Expired",
  "Expires 11/26"). No batch, no routine expiry and no dosage form under the
  name. The selected row carries its unit toggle, − and + and its discount;
  other rows are plain text. Rows are 44 px at every width. The design
  system's samples still show a meta line with strength, batch and expiry;
  ignore it for the cart.
- **Batch and expiry stay** wherever they matter: Receive Stock (on screen,
  not behind "More details"), Stock, Adjust, Returns and the receipt page.

To see a board without the claude.ai page: save it with Artifact `read`,
put `ds/mehvar/tokens.css`, `ds/mehvar/components/bundle.css` and its page
stylesheet inline in its `<head>`, and screenshot it with Playwright
(`chromium.launch()`). Uploaded images (`/_blob/…`) will not load; the rest
renders as designed.

## How to build it

**Tokens first, in `src/app/globals.css`** (the only home for raw colour).
Add the design system's tokens to `:root` and expose them through
`@theme inline`, so Tailwind gives `text-navy`, `bg-page`, `bg-surface`,
`bg-blue-600`, `text-ink-2`, `border-border`, `text-amber-text`,
`bg-green-50`, `rounded-card`, `shadow-card` and so on. Move every use of the
old tokens to the new one that carries the same meaning, then delete the old
tokens; a test that fails if `green-900`, `green-600`, `green-100`, `paper`
or `ink/` opacity steps reappear in `src` keeps them gone.

**Then a small set of primitives in `src/components/ui/`**: Button (primary,
secondary, quiet), Field and AmountField, Select, Card, StatTile, Badge,
Banner, Dialog (a bottom sheet below 768 px, built on `OverlayBackdrop`,
which every modal already is), KeyBar chip, TabBar. Each is a thin wrapper
over Tailwind classes taken from `bundle.css`. Screens use them instead of
repeating class strings; that is what keeps 242 boards' worth of screens
from drifting.

**Then screen by screen, in this order**, each batch committed on its own:

1. **Foundation:** tokens, primitives, the top bar (the pharmacy's name, a
   slot for its logo, no Mehvar mark), the light key bar, the phone tab bar,
   the focus ring, page and card surfaces. Every screen picks up the new
   look here, before its own layout changes. Receipt footer: "Powered by
   Mehvar" in small type (the switch comes in batch 10).
2. **Sale**, Payment and the Sale dialogs (settle, attach, quick item,
   switch user; the optional phone number for a new customer).
3. **Receive Stock**, with PCN-017's month-and-year expiry (also on Adjust's
   found and opening stock).
4. **Invoices and suppliers.**
5. **Receipts and Returns**, and the refund slip's Before / Now.
6. **Customers.**
7. **Products.**
8. **Stock and Adjust**, with the expiring batch's Adjust link (W12).
9. **Day.**
10. **Settings, sign-in and the owner's view**, with the "Powered by Mehvar"
    setting (a tenant settings field; run `npm run db:grants` if a migration
    adds a table) and Reset PIN as a dialog.

Sale and Receive Stock are the screens used all day; spend the care there.

**Sessions.** One session builds one session's worth, then stops; a fresh
session starts the next. The ten batches run as seven sessions:

| Session | Batches                                                           | Model, effort  |
| ------- | ----------------------------------------------------------------- | -------------- |
| A       | 1 Foundation                                                      | Opus, medium   |
| B       | 2 Sale                                                            | Opus, high     |
| C       | 3 Receive Stock                                                   | Opus, high     |
| D       | 4 Invoices and suppliers + 6 Customers (the same account pattern) | Sonnet, medium |
| E       | 5 Receipts and Returns                                            | Opus, medium   |
| F       | 7 Products                                                        | Sonnet, medium |
| G       | 8 Stock and Adjust + 9 Day + 10 Settings                          | Sonnet, medium |

A session that finishes its batches early stops there; it does not start
the next session's.

## Done, per batch

- `npm run verify` clean, and the E2E specs for that screen run for real
  against a test database (`.env` must name one ending `_ci` or `_test`; the
  suite refuses anything else). In the cloud container that is `mehvar_ci`;
  start Postgres with `service postgresql start` after a restart.
- `e2e/key-budget.spec.ts`, `touch.spec.ts`, `scanner.spec.ts`,
  `slow-answers.spec.ts` and `keyboard-paths.spec.ts` pass. A spec that finds
  an element by a label the redesign renamed is updated to the new label;
  never loosen an assertion to make it pass (Day 13).
- The screen checked by eye at 1280, 768 and 375 px against its boards.
- No key changes meaning and no task takes an extra press. On phone, no key
  hints; from tablet up, hints come from `keyFor` only (Day 16).
- A CHANGELOG entry naming the batch and citing PCN-016 (and PCN-017 for
  batch 3).

## Working within the quota

The owner's token quota is tight; quality is not negotiable. Spend tokens on
building and checking, never on re-reading or re-printing.

- **Read narrowly.** Only the boards for the screen in hand (Artifact `read`
  with `paths`), and only the source files that screen touches. Do not read
  the whole canvas, the whole design system or whole planning phases; the
  decisions are in PCN-016 and PCN-017.
- **Test narrowly while building, fully once.** While a screen is in
  progress, run only its own specs (for example
  `npx playwright test e2e/sale.spec.ts`) and its unit tests. At the end of
  the batch, run the full "Done, per batch" set once. Never skip that run.
- **Keep test output short.** Pipe runs through `tail` or `grep` for the
  summary and failures (`… 2>&1 | grep -E "✘|passed|failed|Error"`); print
  a whole log only to diagnose a failure.
- **No narrating.** Short progress lines; the commit message and the
  CHANGELOG entry are the record.
- **Escalate, don't circle.** If a failure is not understood after one real
  attempt, stop and tell the owner what is failing and what was tried,
  rather than trying variations.

## Things that will bite

- **Labels the specs use.** Many specs find fields by their visible label
  ("Cash tendered", "Discount on the bill", "Pick a reason.", "Sales today",
  "Cash expected in drawer", "Owed to you, all time"). Day's tiles are
  renamed by PCN-016; change the spec with the screen, in the same commit.
- **Tap targets are measured** (`touch.spec.ts` reads `--touch-target`).
  Keep `--touch-target` and the 44 px minimum.
- **The scan guard** protects every field without `data-scan-target`; the
  Sale and Receive search fields keep `data-scan-target` and
  `data-scan-home`.
- **Esc** is kept with `preventDefault`, never `stopPropagation`; every
  printing screen prints before it confirms; focus is set from an effect
  after the field renders (the keyboard-walk lessons in CLAUDE.md).
- **Client components never import a module that reaches the database**, and
  a `'use server'` file never re-exports a type.
- **Prettier:** format only the files you change, and only if they were
  clean before (`git show HEAD:<file> | npx prettier --stdin-filepath <file>
--check`).
- **Balances** go through `positionOf` / `BalanceInline` on screen and on
  paper: words, never minus signs.

## Out of scope

The online/offline decision (PCN-004), licensing and packaging, accounts per
person and the "can receive stock" permission, hardware, and the deferred
items in PCN-016 (backup status row, splash screen). Raise anything else as a
plan-change note.
