import { describe, expect, it } from 'vitest';

import { scanCandidates, type KeyStroke } from './burst';

/** Keys typed `gap` ms apart, starting at `from`. */
function typed(text: string, gap: number, from = 1_000): KeyStroke[] {
  return [...text].map((key, index) => ({ key, at: from + index * gap }));
}

const enterAfter = (strokes: KeyStroke[], ms = 5): number => strokes.at(-1)!.at + ms;

describe('a scan, told apart from typing', () => {
  it('offers the scanned code first', () => {
    const strokes = typed('8961101721817', 4);
    expect(scanCandidates(strokes, enterAfter(strokes))?.[0]).toBe('8961101721817');
  });

  it('keeps the whole code across a stutter inside the scan', () => {
    // The pilot failure: a 90 ms gap after the fourth digit.
    const strokes = [...typed('8961', 4), ...typed('101721817', 4, 1_100)];
    expect(scanCandidates(strokes, enterAfter(strokes))?.[0]).toBe('8961101721817');
  });

  it('leaves out what a person typed before it, after a pause', () => {
    const strokes = [...typed('12', 150), ...typed('010896400159017017280331', 4, 3_000)];
    expect(scanCandidates(strokes, enterAfter(strokes))?.[0]).toBe('010896400159017017280331');
  });

  it('still offers the bare code when a person’s key ran into the scan', () => {
    // "2" typed just before the scanner fired: the catalogue lookup picks the
    // shorter candidate that is a real barcode.
    const strokes = [{ key: '2', at: 900 }, ...typed('8961101721817', 4)];
    expect(scanCandidates(strokes, enterAfter(strokes))).toContain('8961101721817');
  });

  it('is not a scan when a person types, however long the number', () => {
    const strokes = typed('8961101721817', 120);
    expect(scanCandidates(strokes, enterAfter(strokes, 150))).toBeNull();
  });

  it('is not a scan when the burst is shorter than any barcode', () => {
    const strokes = typed('1500', 4);
    expect(scanCandidates(strokes, enterAfter(strokes))).toBeNull();
  });

  it('is not a scan when Enter comes late, after the burst stopped', () => {
    const strokes = typed('8961101721817', 4);
    expect(scanCandidates(strokes, enterAfter(strokes, 400))).toBeNull();
  });
});
