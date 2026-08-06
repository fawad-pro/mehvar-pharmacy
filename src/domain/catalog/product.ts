/**
 * Product validation — pure (Phase 11 §2).
 *
 * Everything here takes data in and returns data out, so the rules that protect
 * stock arithmetic are testable without a database and reusable by any caller:
 * the Products screen today, W7's inline create on Day 6, W6's quick item on
 * Day 3.
 *
 * Writers return typed results rather than throwing; the UI maps reasons to I5
 * messages, and no message text is composed here.
 */

import type { PackLevel } from '@/lib/quantity';

export type ProductRejection =
  | { reason: 'name_required' }
  | { reason: 'base_unit_required' }
  | { reason: 'price_required' }
  | { reason: 'price_negative' }
  | { reason: 'pack_level_name_required'; index: number }
  | { reason: 'pack_level_factor_invalid'; index: number }
  | { reason: 'pack_level_duplicate_name'; name: string }
  | { reason: 'pack_level_collides_with_base'; name: string }
  | { reason: 'pack_level_not_ascending'; index: number }
  | { reason: 'min_stock_negative' }
  | { reason: 'barcode_required' }
  | { reason: 'barcode_unknown_unit_level'; unitLevelName: string };

export type Validated<T> = { ok: true; value: T } | { ok: false; rejections: ProductRejection[] };

export interface ProductDraft {
  name: string;
  manufacturer: string | null;
  form: string | null;
  strength: string | null;
  formulaText: string | null;
  baseUnitName: string;
  packLevels: PackLevel[];
  /** Paisa per base unit. */
  pricePaisa: number;
  mrpPaisa: number | null;
  minStockBaseUnits: number | null;
  needsCompletion: boolean;
  /**
   * The shared-catalogue identity this product was created from, if any.
   *
   * Kept so Phase 6 §4's downward flow has somewhere to land: a corrected
   * composition or a newly known barcode can be OFFERED to the products that
   * came from that identity. Never used to overwrite anything — a pharmacy's
   * catalogue is never silently rewritten under it (P8).
   */
  globalProductId: string | null;
}

/**
 * Validates pack levels — the structure all stock arithmetic depends on.
 *
 * Phase 5 §2: a base unit plus optional grouping levels above it, factors
 * expressed in base units. Getting this wrong does not produce a validation
 * error later; it produces silently wrong stock, which is the one failure the
 * product cannot have (P4). Hence the rules are strict here rather than
 * forgiving:
 *
 *  - factors are whole numbers greater than one (a level equal to the base unit
 *    is not a level);
 *  - names are unique, and none may shadow the base unit;
 *  - factors ascend, because the natural-language renderer walks them
 *    largest-first and an out-of-order list would decompose incorrectly.
 */
export function validatePackLevels(
  levels: readonly PackLevel[],
  baseUnitName: string,
): ProductRejection[] {
  const rejections: ProductRejection[] = [];
  const seen = new Set<string>();
  const base = baseUnitName.trim().toLowerCase();

  levels.forEach((level, index) => {
    const name = level.name.trim().toLowerCase();

    if (name === '') {
      rejections.push({ reason: 'pack_level_name_required', index });
    } else if (name === base) {
      rejections.push({ reason: 'pack_level_collides_with_base', name: level.name });
    } else if (seen.has(name)) {
      rejections.push({ reason: 'pack_level_duplicate_name', name: level.name });
    }
    seen.add(name);

    if (!Number.isSafeInteger(level.factor) || level.factor <= 1) {
      rejections.push({ reason: 'pack_level_factor_invalid', index });
      return;
    }

    const previous = levels[index - 1];
    if (previous !== undefined && level.factor <= previous.factor) {
      rejections.push({ reason: 'pack_level_not_ascending', index });
    }
  });

  return rejections;
}

/**
 * Parses the `strip:10, box:200` notation the Products form uses.
 *
 * Pack structure is set once when a product is created and almost never touched
 * again, so one compact field the owner can read at a glance beats a repeating
 * row editor (P5, P6). Parsing is forgiving — validation on the far side is not.
 */
export function parsePackLevels(raw: string): PackLevel[] {
  return raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const [name = '', factor = ''] = part.split(':');
      return { name: name.trim(), factor: Number(factor.trim()) };
    });
}

/** Renders pack levels back into the notation above. */
export function formatPackLevels(levels: readonly PackLevel[]): string {
  return levels.map((level) => `${level.name}:${level.factor}`).join(', ');
}

export function validateProductDraft(draft: ProductDraft): Validated<ProductDraft> {
  const rejections: ProductRejection[] = [];

  const name = draft.name.trim();
  if (name === '') {
    rejections.push({ reason: 'name_required' });
  }

  const baseUnitName = draft.baseUnitName.trim();
  if (baseUnitName === '') {
    rejections.push({ reason: 'base_unit_required' });
  }

  if (!Number.isFinite(draft.pricePaisa) || !Number.isSafeInteger(draft.pricePaisa)) {
    rejections.push({ reason: 'price_required' });
  } else if (draft.pricePaisa < 0) {
    rejections.push({ reason: 'price_negative' });
  }

  if (draft.minStockBaseUnits !== null && draft.minStockBaseUnits < 0) {
    rejections.push({ reason: 'min_stock_negative' });
  }

  rejections.push(...validatePackLevels(draft.packLevels, baseUnitName));

  if (rejections.length > 0) {
    return { ok: false, rejections };
  }

  return {
    ok: true,
    value: {
      ...draft,
      name,
      baseUnitName,
      manufacturer: blankToNull(draft.manufacturer),
      form: blankToNull(draft.form),
      strength: blankToNull(draft.strength),
      formulaText: blankToNull(draft.formulaText),
      packLevels: draft.packLevels.map((level) => ({
        name: level.name.trim(),
        factor: level.factor,
      })),
    },
  };
}

/**
 * D4 — MRP is the ceiling, and the product warns rather than blocks.
 *
 * "The pack in hand is authoritative, not our data." A price above the recorded
 * MRP is usually our MRP being stale, not the pharmacy overcharging, so this
 * returns a warning for the UI to show and never a rejection.
 */
export function exceedsMrp(pricePaisa: number, mrpPaisa: number | null): boolean {
  return mrpPaisa !== null && pricePaisa > mrpPaisa;
}

export interface BarcodeDraft {
  barcode: string;
  unitLevelName: string;
}

/** A barcode maps to a unit level: a box code and a strip code differ (Phase 5 §2). */
export function validateBarcode(
  draft: BarcodeDraft,
  baseUnitName: string,
  packLevels: readonly PackLevel[],
): Validated<BarcodeDraft> {
  const rejections: ProductRejection[] = [];
  const barcode = draft.barcode.trim().replace(/\s+/g, '');
  const unitLevelName = draft.unitLevelName.trim();

  if (barcode === '') {
    rejections.push({ reason: 'barcode_required' });
  }

  const known = [baseUnitName, ...packLevels.map((level) => level.name)].map((value) =>
    value.trim().toLowerCase(),
  );
  if (!known.includes(unitLevelName.toLowerCase())) {
    rejections.push({ reason: 'barcode_unknown_unit_level', unitLevelName });
  }

  return rejections.length > 0
    ? { ok: false, rejections }
    : { ok: true, value: { barcode, unitLevelName } };
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/**
 * A medicine Mehvar knows about, offered while a pharmacy is adding one.
 *
 * `alreadyStockedId` is the field that makes this useful rather than annoying:
 * a shop searching for "panadol" mostly already has Panadol, and offering to
 * create a second one is exactly the duplicate this whole subsystem exists to
 * prevent. The picker says "you already stock this — open it" instead.
 */
export interface CatalogSuggestion {
  readonly globalProductId: string;
  readonly name: string;
  readonly manufacturer: string | null;
  readonly formulaText: string | null;
  readonly form: string | null;
  readonly strength: string | null;
  readonly packLevels: readonly PackLevel[];
  readonly referenceMrpPaisa: number | null;
  readonly quality: 'verified' | 'reference';
  /** The tenant's own product with this identity, if they already stock it. */
  readonly alreadyStockedId: string | null;
}
