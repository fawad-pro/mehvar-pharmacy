/**
 * Expanding the starter catalogue — the breadth behind Phase 6 §3.
 *
 * WHAT THIS IS
 *
 * Phase 6 §3 draws the launch catalogue in two parts: a hand-checked *head* (the
 * ~150 fastest movers in `seed-data.ts`, marked `verified`) and a much broader
 * *body* of registered Pakistani products for identity breadth (§3.1, marked
 * `reference`). This module builds the body. It takes the compact, human-edited
 * source in `scripts/db/catalog-data.ts` — molecules, their real Pakistani
 * brands, and the presentations each is sold in — and expands it into the flat
 * list of `PackProduct`s the pack format carries.
 *
 * WHY A GENERATOR RATHER THAN 5,000 LITERAL ROWS
 *
 * A pharmacy stocks the same molecule under many brands and each brand in a
 * handful of strengths and forms. Writing that product out longhand is both
 * enormous and impossible to keep honest — the fiftieth hand-typed paracetamol
 * row is where a wrong strength hides. The source instead states each fact once
 * (this molecule comes as a 500mg and a 650mg tablet; these brands sell it) and
 * this function multiplies them out deterministically. The same input always
 * produces the same catalogue, in the same order.
 *
 * WHAT IT WILL NOT DO
 *
 * It invents nothing the source did not state. No barcodes (Phase 6 §4 — those
 * accumulate from real scans, never from a name), no prices (D4 — the pack in
 * hand is authoritative), no manufacturer where the source left one out. Every
 * expanded row is `reference` quality: its identity is credible and DRAP-shaped,
 * but its pack structure was not individually inspected the way the verified
 * head's was, and the tiering says so honestly (Phase 6 §5).
 *
 * Pure, so it is testable without a database and reusable by the build script,
 * the setup path and the tests alike (Phase 11 §1/§2).
 */

import type { PackLevel } from '@/lib/quantity';

import { identityKey } from './identity';
import type { PackProduct } from './pack';

/**
 * One way a molecule is presented on a shelf — a form, the strengths it comes in
 * for that form, and the unit it is sold and counted in.
 */
export interface StarterPresentation {
  /** Dosage form, in the vocabulary of `form.ts` (e.g. 'Tablet', 'Syrup'). */
  readonly form: string;
  /** The base unit stock is counted in — 'tab', 'cap', 'bottle', 'vial', 'tube'. */
  readonly baseUnit: string;
  /** Strengths for this form. `null` is a real value: a form with no strength. */
  readonly strengths: readonly (string | null)[];
  /**
   * Known pack levels above the base unit. Omitted deliberately for most
   * reference rows: strip and box sizes vary product to product and inventing a
   * "strip of 10" for all of them would be false pack data (Phase 6 §5). The
   * pharmacy records the real structure when it receives stock (W7).
   */
  readonly packLevels?: readonly PackLevel[];
}

/** A brand of a molecule, and who makes it. */
export interface StarterBrand {
  readonly name: string;
  /** The maker. Omitted rather than guessed when it is not known (never invented). */
  readonly manufacturer?: string | null;
  /**
   * Which of the molecule's presentation keys this brand actually ships. Most
   * brands sell one form, so this narrows the expansion to the truth rather than
   * multiplying every brand across every form the molecule has. Defaults to all
   * of the molecule's presentations when omitted.
   */
  readonly forms?: readonly string[];
}

/** A molecule, its therapeutic category, its presentations and its brands. */
export interface StarterMolecule {
  readonly generic: string;
  readonly category: string;
  /** Presentation keys → the presentation. Keys are referenced by `StarterBrand.forms`. */
  readonly presentations: Readonly<Record<string, StarterPresentation>>;
  readonly brands: readonly StarterBrand[];
  /**
   * Also emit a product named by the generic itself, with no manufacturer.
   *
   * Honest breadth: a great many Pakistani SKUs are stocked under the salt name,
   * and a generic entry is always true where a guessed brand↔maker pairing is
   * not. Manufacturer is left absent (not invented), and the pharmacy attaches
   * its actual brand when receiving stock. Only set where the generic reads as a
   * real product name — never for a combination salt.
   */
  readonly includeGeneric?: boolean;
}

/**
 * A standalone product that is not a molecule with brands — a front-of-store
 * item, a consumable, a device. Carried verbatim.
 */
export interface StarterItem {
  readonly name: string;
  readonly manufacturer?: string | null;
  readonly category: string;
  readonly form?: string | null;
  readonly strength?: string | null;
  readonly formula?: string | null;
  readonly baseUnit: string;
  readonly packLevels?: readonly PackLevel[];
}

export interface StarterSource {
  readonly molecules: readonly StarterMolecule[];
  readonly items: readonly StarterItem[];
}

export interface StarterExpansion {
  /** The deduplicated products, ready for the pack. */
  readonly products: readonly PackProduct[];
  /** Distinct products per category, for the launch-readiness report. */
  readonly categoryCounts: Readonly<Record<string, number>>;
  /** How many rows collapsed into an existing identity — a curation signal. */
  readonly duplicates: number;
}

function baseLevels(baseUnit: string, packLevels?: readonly PackLevel[]): PackLevel[] {
  return [{ name: baseUnit, factor: 1 }, ...(packLevels ?? [])];
}

/**
 * Expands the source into `PackProduct`s, deduplicated by medicine identity.
 *
 * Identity is brand + strength + form + manufacturer (`identity.ts`), so two
 * brands of the same molecule stay distinct while the same brand written twice
 * collapses — the first occurrence wins, and the count of what collapsed is
 * returned rather than hidden, because a duplicate in the source is a curation
 * error someone should see.
 *
 * An optional `seen` set lets a caller reserve identities that are already
 * spoken for elsewhere — the verified head — so the reference body never shadows
 * a hand-checked entry.
 */
export function expandStarter(
  source: StarterSource,
  reserved?: ReadonlySet<string>,
): StarterExpansion {
  const products: PackProduct[] = [];
  const categoryCounts: Record<string, number> = {};
  const seen = new Set<string>(reserved ?? []);
  let duplicates = 0;

  const add = (product: PackProduct, category: string): void => {
    const key = identityKey({
      name: product.name,
      strength: product.strength ?? null,
      form: product.form ?? null,
      manufacturer: product.manufacturer ?? null,
      formulaText: product.formulaText ?? null,
    });
    if (seen.has(key)) {
      duplicates += 1;
      return;
    }
    seen.add(key);
    products.push(product);
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  };

  for (const molecule of source.molecules) {
    const brands = molecule.includeGeneric
      ? [...molecule.brands, { name: molecule.generic, manufacturer: null }]
      : molecule.brands;
    for (const brand of brands) {
      const formKeys = brand.forms ?? Object.keys(molecule.presentations);
      for (const formKey of formKeys) {
        const presentation = molecule.presentations[formKey];
        if (!presentation) continue;
        for (const strength of presentation.strengths) {
          add(
            {
              name: brand.name,
              manufacturer: brand.manufacturer ?? null,
              formulaText: molecule.generic,
              form: presentation.form,
              strength,
              packLevels: baseLevels(presentation.baseUnit, presentation.packLevels),
              referenceMrpPaisa: null,
              quality: 'reference',
            },
            molecule.category,
          );
        }
      }
    }
  }

  for (const item of source.items) {
    add(
      {
        name: item.name,
        manufacturer: item.manufacturer ?? null,
        formulaText: item.formula ?? null,
        form: item.form ?? null,
        strength: item.strength ?? null,
        packLevels: baseLevels(item.baseUnit, item.packLevels),
        referenceMrpPaisa: null,
        quality: 'reference',
      },
      item.category,
    );
  }

  return { products, categoryCounts, duplicates };
}
