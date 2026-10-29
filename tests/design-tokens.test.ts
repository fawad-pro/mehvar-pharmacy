/**
 * The green palette stays gone (PCN-016).
 *
 * The redesign moved every use of Phase 10 §6's tokens to the design system's
 * token that carries the same meaning, then deleted the old ones. Tailwind
 * does not fail on a class whose colour no longer exists — `bg-green-600`
 * would silently render as nothing, or as Tailwind's own default green, which
 * is the brand-as-status confusion PCN-016 exists to end. So the old names are
 * refused here, in every file under `src`, whatever kind of file it is.
 *
 * `ink/` opacity steps are refused too: `ink/50` and `ink/40` failed contrast,
 * and secondary text is now one token, `ink-2`, that clears it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

const RETIRED: ReadonlyArray<{ pattern: RegExp; instead: string }> = [
  { pattern: /\bgreen-900\b/, instead: 'navy (text) — the key bar is light now' },
  { pattern: /\bgreen-600\b/, instead: 'blue-600 (the primary action, links)' },
  {
    pattern: /\bgreen-100\b/,
    instead: 'blue-50 (selection), mist (quiet fill) or green-50 (done)',
  },
  {
    pattern: /(?:\b(?:bg|text|border|from|to|divide|ring)-paper\b|--paper(?![-\w]))/,
    instead: 'page or surface',
  },
  {
    pattern: /(?:\b(?:bg|text|border|ring|divide|placeholder:text)-ink\/\d+|--ink(?![-\w]))/,
    instead: 'ink-2 or navy',
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css|mjs)$/.test(name) ? [path] : [];
  });
}

describe('the retired green palette', () => {
  const files = sourceFiles(SRC);

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const { pattern, instead } of RETIRED) {
    it(`no file uses ${pattern.source}`, () => {
      const offenders = files.flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((line, index) =>
            pattern.test(line) ? [`${relative(process.cwd(), file)}:${index + 1}`] : [],
          ),
      );
      expect(offenders, `use ${instead}`).toEqual([]);
    });
  }

  it('would catch one if it came back', () => {
    for (const sample of [
      'bg-green-600',
      'text-green-900',
      'hover:bg-green-100/50',
      'bg-paper',
      'text-ink/50',
      'var(--paper)',
    ]) {
      expect(
        RETIRED.some(({ pattern }) => pattern.test(sample)),
        sample,
      ).toBe(true);
    }
    for (const sample of [
      'text-ink-2',
      'bg-page',
      'text-green-700',
      'bg-green-50',
      'paper invoice',
    ]) {
      expect(
        RETIRED.some(({ pattern }) => pattern.test(sample)),
        sample,
      ).toBe(false);
    }
  });
});
