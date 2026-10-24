/**
 * Catalog writers — Phase 11 §2's transactional half.
 *
 * Products, barcodes and prices are reference entities, not events: editing a
 * price is a correction to a lookup, and Phase 9 §1 permits it explicitly
 * ("editable fields limited to identity/settings, never to anything a report
 * derives from"). Nothing here touches an event row, and nothing here could —
 * the application role has no privilege to.
 *
 * Writers return typed results; the UI maps reasons to I5 messages.
 */

import {
  deleteBarcode as deleteBarcodeRow,
  findBarcodeOwner,
  findProduct,
  insertBarcode,
  insertProduct,
  productHasHistory,
  updateProduct,
} from '@/db/catalog-queries';
import type { TenantScope } from '@/db/scoped';
import { uuidv7, type Uuid } from '@/lib/uuid';

import { legacyPricePerBase, unitsFromEnteredPrices, unitsOf, type ProductUnit } from './units';
import {
  packStructureChange,
  validateBarcode,
  validateProductDraft,
  type BarcodeDraft,
  type ProductDraft,
  type ProductRejection,
} from './product';

export type CatalogResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; rejections: ProductRejection[] }
  | { ok: false; conflict: 'barcode_taken'; productName: string }
  | { ok: false; conflict: 'not_found' };

/**
 * [PCN-012] The units a draft describes, and the draft with its legacy
 * per-base price brought in line with them.
 *
 * Prices typed per unit win; a draft with none (a quick item, an older caller)
 * prices every pack from its per-base price, exactly as before PCN-012. Sell
 * flags carry over by position from the product being edited.
 */
function withUnits(
  draft: ProductDraft,
  previous: readonly ProductUnit[] = [],
): { draft: ProductDraft; units: ProductUnit[] } {
  const structure = [
    { name: draft.baseUnitName.trim(), factor: 1 },
    ...draft.packLevels.map((level) => ({ name: level.name.trim(), factor: level.factor })),
  ];
  const sell = structure.map((_, index) => previous[index]?.sell ?? true);
  const entered = draft.unitPrices
    ? unitsFromEnteredPrices(structure, draft.unitPrices, sell)
    : null;
  if (entered) {
    return { draft: { ...draft, pricePaisa: legacyPricePerBase(entered) }, units: entered };
  }
  // Structure invalid enough that units cannot be priced (a bad factor) is
  // left to validation, which refuses the draft before anything is written.
  const factorsUsable = structure.every(
    (unit) => Number.isSafeInteger(unit.factor) && unit.factor > 0,
  );
  const priceUsable = Number.isSafeInteger(draft.pricePaisa) && draft.pricePaisa >= 0;
  if (!factorsUsable || !priceUsable) {
    return { draft, units: [] };
  }
  const derived = unitsOf({
    baseUnitName: structure[0]?.name ?? '',
    packLevels: structure.slice(1),
    pricePerBasePaisa: draft.pricePaisa,
    units: null,
  }).map((unit, index) => ({ ...unit, sell: sell[index] ?? true }));
  return { draft, units: derived };
}

export async function createProduct(
  scope: TenantScope,
  draft: ProductDraft,
): Promise<CatalogResult<Uuid>> {
  const priced = withUnits(draft);
  const validated = validateProductDraft(priced.draft);
  if (!validated.ok) {
    return validated;
  }

  const id = uuidv7();
  await insertProduct(scope, {
    id,
    tenantId: scope.tenantId,
    // The link to Mehvar's shared identity, when the product was added from
    // the catalogue. Null for anything typed by hand or quick-added — most of
    // what a Pakistani pharmacy sells is not in any catalogue.
    globalProductId: validated.value.globalProductId,
    name: validated.value.name,
    manufacturer: validated.value.manufacturer,
    form: validated.value.form,
    strength: validated.value.strength,
    formulaText: validated.value.formulaText,
    baseUnitName: validated.value.baseUnitName,
    packLevels: validated.value.packLevels,
    units: priced.units,
    defaultPricePerBaseUnit: validated.value.pricePaisa,
    currentMrpPerBaseUnit: validated.value.mrpPaisa,
    minStockBaseUnits: validated.value.minStockBaseUnits,
    needsCompletion: validated.value.needsCompletion,
  });

  return { ok: true, value: id };
}

/**
 * A quick item — W6, D3.
 *
 *   "From an empty search result, one key → name + price → line lands in cart,
 *    sale continues. Creates a real product flagged *needs completion*."
 *
 * Two things make this different from `createProduct`, and both come from
 * ADR-3 listing quick-item creation among the four offline-capturable events:
 *
 *  - **The id arrives from the client.** The cart line references this product
 *    before it has reached the server, so the counter mints the identity, the
 *    same way it already mints sale and payment ids.
 *  - **It is idempotent on that id.** Sync may deliver the same creation twice;
 *    delivery repeats, effects never do. A second delivery is a no-op, not a
 *    duplicate product and not an error.
 *
 * "Real product" is the load-bearing phrase (D3): never an anonymous line, so
 * every report and every stock figure keeps working. `needsCompletion` is what
 * makes the queue nag until someone enriches it.
 */
export async function createQuickItem(
  scope: TenantScope,
  input: { id: Uuid; name: string; pricePaisa: number; baseUnitName: string },
): Promise<CatalogResult<Uuid>> {
  const existing = await findProduct(scope, input.id);
  if (existing) {
    return { ok: true, value: input.id };
  }

  const validated = validateProductDraft({
    name: input.name,
    manufacturer: null,
    form: null,
    strength: null,
    formulaText: null,
    baseUnitName: input.baseUnitName,
    // A quick item is deliberately structureless: W6 asks for a name and a
    // price and nothing else, and pack levels are exactly the kind of thing
    // that gets guessed wrong under time pressure. Completion adds them.
    packLevels: [],
    // A quick item comes from an empty search at the counter, so by definition
    // it matched nothing — there is no catalogue identity to link to.
    globalProductId: null,
    pricePaisa: input.pricePaisa,
    mrpPaisa: null,
    minStockBaseUnits: null,
    needsCompletion: true,
  });
  if (!validated.ok) {
    return validated;
  }

  await insertProduct(scope, {
    id: input.id,
    tenantId: scope.tenantId,
    globalProductId: null,
    name: validated.value.name,
    manufacturer: null,
    form: null,
    strength: null,
    formulaText: null,
    baseUnitName: validated.value.baseUnitName,
    packLevels: [],
    units: withUnits(validated.value).units,
    defaultPricePerBaseUnit: validated.value.pricePaisa,
    currentMrpPerBaseUnit: null,
    minStockBaseUnits: null,
    needsCompletion: true,
  });

  return { ok: true, value: input.id };
}

export async function editProduct(
  scope: TenantScope,
  productId: Uuid,
  draft: ProductDraft,
): Promise<CatalogResult> {
  const existing = await findProduct(scope, productId);
  if (!existing) {
    return { ok: false, conflict: 'not_found' };
  }

  // [PCN-012] What the edit does to the product's units decides two things.
  const change = packStructureChange(existing, draft);

  // Once anything is recorded against the product, its existing units are
  // fixed: every stored quantity is a count of its base unit (Phase 9 §1).
  // Adding a larger pack on top changes the meaning of nothing recorded.
  // Checked before field validation: for a locked product, "that name is
  // already a pack level" would send the owner fixing the wrong thing.
  if (change === 'changed' && (await productHasHistory(scope, productId))) {
    return { ok: false, rejections: [{ reason: 'pack_structure_locked' }] };
  }

  const priced = withUnits(draft, existing.units);

  // Levels the edit keeps exactly as they were are exempt from nesting:
  // see `validatePackLevels`.
  const validated = validateProductDraft(priced.draft, {
    nestingCheckedFrom: change === 'changed' ? 0 : existing.packLevels.length,
  });
  if (!validated.ok) {
    return validated;
  }

  const { value } = validated;
  await updateProduct(scope, productId, {
    name: value.name,
    manufacturer: value.manufacturer,
    form: value.form,
    strength: value.strength,
    formulaText: value.formulaText,
    baseUnitName: value.baseUnitName,
    packLevels: value.packLevels,
    units: priced.units,
    defaultPricePerBaseUnit: value.pricePaisa,
    currentMrpPerBaseUnit: value.mrpPaisa,
    minStockBaseUnits: value.minStockBaseUnits,
    needsCompletion: value.needsCompletion,
  });

  return { ok: true, value: undefined };
}

/**
 * Soft archive (Phase 9 §1) — never a delete. Sale history references products,
 * and that history has to keep resolving.
 */
export async function setProductActive(
  scope: TenantScope,
  productId: Uuid,
  isActive: boolean,
): Promise<CatalogResult> {
  const existing = await findProduct(scope, productId);
  if (!existing) {
    return { ok: false, conflict: 'not_found' };
  }
  await updateProduct(scope, productId, { isActive });
  return { ok: true, value: undefined };
}

/**
 * Links a scanned code to a product — the five-second interaction at the heart
 * of Phase 6 §4's compounding loop.
 *
 * A code already used by another product is a conflict worth naming, because the
 * operator needs to know *which* product has it before deciding what to do.
 */
export async function addBarcode(
  scope: TenantScope,
  productId: Uuid,
  draft: BarcodeDraft,
): Promise<CatalogResult> {
  const product = await findProduct(scope, productId);
  if (!product) {
    return { ok: false, conflict: 'not_found' };
  }

  const validated = validateBarcode(draft, product.baseUnitName, product.packLevels);
  if (!validated.ok) {
    return validated;
  }

  const owner = await findBarcodeOwner(scope, validated.value.barcode);
  if (owner) {
    return owner.productId === productId
      ? { ok: true, value: undefined }
      : { ok: false, conflict: 'barcode_taken', productName: owner.productName };
  }

  await insertBarcode(scope, {
    id: uuidv7(),
    tenantId: scope.tenantId,
    productId,
    barcode: validated.value.barcode,
    unitLevelName: validated.value.unitLevelName,
  });

  return { ok: true, value: undefined };
}

export async function removeBarcode(
  scope: TenantScope,
  productId: Uuid,
  barcodeId: Uuid,
): Promise<CatalogResult> {
  await deleteBarcodeRow(scope, productId, barcodeId);
  return { ok: true, value: undefined };
}
