A labelled single-line text input with a help or error line.

**Markup:** `<label class="mv-field"><span class="mv-label">Customer name</span><input class="mv-input"><p class="mv-help">…</p></label>`. Add `is-error` (with `aria-invalid`) or `is-loading` (with `aria-busy`) on `mv-field`.

**The consumer provides** the label (sentence case, 14 characters or fewer), the value, and the help or message text.

- 44px tall, 14px padding, white, 10px corners, `border` edge (3.26:1); hover `navy`; focus `blue-600` edge plus the ring. Label above in the 13px sentence-case `label` style.
- Error: 2px `red` border and a `mv-msg-error` that names the fix. Empty: a placeholder that teaches what to type, in `ink-2`.
- Don't stack the label beside the field at phone width, or hide the label behind the placeholder.
