A modal for one decision: title, the facts needed, at most a field or two, and one primary action bottom-right.

**Markup:** `<div class="mv-scrim"><div class="mv-dialog" role="dialog" aria-modal="true" aria-labelledby="t"><h2 class="mv-dialog__title" id="t">…</h2>…<div class="mv-dialog__actions"><button class="mv-btn mv-btn--quiet">Cancel <span class="mv-kbd">Esc</span></button><button class="mv-btn mv-btn--primary">Settle <span class="mv-kbd">Enter</span></button></div></div></div>`.

**The consumer provides** the title, content, and the two actions; focus moves to the first field on open and returns on close.

- `scrim` backdrop (navy 40%), white, 20px corners (`radius-dialog`), `shadow-dialog`, 24px padding, max 400px wide. Esc cancels, Enter commits.
- Error: a refused Banner at the top of the dialog. Loading: the primary in its loading state. Disabled: primary disabled until the input is valid.
