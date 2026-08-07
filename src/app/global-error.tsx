'use client';

/**
 * Last-resort boundary for errors thrown by the ROOT layout itself.
 *
 * A route-group `error.tsx` (see `(counter)/error.tsx`) sits inside the root
 * layout and cannot catch a failure in that layout. `global-error` replaces the
 * whole document, so it renders its own `<html>`/`<body>`.
 *
 * It carries NO colour — not even a token. The design tokens live in
 * `globals.css`, which is loaded by the root layout that just failed, so it may
 * be exactly what is missing here. Layout-only inline styles keep this readable
 * as plain black-on-white with no stylesheet at all, which is the whole point
 * of a last resort. Same posture as the counter boundary: a reload is one click
 * away (P2).
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Root layout error', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ maxWidth: '28rem', margin: '0 auto', padding: '3rem 2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Mehvar needs a reload</h1>
          <p style={{ marginTop: '0.75rem', lineHeight: 1.6 }}>
            The app hit an error it could not recover from on its own — often because it was updated
            while this window was open. Your data is safe. Reload to continue.
          </p>
          <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => {
                window.location.reload();
              }}
              style={{
                minHeight: '2.75rem',
                padding: '0 1.5rem',
                borderRadius: '0.375rem',
                border: '1px solid currentColor',
                background: 'transparent',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
              }}
              style={{
                background: 'none',
                border: 'none',
                textDecoration: 'underline',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
