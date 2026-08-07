/**
 * Strength, read the way a pharmacist reads it.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * Strength is the field where being wrong is dangerous rather than untidy. A
 * duplicate brand entry splits stock and annoys the owner; confusing Panadol
 * 500mg with Panadol 650mg reaches a patient. So strength is parsed into a
 * canonical value rather than compared as text, and everything that decides
 * "is this the same medicine?" compares the parsed form.
 *
 * WHAT A LABEL ACTUALLY SAYS
 *
 * Four shapes cover almost everything on a Pakistani shelf:
 *
 *   500mg              a single amount
 *   500mg+65mg         a combination — Panadol Extra
 *   875mg/125mg        also a combination, written with a slash — Augmentin 1g
 *   125mg/5ml          a CONCENTRATION — a syrup, mg per volume
 *
 * The third and fourth are the interesting pair, because they are written
 * identically and mean completely different things. The rule that separates
 * them is the one a pharmacist uses without thinking: **if both sides are the
 * same kind of quantity it is a combination; if they are different kinds it is
 * a concentration.** Mass over mass is two ingredients. Mass over volume is one
 * ingredient dissolved in something.
 *
 * NO FLOATS
 *
 * Amounts are integers in the smallest sensible unit — micrograms for mass,
 * microlitres for volume — for the same reason money is integer paisa (Phase 11
 * §2). `0.1 + 0.2` problems in a field that decides whether two medicines are
 * the same is not a class of bug worth having.
 */

/** The kinds of quantity a strength can be measured in. */
export type StrengthDimension = 'mass' | 'volume' | 'iu' | 'percent';

/**
 * Canonical units, one per dimension. Everything is converted on parse so two
 * labels written differently ("0.5g", "500mg") compare equal.
 */
const CANONICAL: Record<StrengthDimension, string> = {
  mass: 'mcg',
  volume: 'mcl',
  iu: 'iu',
  percent: 'm%',
};

/** Multipliers into the canonical unit of each dimension. */
const UNITS: Record<string, { dimension: StrengthDimension; factor: number }> = {
  mcg: { dimension: 'mass', factor: 1 },
  µg: { dimension: 'mass', factor: 1 },
  ug: { dimension: 'mass', factor: 1 },
  mg: { dimension: 'mass', factor: 1_000 },
  g: { dimension: 'mass', factor: 1_000_000 },
  gm: { dimension: 'mass', factor: 1_000_000 },
  kg: { dimension: 'mass', factor: 1_000_000_000 },

  mcl: { dimension: 'volume', factor: 1 },
  ml: { dimension: 'volume', factor: 1_000 },
  l: { dimension: 'volume', factor: 1_000_000 },

  iu: { dimension: 'iu', factor: 1 },
  u: { dimension: 'iu', factor: 1 },
  unit: { dimension: 'iu', factor: 1 },
  units: { dimension: 'iu', factor: 1 },

  // Percent is scaled by 1000 so "0.05%" stays an integer.
  '%': { dimension: 'percent', factor: 1_000 },
};

/** One ingredient's amount, or one concentration. */
export interface StrengthComponent {
  /** Integer, in the canonical unit of `dimension`. */
  readonly amount: number;
  readonly dimension: StrengthDimension;
  /**
   * Present for a concentration ("125mg/5ml"): the volume the amount is
   * dissolved in, AS WRITTEN.
   *
   * Not reduced here. Reduction is what makes 125mg/5ml and 25mg/ml compare
   * equal, but it also destroys the scale a person reads — reduced to lowest
   * terms the pair becomes 25mcg per 1mcl, which is arithmetically identical
   * and unrecognisable on a screen. So the parsed value keeps what the pack
   * says (D4) and `componentKey` does the reducing, because comparison is the
   * only thing that needs it.
   */
  readonly per?: { readonly amount: number; readonly dimension: StrengthDimension };
}

export interface ParsedStrength {
  readonly components: readonly StrengthComponent[];
  /** The label as written, kept so screens can show what the pack says (D4). */
  readonly raw: string;
}

function greatestCommonDivisor(a: number, b: number): number {
  let [x, y] = [Math.abs(a), Math.abs(b)];
  while (y !== 0) [x, y] = [y, x % y];
  return x || 1;
}

/**
 * `"500 mg"` → `{ amount: 500000, dimension: 'mass' }`.
 *
 * Returns null for anything unrecognised rather than guessing. A strength this
 * cannot read is not an error — plenty of legitimate labels are odd ("as
 * directed", "5mg/kg") — it simply means identity falls back to comparing the
 * text, which is the behaviour that existed before this module.
 */
function parseAmount(
  text: string,
  /**
   * Denominators may omit the number: "25mg/ml" is how a label writes "25mg per
   * 1ml", and refusing it would send an extremely common syrup down the
   * unparsed path. A NUMERATOR may not — a bare "mg" is not a strength, it is a
   * fragment, and reading it as 1mg would invent a medicine.
   */
  { bareUnitMeansOne = false }: { bareUnitMeansOne?: boolean } = {},
): { amount: number; dimension: StrengthDimension } | null {
  const pattern = bareUnitMeansOne
    ? /^([0-9]+(?:\.[0-9]+)?)?\s*([a-zµ%]+)$/i
    : /^([0-9]+(?:\.[0-9]+)?)\s*([a-zµ%]+)$/i;
  const match = pattern.exec(text.trim());
  if (!match) return null;

  const value = match[1] === undefined ? 1 : Number(match[1]);
  if (!Number.isFinite(value)) return null;

  const unit = UNITS[match[2]!.toLowerCase()];
  if (!unit) return null;

  const scaled = value * unit.factor;
  // A label finer than the canonical unit (0.0001mcg) is not a real label; it
  // is a parse that has gone wrong, so refuse rather than round to zero.
  if (!Number.isInteger(scaled)) return null;

  return { amount: scaled, dimension: unit.dimension };
}

/**
 * Reads one slash-separated piece, deciding between combination and
 * concentration by comparing dimensions.
 */
function parseSlashPiece(text: string): StrengthComponent[] | null {
  const sides = text.split('/');
  if (sides.length === 1) {
    const only = parseAmount(sides[0]!);
    return only ? [only] : null;
  }
  if (sides.length !== 2) return null;

  const left = parseAmount(sides[0]!);
  const right = parseAmount(sides[1]!, { bareUnitMeansOne: true });
  if (!left || !right) return null;

  // Same kind of quantity on both sides — two ingredients, written with a
  // slash the way Augmentin's "875mg/125mg" is.
  if (left.dimension === right.dimension) {
    return [left, right];
  }

  // Different kinds — one thing dissolved in another, kept as written.
  return [
    {
      amount: left.amount,
      dimension: left.dimension,
      per: { amount: right.amount, dimension: right.dimension },
    },
  ];
}

/**
 * Parses a strength label into its canonical components.
 *
 * Returns null when the label cannot be read, which callers must treat as
 * "compare as text" rather than "no strength".
 */
export function parseStrength(raw: string | null | undefined): ParsedStrength | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // Combinations are written with "+" and occasionally with "&".
  const pieces = trimmed.split(/[+&]/).map((piece) => piece.trim());
  const components: StrengthComponent[] = [];

  for (const piece of pieces) {
    const parsed = parseSlashPiece(piece);
    if (!parsed) return null;
    components.push(...parsed);
  }

  return components.length > 0 ? { components, raw: trimmed } : null;
}

/**
 * A stable string for one component, for use inside an identity key.
 *
 * This is where a concentration is reduced to lowest terms, so that every way
 * of writing the same syrup — 125mg/5ml, 250mg/10ml, 25mg/ml — produces one
 * key. Display never goes through here.
 */
export function componentKey(component: StrengthComponent): string {
  if (!component.per) {
    return `${component.amount}${CANONICAL[component.dimension]}`;
  }
  const divisor = greatestCommonDivisor(component.amount, component.per.amount);
  const numerator = component.amount / divisor;
  const denominator = component.per.amount / divisor;
  return `${numerator}${CANONICAL[component.dimension]}/${denominator}${CANONICAL[component.per.dimension]}`;
}

/**
 * A canonical, comparable string for a whole strength.
 *
 * Components are NOT sorted here. Order carries meaning — it pairs with the
 * order of the ingredients in the formula, and Augmentin 875/125 is not
 * Augmentin 125/875. `identity.ts` is where the two lists are zipped together
 * and sorted as pairs, which is the only place the pairing is known.
 */
export function strengthKey(parsed: ParsedStrength): string {
  return parsed.components.map(componentKey).join('+');
}

/**
 * Human-readable canonical strength, for showing a normalised value back to the
 * operator when the product form asks "did you mean this?".
 *
 * Deliberately renders in the unit a person would use rather than the canonical
 * one: nobody reads "500000mcg".
 */
export function formatStrength(parsed: ParsedStrength): string {
  return parsed.components
    .map((component) => {
      const head = readable(component.amount, component.dimension);
      return component.per
        ? `${head}/${readable(component.per.amount, component.per.dimension)}`
        : head;
    })
    .join(' + ');
}

function readable(amount: number, dimension: StrengthDimension): string {
  if (dimension === 'iu') return `${amount} IU`;
  if (dimension === 'percent') return `${trimZeros(amount / 1_000)}%`;

  const [big, small] = dimension === 'mass' ? ['g', 'mg'] : ['l', 'ml'];
  if (amount >= 1_000_000) return `${trimZeros(amount / 1_000_000)}${big}`;
  if (amount >= 1_000) return `${trimZeros(amount / 1_000)}${small}`;
  return `${amount}${dimension === 'mass' ? 'mcg' : 'mcl'}`;
}

function trimZeros(value: number): string {
  return String(Number(value.toFixed(4)));
}
