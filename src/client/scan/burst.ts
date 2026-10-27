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
/**
 * A stutter inside a scan can stretch a gap this far — including the gap
 * before the scanner's own Enter; a person pauses longer.
 */
export const MAX_STUTTER_MS = 200;
/** Shorter than any real barcode (EAN-8 is 8), longer than any real quantity. */
export const MIN_SCAN_LENGTH = 8;

/**
 * The codes the keys ending with this Enter could have been, longest first —
 * or null when they were not a scan. `strokes` are the printable keys since
 * the last Enter, oldest first; `enterAt` is when Enter was pressed.
 *
 * The keys run back from Enter for as long as no gap exceeds a stutter. They
 * were a scan when that run is barcode-long and its TYPICAL gap (the median)
 * is a scanner's. Judged by the median, not by every gap, because a busy PC
 * stretches the odd gap — in the middle, at the end, or before Enter — past
 * 50 ms, and a scan missed for one slow key landed in a price field. No person
 * types eight keys with half their gaps under 50 ms.
 */
export function scanCandidates(strokes: readonly KeyStroke[], enterAt: number): string[] | null {
  const last = strokes[strokes.length - 1];
  if (!last || enterAt - last.at > MAX_STUTTER_MS) {
    return null;
  }
  let start = strokes.length - 1;
  while (start > 0 && strokes[start]!.at - strokes[start - 1]!.at <= MAX_STUTTER_MS) {
    start -= 1;
  }
  const run = strokes.slice(start);
  if (run.length < MIN_SCAN_LENGTH) {
    return null;
  }
  const gaps = run
    .slice(1)
    .map((stroke, index) => stroke.at - run[index]!.at)
    .concat(enterAt - last.at)
    .sort((a, b) => a - b);
  if (gaps[Math.floor((gaps.length - 1) / 2)]! > MAX_GAP_MS) {
    return null;
  }
  const text = run.map((stroke) => stroke.key).join('');
  const candidates: string[] = [];
  for (let length = text.length; length >= MIN_SCAN_LENGTH; length -= 1) {
    candidates.push(text.slice(text.length - length));
  }
  return candidates;
}
