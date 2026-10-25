/**
 * Telling a barcode scanner from a person typing — pure, so it is testable.
 *
 * A keyboard-wedge scanner (I1) types into whatever field has the cursor. On
 * Receive Stock the cursor sits in a line's Qty after a product is chosen, so
 * scanning the next product used to type its barcode into Qty — or into Unit
 * cost, where the scanner's own Enter would add a line costing trillions.
 *
 * Speed says THAT it was a scan: a scanner types a few milliseconds per
 * character and presses Enter straight after, which no person does. Speed alone
 * cannot say where the code BEGAN — a busy PC stretches the odd gap inside a
 * scan, and the pilot run lost the first four digits of an EAN that way. So the
 * fast run only detects the scan; the code is then looked for among the run's
 * endings, longest first, and the caller keeps the one the catalogue knows.
 */

export interface KeyStroke {
  /** `KeyboardEvent.key`: a single character. */
  readonly key: string;
  /** `KeyboardEvent.timeStamp`: when the key was pressed, in ms. */
  readonly at: number;
}

/** Scanners type a character every few ms; fast typists manage ~80–150 ms. */
export const MAX_GAP_MS = 50;
/** A stutter inside a scan can stretch a gap this far; a person pauses longer. */
export const MAX_STUTTER_MS = 200;
/** Keys the trailing fast run needs before it counts as a scanner at all. */
export const MIN_FAST_RUN = 6;
/** Shorter than any real barcode (EAN-8 is 8), longer than any real quantity. */
export const MIN_SCAN_LENGTH = 8;

/**
 * The codes the keys ending with this Enter could have been, longest first —
 * or null when they were not a scan. `strokes` are the printable keys since
 * the last Enter, oldest first; `enterAt` is when Enter was pressed.
 */
export function scanCandidates(strokes: readonly KeyStroke[], enterAt: number): string[] | null {
  const last = strokes[strokes.length - 1];
  if (!last || enterAt - last.at > MAX_GAP_MS) {
    return null;
  }
  let fastStart = strokes.length - 1;
  while (fastStart > 0 && strokes[fastStart]!.at - strokes[fastStart - 1]!.at <= MAX_GAP_MS) {
    fastStart -= 1;
  }
  if (strokes.length - fastStart < MIN_FAST_RUN) {
    return null;
  }
  let start = fastStart;
  while (start > 0 && strokes[start]!.at - strokes[start - 1]!.at <= MAX_STUTTER_MS) {
    start -= 1;
  }
  const text = strokes
    .slice(start)
    .map((stroke) => stroke.key)
    .join('');
  const candidates: string[] = [];
  for (let length = text.length; length >= MIN_SCAN_LENGTH; length -= 1) {
    candidates.push(text.slice(text.length - length));
  }
  return candidates.length > 0 ? candidates : null;
}
