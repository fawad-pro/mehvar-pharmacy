'use client';

/**
 * What a section shows when the request that fills it fails.
 *
 * Settings loaded four sections with no answer to a failed request: each sat
 * on "Loading…" for good, its Save did nothing, and the user list looked like
 * a shop with no users. A section that cannot load says so and offers the
 * retry, rather than look like a different, wrong state.
 */
export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <p className="text-red text-sm" role="alert">
      {what} did not load — the shop&rsquo;s computer did not answer.{' '}
      <button type="button" onClick={onRetry} className="font-medium underline">
        Try again
      </button>
    </p>
  );
}

/** For a save or change that threw rather than answered. */
export const NO_ANSWER = 'That did not save — the shop’s computer did not answer. Try again.';
