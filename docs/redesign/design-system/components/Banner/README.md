A soft tinted panel for a persistent state: done, needs attention, refused. Inset in a screen with 16px corners, or a full-width strip under the top bar with `mv-banner--strip`.

**Markup:** `<div class="mv-banner mv-banner--attention" role="note"><svg class="mv-banner__mark">…</svg><span class="mv-banner__text"><strong>Needs attention.</strong> …</span><button class="mv-btn mv-btn--secondary">Sync now</button></div>`. Tones `--done`, `--attention`, `--refused`.

**The consumer provides** the sentence (lead word in `strong`), an optional single action, and the role (`note` for furniture, `alert` for a failure just now).

- Grounds `green-50`, `amber-50`, `red-50`; no border. The lead word takes the status colour — `green-700`, `amber-text` (never plain `amber`, which is for the mark), `red`; the rest of the sentence is `navy`.
- Renders nothing when there is nothing to say; a banner that is always there stops being read.
