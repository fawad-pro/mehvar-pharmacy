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
