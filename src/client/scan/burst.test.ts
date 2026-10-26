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

  it('is a scan when a busy PC stretches gaps to 74 ms and the Enter to 59 ms', () => {
    // Recorded on Receive Stock (dev build, Playwright): two of six scans had
    // a trailing gap or Enter just over 50 ms, were taken for typing, and the
    // digits went into Unit cost.
    const at = (gaps: number[], from: number): number[] =>
      gaps.map((_, index) => from + gaps.slice(0, index + 1).reduce((a, b) => a + b, 0));
    const lateEnter = at([0, 58, 72, 63, 47, 35, 14, 16, 13, 13, 10, 44, 53], 5_000);
    const strokes = [
      ...typed('512', 160),
      ...[...'2030297825992'].map((key, index) => ({ key, at: lateEnter[index]! })),
    ];
    expect(scanCandidates(strokes, strokes.at(-1)!.at + 59)).toContain('2030297825992');

    const slowTail = at([0, 43, 41, 12, 11, 13, 16, 68, 57, 39, 55, 57, 74], 9_000);
    const tail = [...'2030297963847'].map((key, index) => ({ key, at: slowTail[index]! }));
    expect(scanCandidates(tail, tail.at(-1)!.at + 53)?.[0]).toBe('2030297963847');
  });

  it('is not a scan when a fast typist enters a long number, Enter included', () => {
    const strokes = typed('8961101721817', 80);
    expect(scanCandidates(strokes, enterAfter(strokes, 90))).toBeNull();
  });
});
