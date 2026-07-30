/**
 * Text normalization for the client index — Phase 10 §5, ADR-4.
 *
 * The counter's search has to survive how a salesman actually types: reading a
 * handwritten prescription, transliterating from Urdu, in a hurry, on a keyboard
 * he does not look at. Phase 1 §5 names the requirement — "search must resolve
 * brand names, including the misspellings that come from reading handwritten
 * prescriptions" — and Phase 10 §5 names the canonical example: panadol,
 * pandol, penadol must all find Panadol.
 *
 * Everything here is pure and cheap. It runs once per product at index build,
 * and once per keystroke on the query — never per product per keystroke.
 */

/** Lowercase, strip accents, reduce punctuation to spaces, collapse runs. */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalize(text);
  return normalized === '' ? [] : normalized.split(' ');
}

/**
 * Digraph folds for Roman-Urdu transliteration drift.
 *
 * Deliberately short. Each entry is a substitution seen in real Pakistani
 * pharmacy spelling, and every addition widens the net for false matches too —
 * Phase 13's Day 2 risk note is explicit that fuzzy tuning is a rabbit hole, so
 * this list is meant to stay roughly this size.
 */
const DIGRAPHS: Array<[RegExp, string]> = [
  [/ph/g, 'f'], // Phenergan / Fenergan
  [/ck/g, 'k'], // Diclofenac / Diclofenak
  [/qu/g, 'k'],
  [/x/g, 'ks'],
  [/v/g, 'w'], // Ventolin / Wentolin
  [/y/g, 'i'],
];

const VOWELS = /[aeiou]/g;

/**
 * The consonant skeleton of a word, after digraph folding.
 *
 * Vowels are where transliteration drifts most — they are guessed, doubled and
 * dropped — while consonants survive. "panadol", "pandol" and "penadol" all
 * reduce to "pndl", so a skeleton match catches in one comparison what edit
 * distance would need a threshold to reach.
 *
 * Collisions are expected and harmless: this is a candidate signal, and final
 * ranking still weighs edit distance and length.
 */
export function skeleton(word: string): string {
  let folded = normalize(word).replace(/\s+/g, '');
  for (const [pattern, replacement] of DIGRAPHS) {
    folded = folded.replace(pattern, replacement);
  }
  const consonants = folded.replace(VOWELS, '').replace(/(.)\1+/g, '$1');
  // A word that is all vowels ("ora") keeps its folded form rather than vanishing.
  return consonants === '' ? folded : consonants;
}

/** Trigrams of a padded string, used to prefilter fuzzy candidates. */
export function trigrams(text: string): string[] {
  const padded = ` ${normalize(text).replace(/\s+/g, ' ')} `;
  if (padded.length < 3) {
    return [];
  }
  const grams: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    grams.push(padded.slice(i, i + 3));
  }
  return grams;
}

/**
 * Damerau-Levenshtein distance, abandoned once it exceeds `max`.
 *
 * Bounded on purpose: an unbounded distance over a 3,000-product catalog on
 * every keystroke is exactly the shape of code that feels fine on a seeded demo
 * and misses I2's budget in a real shop. Callers only ever ask "is this within
 * tolerance", so computing beyond the tolerance is wasted work.
 */
export function boundedDistance(a: string, b: string, max: number): number {
  if (a === b) {
    return 0;
  }
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;

  let previous: number[] = Array.from({ length: shorter.length + 1 }, (_, i) => i);
  let beforePrevious: number[] = [];

  for (let i = 1; i <= longer.length; i += 1) {
    const current: number[] = [i];
    // Only the band within `max` of the diagonal can matter.
    const from = Math.max(1, i - max);
    const to = Math.min(shorter.length, i + max);

    for (let j = 1; j < from; j += 1) {
      current[j] = max + 1;
    }

    for (let j = from; j <= to; j += 1) {
      const substitution = longer[i - 1] === shorter[j - 1] ? 0 : 1;
      let best = Math.min(
        (previous[j] ?? max + 1) + 1,
        (current[j - 1] ?? max + 1) + 1,
        (previous[j - 1] ?? max + 1) + substitution,
      );

      // Transposition — "panadlo" for "panadol" is one slip, not two.
      if (i > 1 && j > 1 && longer[i - 1] === shorter[j - 2] && longer[i - 2] === shorter[j - 1]) {
        best = Math.min(best, (beforePrevious[j - 2] ?? max + 1) + 1);
      }

      current[j] = best;
    }

    for (let j = to + 1; j <= shorter.length; j += 1) {
      current[j] = max + 1;
    }

    if (Math.min(...current.slice(from, to + 1)) > max) {
      return max + 1;
    }

    beforePrevious = previous;
    previous = current;
  }

  return previous[shorter.length] ?? max + 1;
}

/** Tolerance scales with query length: short queries cannot afford much slack. */
export function distanceTolerance(queryLength: number): number {
  if (queryLength <= 3) return 0;
  if (queryLength <= 5) return 1;
  if (queryLength <= 8) return 2;
  return 3;
}

/** A scanner emits digits and an Enter. Long digit runs are barcodes, not names. */
export function looksLikeBarcode(raw: string): boolean {
  const digits = raw.trim();
  return /^\d{6,}$/.test(digits);
}
