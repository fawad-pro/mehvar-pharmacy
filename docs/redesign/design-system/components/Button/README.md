Buttons trigger one action each: primary for the screen's single main action, secondary for real alternatives, quiet for everything else.

**Markup:** `<button type="button" class="mv-btn mv-btn--primary">Pay <span class="mv-kbd">F12</span></button>`. Variants `mv-btn--primary`, `--secondary`, `--quiet`; `mv-btn--block` for full width.

**The consumer provides** a verb as the label and, where one exists, its key in `mv-kbd`.

- One primary per screen, last in its row, bottom-right (full width on phones). On Sale it is Pay F12; attaching a customer for udhaar is Attach F4, a secondary on the customer card — never a second commit button.
- Min 44 × 44px. Primary padding 20px, secondary 16px, quiet 12px.
- Primary is `blue-600` with white 600-weight text (5.72:1), 10px corners; hover `blue-700`. Secondary: white with a `border` edge, hover edge `navy` on `page`. Quiet: `ink-2`, hover `navy` on `mist`. Focus: 2px `blue-600` ring. Disabled: 40% opacity. Loading: add `is-loading`, `aria-busy="true"`, `aria-disabled="true"` and change the verb ("Saving…"). Error: the button returns to default and a `mv-msg-error` line under it says what to do.
- Don't put two primaries on one screen, colour a button green, amber or red (those are states), or use an icon without a word.
