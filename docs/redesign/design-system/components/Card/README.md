A white surface on the page, 16px corners, 20px padding, lifted by `shadow-card` — no outline — holding one topic.

**Markup:** `<div class="mv-card"><h3 class="mv-card__title">Today’s purchases</h3>…</div>`. Use `<a class="mv-card">` or `<button class="mv-card">` when the whole card opens something.

**The consumer provides** a title and content.

- Hover (interactive only): lifts to `shadow-card-hover`. Disabled: 40% with a reason ("Needs internet — selling keeps working."). Loading: `mv-skel` bars. Error: red message with "Try again". Empty: teach the key.
- No grey outlines, no coloured left borders, no tinted backgrounds.
