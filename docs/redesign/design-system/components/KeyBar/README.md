The bottom function-key bar: a light strip of soft key chips, every global key printed, in three bands (counter, goods, owner).

**Markup:** `<nav class="mv-keybar" aria-label="Function keys"><a class="mv-key" aria-current="page" href="/sale"><kbd class="mv-kbd">F1</kbd><span class="mv-key__label">Sale</span></a>…</nav>`. First key of a new band gets `is-band`.

**The consumer provides** the keys from the registry (F1 Sale … F10 Switch user), the current route, and the role.

- White bar with a hairline and faint shadow above. Each key is a 44px `mist` chip, 10px corners, key in navy 600, word in `ink-2`. Active key fills `blue-600` with white text; hover `blue-50`; focus is the normal blue ring. Bands are split by a short hairline. On phones the bar scrolls; chips never shrink.
- Keys a role cannot use stay in place at 45% with `aria-disabled` — the map never rearranges. Dimmed text there does not meet 4.5:1, by design: the key is unavailable.

- Tablet and up only. Below 768px of screen the key bar is replaced by the TabBar (Sale, Receive, Customers, Day, More); `.mv-screen` does the switch.
