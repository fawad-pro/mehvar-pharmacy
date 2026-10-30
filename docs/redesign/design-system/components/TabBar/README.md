Phone navigation: five tabs — Sale, Receive, Customers, Day, More — in place of the key bar below 768px of screen.

**Markup:** `<nav class="mv-tabbar" aria-label="Sections"><a class="mv-tab" aria-current="page" href="/sale"><span class="mv-tab__icon"><svg viewBox="0 0 24 24">…</svg></span>Sale</a>…</nav>`. Inside `.mv-screen` it shows itself on phones and the key bar hides; `mv-tabbar--show` forces it.

**The consumer provides** the five destinations and the current one. Sale → `/sale`, Receive → `/purchases` (F7 Receive Stock), Customers → `/customers` (Attach and Settle udhaar start there on a phone), Day → `/day` (owner only; dims for a salesman, never disappears), More → a sheet with Receipts, Products, Stock, Adjust and Switch user — the rest of the key bar, in its order.

- White bar with a hairline above; each tab at least 52px tall and a fifth of the width. Icon 22px in a pill; label 12px `ink-2`. Active: `blue-600` label and icon on a `blue-50` pill. Focus: the normal blue ring.
- The five icons are drawn line icons (cart, box, people, calendar, dots), stroke `currentColor`. They are this system's, not from the codebase, which ships none.
