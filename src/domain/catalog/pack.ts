/**
 * The catalogue pack — a file, so the catalogue can grow without a new build.
 *
 * WHY A FILE
 *
 * Phase 6 makes the catalogue a strategic asset that "decays without
 * maintenance". Maintenance that requires shipping a new application build is
 * maintenance that will not happen at the rate the data needs: an MRP
 * notification or a batch of newly registered products should reach a pharmacy
 * in a day, not in a release cycle. So the catalogue travels as data — a single
 * versioned file that the installer drops in at setup and that later updates
 * replace, with the running application reading whatever it finds.
 *
 * WHAT IS IN IT
 *
 * Identity only, exactly as Phase 6 §2 draws the line: names, manufacturers,
 * formulae, forms, strengths, known pack structures, known barcodes, reference
 * MRPs. No prices-as-charged, no stock, no tenant anything. A pack is
 * distributable to every pharmacy precisely because there is nothing in it that
 * belongs to any of them (T3).
 *
 * COMPATIBILITY, HONESTLY
 *
 * `format` is the shape of the file and `catalogVersion` is the freshness of
 * the data — separate numbers because they change for separate reasons. An
 * application that meets a `format` newer than it understands REFUSES the pack
 * and says so. It does not import the fields it recognises and skip the rest:
 * a partially understood catalogue is worse than an old one, because nobody can
 * tell which parts of it are missing.
 */

import type { PackLevel } from '@/lib/quantity';

/**
 * The pack shape this build understands.
 *
 * Bump only for a change that an older reader would get WRONG — a renamed
 * field, a changed meaning, a new required field. Adding an optional field
 * that an old reader can safely ignore is not a format change.
 */
export const PACK_FORMAT = 1;

/** Data quality, per Phase 6 §5. The counter never sees this; curation does. */
export type PackQuality = 'verified' | 'reference';

export interface PackProduct {
  readonly name: string;
  readonly manufacturer?: string | null;
  readonly formulaText?: string | null;
  readonly form?: string | null;
  readonly strength?: string | null;
  readonly packLevels?: readonly PackLevel[];
  /** Paisa per base unit. A ceiling for reference, never a price (D4). */
  readonly referenceMrpPaisa?: number | null;
  readonly quality: PackQuality;
  readonly barcodes?: readonly { readonly barcode: string; readonly unitLevelName: string }[];
}

export interface CatalogPack {
  readonly format: number;
  /**
   * Freshness, as `YYYY.MM.N` — a date an operator can read and a curator can
   * increment several times in a month. Compared segment-wise, so 2026.8.10 is
   * newer than 2026.8.9 rather than alphabetically older.
   */
  readonly catalogVersion: string;
  readonly generatedAt: string;
  /** Stated so a truncated file fails loudly instead of importing silently short. */
  readonly productCount: number;
  readonly products: readonly PackProduct[];
}

export type PackProblem =
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'format-too-new'; readonly found: number; readonly understood: number }
  | { readonly kind: 'bad-version'; readonly found: string }
  | { readonly kind: 'count-mismatch'; readonly declared: number; readonly actual: number }
  | { readonly kind: 'no-products' }
  | { readonly kind: 'bad-product'; readonly index: number; readonly detail: string };

export type PackReadResult =
  | { readonly ok: true; readonly pack: CatalogPack }
  | { readonly ok: false; readonly problem: PackProblem };

/** I5 — name the fix, not the rule. These are read by a person, not a log. */
export function describeProblem(problem: PackProblem): string {
  switch (problem.kind) {
    case 'unreadable':
      return `That file is not a catalogue pack (${problem.detail}).`;
    case 'format-too-new':
      return `This catalogue was made for a newer version of Mehvar (pack format ${problem.found}, this copy reads ${problem.understood}). Update Mehvar, then import it again.`;
    case 'bad-version':
      return `The catalogue version “${problem.found}” is not in the expected YYYY.MM.N form.`;
    case 'count-mismatch':
      return `The file says it holds ${problem.declared} medicines but contains ${problem.actual}. It may have been cut short in transit — download it again.`;
    case 'no-products':
      return 'That catalogue is empty.';
    case 'bad-product':
      return `Medicine ${problem.index + 1} in the file is unusable: ${problem.detail}.`;
  }
}

const VERSION_PATTERN = /^\d{4}\.\d{1,2}\.\d+$/;

/**
 * Compares two catalogue versions segment-wise.
 *
 * String comparison would put "2026.8.9" after "2026.8.10", which is exactly
 * the kind of quiet wrongness that lets an import silently go backwards.
 */
export function compareCatalogVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a parsed JSON value as a pack.
 *
 * Every rejection names what is wrong and, where there is one, what to do about
 * it. A pack that fails here has not been partially imported — reading and
 * applying are separate steps on purpose.
 */
export function readPack(raw: unknown): PackReadResult {
  if (!isObject(raw)) {
    return { ok: false, problem: { kind: 'unreadable', detail: 'not a JSON object' } };
  }

  const format = raw.format;
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
    return { ok: false, problem: { kind: 'unreadable', detail: 'missing a format number' } };
  }
  if (format > PACK_FORMAT) {
    return { ok: false, problem: { kind: 'format-too-new', found: format, understood: PACK_FORMAT } };
  }

  const catalogVersion = raw.catalogVersion;
  if (typeof catalogVersion !== 'string' || !VERSION_PATTERN.test(catalogVersion)) {
    return {
      ok: false,
      problem: { kind: 'bad-version', found: String(catalogVersion ?? '') },
    };
  }

  const products = raw.products;
  if (!Array.isArray(products)) {
    return { ok: false, problem: { kind: 'unreadable', detail: 'no products array' } };
  }
  if (products.length === 0) {
    return { ok: false, problem: { kind: 'no-products' } };
  }

  const declared = raw.productCount;
  if (typeof declared === 'number' && declared !== products.length) {
    return {
      ok: false,
      problem: { kind: 'count-mismatch', declared, actual: products.length },
    };
  }

  const checked: PackProduct[] = [];
  for (const [index, candidate] of products.entries()) {
    const problem = validateProduct(candidate, index);
    if (problem) return { ok: false, problem };
    checked.push(candidate as PackProduct);
  }

  return {
    ok: true,
    pack: {
      format,
      catalogVersion,
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
      productCount: products.length,
      products: checked,
    },
  };
}

function validateProduct(candidate: unknown, index: number): PackProblem | null {
  if (!isObject(candidate)) {
    return { kind: 'bad-product', index, detail: 'not an object' };
  }
  if (typeof candidate.name !== 'string' || candidate.name.trim() === '') {
    return { kind: 'bad-product', index, detail: 'it has no name' };
  }
  if (candidate.quality !== 'verified' && candidate.quality !== 'reference') {
    return {
      kind: 'bad-product',
      index,
      detail: `quality must be "verified" or "reference", not "${String(candidate.quality)}"`,
    };
  }
  if (candidate.packLevels !== undefined) {
    if (!Array.isArray(candidate.packLevels)) {
      return { kind: 'bad-product', index, detail: 'packLevels is not a list' };
    }
    for (const level of candidate.packLevels) {
      if (
        !isObject(level) ||
        typeof level.name !== 'string' ||
        typeof level.factor !== 'number' ||
        !Number.isInteger(level.factor) ||
        level.factor < 1
      ) {
        return {
          kind: 'bad-product',
          index,
          detail: 'a pack level needs a name and a whole-number factor of at least 1',
        };
      }
    }
  }
  if (
    candidate.referenceMrpPaisa !== undefined &&
    candidate.referenceMrpPaisa !== null &&
    (typeof candidate.referenceMrpPaisa !== 'number' ||
      !Number.isInteger(candidate.referenceMrpPaisa) ||
      candidate.referenceMrpPaisa < 0)
  ) {
    // Money is integer paisa everywhere in this system (Phase 11 §2); a pack
    // carrying rupees-as-decimals would be a hundredfold error.
    return { kind: 'bad-product', index, detail: 'referenceMrpPaisa must be whole paisa' };
  }
  return null;
}

/** Parses and validates in one step, turning a thrown JSON error into a problem. */
export function readPackJson(text: string): PackReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      problem: {
        kind: 'unreadable',
        detail: error instanceof Error ? error.message : 'invalid JSON',
      },
    };
  }
  return readPack(parsed);
}
