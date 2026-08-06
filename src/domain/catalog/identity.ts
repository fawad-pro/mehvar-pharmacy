/**
 * "Is this the same medicine?" — and the more useful question underneath it.
 *
 * THE CENTRAL DISTINCTION
 *
 * There are two questions a pharmacy asks about two medicines, and conflating
 * them is the design error this module exists to avoid.
 *
 *   1. "Have I already got this?"      → IDENTITY
 *   2. "Can I give this instead?"      → EQUIVALENCE
 *
 * Identity is brand + strength + form + manufacturer. Two rows matching on all
 * four are one product entered twice — the thing that splits stock across two
 * catalogue entries and makes both figures wrong.
 *
 * Equivalence is formula + strength + form. Panadol and Paracip are both
 * paracetamol 500mg tablets; they are NOT duplicates, they are alternatives,
 * and a pharmacy stocks several on purpose. Software that "deduplicates" them
 * has destroyed real inventory.
 *
 * So: identity blocks, equivalence informs. The operator is never told that
 * stocking two brands of the same molecule is a mistake, because it isn't.
 *
 * THE THIRD CHECK
 *
 * A near-match on brand with a DIFFERENT strength is the one worth interrupting
 * for. "You have Panadol 500mg; this is 650mg" is either a legitimate second
 * line or a typo, and the cost of the two is not symmetric — a typo'd strength
 * is a dispensing error waiting to happen. That check has no equivalent in a
 * general-purpose product catalogue and is the reason this module is
 * pharmacy-shaped rather than generic.
 */

import { normaliseForm } from './form';
import { componentKey, parseStrength, type ParsedStrength } from './strength';

/** The identity fields, as they exist on a tenant product or a global entry. */
export interface MedicineIdentity {
  readonly name: string;
  readonly strength?: string | null;
  readonly form?: string | null;
  readonly manufacturer?: string | null;
  readonly formulaText?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Text normalisation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Casefold, strip punctuation, collapse whitespace.
 *
 * Deliberately does NOT strip spaces entirely: "Panadol Extra" and "Panadol"
 * are different products, and a normaliser that removed the boundary would be
 * one step from merging them.
 */
export function normaliseText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9%+/. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? null : cleaned;
}

/**
 * Company names carry legal furniture that varies by who typed them.
 * "Getz Pharma (Pvt) Ltd", "Getz Pharma Pvt. Limited" and "GETZ PHARMA" are one
 * manufacturer.
 *
 * What this cannot do is unify "GSK" with "GlaxoSmithKline" — that is knowledge,
 * not string handling, and it belongs in curated catalogue data rather than in
 * a regex that would eventually guess wrong.
 */
const COMPANY_NOISE =
  /\b(pvt|private|ltd|limited|inc|llc|co|company|corp|corporation|pharma|pharmaceutical|pharmaceuticals|laboratories|laboratory|labs|lab|industries|healthcare|health care)\b/g;

export function normaliseManufacturer(raw: string | null | undefined): string | null {
  const base = normaliseText(raw);
  if (!base) return null;
  const stripped = base.replace(COMPANY_NOISE, ' ').replace(/\s+/g, ' ').trim();
  // If stripping left nothing, the name WAS the furniture ("Pharma Ltd") — keep
  // the original rather than collapsing every such company into one.
  return stripped === '' ? base : stripped;
}

/**
 * Splits a formula into its ingredients, normalised and in written order.
 *
 * Order is preserved rather than sorted, because it pairs positionally with the
 * strength components — see `identityKey`.
 */
export function normaliseFormula(raw: string | null | undefined): string[] {
  const base = normaliseText(raw);
  if (!base) return [];
  return base
    .split(/[+&,]|\band\b/)
    .map((part) => part.replace(/\b(bp|usp|ip|ph eur|anhydrous|as trihydrate|trihydrate)\b/g, ''))
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '');
}

/* -------------------------------------------------------------------------- */
/* Keys                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Pairs each ingredient with its amount, then sorts by ingredient.
 *
 * This is the subtle part. Sorting the strengths alone would make Augmentin
 * 875/125 and a hypothetical 125/875 identical, which they are not. Sorting the
 * ingredients alone has the same problem in reverse. Zipping them first keeps
 * "amoxicillin 875" attached to "amoxicillin" no matter which order the label
 * writes them in, so "Amoxicillin+Clavulanic 875mg/125mg" and
 * "Clavulanic+Amoxicillin 125mg/875mg" — the same medicine, written two ways —
 * produce one key.
 *
 * When the counts do not line up (a formula naming one ingredient against a
 * two-part strength, which real data does contain), each list is sorted on its
 * own. That is weaker but never wrong in the dangerous direction: it can only
 * fail to spot a duplicate, never invent one.
 */
function composition(formula: string[], strength: ParsedStrength | null): string {
  const amounts = strength ? strength.components.map(componentKey) : [];

  if (formula.length > 0 && formula.length === amounts.length) {
    return formula
      .map((ingredient, index) => `${ingredient}:${amounts[index]}`)
      .sort()
      .join('|');
  }

  return `${[...formula].sort().join('+')}|${[...amounts].sort().join('+')}`;
}

/**
 * "Have I already got this?"
 *
 * Brand, strength, form and manufacturer. Two products with the same key are
 * the same product — one of them should not have been created.
 *
 * Manufacturer is INCLUDED because the same brand name from two companies is a
 * real and common thing in Pakistan, and they are separately stocked, separately
 * priced items. Excluding it would merge them.
 *
 * An absent field contributes an empty segment rather than being skipped, so a
 * product with no recorded manufacturer never accidentally matches one that has
 * a manufacturer recorded.
 */
export function identityKey(medicine: MedicineIdentity): string {
  const parsed = parseStrength(medicine.strength);
  return [
    normaliseText(medicine.name) ?? '',
    // Falls back to the normalised text when the strength cannot be parsed, so
    // an unusual label still deduplicates against itself.
    parsed ? parsed.components.map(componentKey).join('+') : (normaliseText(medicine.strength) ?? ''),
    normaliseForm(medicine.form) ?? '',
    normaliseManufacturer(medicine.manufacturer) ?? '',
  ].join('');
}

/**
 * "Can I give this instead?"
 *
 * Formula, strength and form — no brand, no manufacturer. Everything sharing
 * this key is clinically interchangeable at the counter, which is what a
 * pharmacist means by "same medicine, different company".
 *
 * Returns null when there is no formula recorded. That is honest rather than
 * unfortunate: without knowing the molecule, nothing can be said about
 * substitution, and a key built from brand alone would claim otherwise.
 */
export function equivalenceKey(medicine: MedicineIdentity): string | null {
  const formula = normaliseFormula(medicine.formulaText);
  if (formula.length === 0) return null;

  return [
    composition(formula, parseStrength(medicine.strength)),
    normaliseForm(medicine.form) ?? '',
  ].join('');
}

/* -------------------------------------------------------------------------- */
/* Comparing a candidate against what is already stocked                       */
/* -------------------------------------------------------------------------- */

export type MatchKind =
  /** Same product. Creating it again would split the stock. */
  | 'duplicate'
  /** Same brand and form, DIFFERENT strength. Possibly a typo, possibly a real second line. */
  | 'strength-differs'
  /** Same molecule, different brand. A legitimate alternative, never a problem. */
  | 'alternative';

export interface CatalogMatch<T> {
  readonly kind: MatchKind;
  readonly product: T;
}

export interface MatchOptions<T> {
  /** Pulls the identity fields off whatever the caller's product shape is. */
  readonly identify: (item: T) => MedicineIdentity;
  /** Excluded from comparison — the product being edited is not its own duplicate. */
  readonly ignoreId?: string;
  readonly idOf?: (item: T) => string;
}

/**
 * Finds everything already in the catalogue that a candidate should be checked
 * against, classified by what kind of relationship it is.
 *
 * Returns duplicates first, then strength differences, then alternatives —
 * most-blocking first, so a caller that shows only the head shows the thing
 * that matters most.
 */
export function findCatalogMatches<T>(
  candidate: MedicineIdentity,
  existing: readonly T[],
  options: MatchOptions<T>,
): CatalogMatch<T>[] {
  const candidateIdentity = identityKey(candidate);
  const candidateEquivalence = equivalenceKey(candidate);
  const candidateName = normaliseText(candidate.name);
  const candidateForm = normaliseForm(candidate.form);
  const candidateStrength = parseStrength(candidate.strength);

  const matches: CatalogMatch<T>[] = [];

  for (const item of existing) {
    if (options.ignoreId && options.idOf && options.idOf(item) === options.ignoreId) {
      continue;
    }

    const other = options.identify(item);

    if (identityKey(other) === candidateIdentity) {
      matches.push({ kind: 'duplicate', product: item });
      continue;
    }

    /*
     * Same brand, same form, different strength.
     *
     * Checked before equivalence because it is the more urgent statement about
     * the same pair of products, and checked on BRAND rather than formula
     * because that is where the typo happens: somebody typing a second Panadol
     * line and mistyping the milligrams.
     */
    const sameName = candidateName !== null && normaliseText(other.name) === candidateName;
    const sameForm = normaliseForm(other.form) === candidateForm;
    if (sameName && sameForm) {
      const otherStrength = parseStrength(other.strength);
      const differs =
        candidateStrength && otherStrength
          ? strengthSignature(candidateStrength) !== strengthSignature(otherStrength)
          : normaliseText(other.strength) !== normaliseText(candidate.strength);
      if (differs) {
        matches.push({ kind: 'strength-differs', product: item });
        continue;
      }
    }

    if (candidateEquivalence !== null && equivalenceKey(other) === candidateEquivalence) {
      matches.push({ kind: 'alternative', product: item });
    }
  }

  const order: Record<MatchKind, number> = {
    duplicate: 0,
    'strength-differs': 1,
    alternative: 2,
  };
  return matches.sort((left, right) => order[left.kind] - order[right.kind]);
}

function strengthSignature(parsed: ParsedStrength): string {
  return parsed.components.map(componentKey).join('+');
}

/**
 * Which of a reference list a catalogue does not have yet.
 *
 * Used by `db:seed` to top up an existing demo pharmacy. Matching is by
 * `identityKey`, not by name, for the reason this whole module exists: a
 * product somebody typed by hand as "Panadol 0.5g tab" is the same medicine as
 * the seed's "Panadol 500mg Tablet", and adding a second one beside it would
 * split its stock — which is exactly the damage a top-up is supposed to avoid
 * causing.
 *
 * Returns what is MISSING and never what differs. A product already present is
 * left alone whatever its price or pack levels say: on a database somebody has
 * been developing against, those may have been changed deliberately, and
 * overwriting them is the tenant-data form of the silent rewrite P8 forbids.
 */
export function missingFromCatalog<T>(
  reference: readonly T[],
  existing: readonly MedicineIdentity[],
  identify: (item: T) => MedicineIdentity,
): T[] {
  const present = new Set(existing.map(identityKey));
  return reference.filter((item) => !present.has(identityKey(identify(item))));
}
