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
  updateProduct,
} from '@/db/catalog-queries';
import type { TenantScope } from '@/db/scoped';
import { uuidv7, type Uuid } from '@/lib/uuid';

import {
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

export async function createProduct(
  scope: TenantScope,
  draft: ProductDraft,
): Promise<CatalogResult<Uuid>> {
  const validated = validateProductDraft(draft);
  if (!validated.ok) {
    return validated;
  }

  const id = uuidv7();
  await insertProduct(scope, {
    id,
    tenantId: scope.tenantId,
    globalProductId: null,
    name: validated.value.name,
    manufacturer: validated.value.manufacturer,
    form: validated.value.form,
    strength: validated.value.strength,
    formulaText: validated.value.formulaText,
    baseUnitName: validated.value.baseUnitName,
    packLevels: validated.value.packLevels,
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

  const validated = validateProductDraft(draft);
  if (!validated.ok) {
    return validated;
  }

  await updateProduct(scope, productId, {
    name: validated.value.name,
    manufacturer: validated.value.manufacturer,
    form: validated.value.form,
    strength: validated.value.strength,
    formulaText: validated.value.formulaText,
    baseUnitName: validated.value.baseUnitName,
    packLevels: validated.value.packLevels,
    defaultPricePerBaseUnit: validated.value.pricePaisa,
    currentMrpPerBaseUnit: validated.value.mrpPaisa,
    minStockBaseUnits: validated.value.minStockBaseUnits,
    needsCompletion: validated.value.needsCompletion,
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
