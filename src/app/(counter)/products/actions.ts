'use server';

/**
 * Products screen server actions.
 *
 * Thin: parse the form, hand it to `domain/catalog`, translate the typed result
 * into something the form can render. Authorization is enforced here, on the
 * server, never by hiding UI (Phase 12 §5).
 */


import { currentSession, scopeFor } from '@/auth/session';
import {
  addBarcode,
  createProduct,
  editProduct,
  removeBarcode,
  setProductActive,
  type CatalogResult,
} from '@/domain/catalog/writers';
import { searchGlobalCatalog } from '@/db/catalog-queries';
import {
  parsePackLevels,
  type CatalogSuggestion,
  type ProductDraft,
} from '@/domain/catalog/product';
import { rupeesToPaisa } from '@/lib/money';
import type { Uuid } from '@/lib/uuid';

import { revalidateAfter } from '../revalidate';

export type ActionState =
  { status: 'idle' } | { status: 'error'; message: string } | { status: 'saved' };

/**
 * Catalog prices are owner business (Phase 5 §2: a salesman has "no catalog
 * price editing"). Everything on this screen edits prices in some form, so the
 * whole surface is owner-only.
 */
async function requireOwner() {
  const session = await currentSession();
  if (!session) {
    return { error: 'This device needs to sign in again.' } as const;
  }
  if (session.userRole !== 'owner') {
    return { error: 'Only the owner can change the catalog. Press F10 to switch user.' } as const;
  }
  return { session } as const;
}

function draftFromForm(form: FormData): ProductDraft {
  const packLevels = parsePackLevels(String(form.get('packLevels') ?? ''));
  const mrp = String(form.get('mrp') ?? '').trim();
  const minStock = String(form.get('minStock') ?? '').trim();

  return {
    name: String(form.get('name') ?? ''),
    manufacturer: String(form.get('manufacturer') ?? ''),
    form: String(form.get('form') ?? ''),
    strength: String(form.get('strength') ?? ''),
    formulaText: String(form.get('formulaText') ?? ''),
    baseUnitName: String(form.get('baseUnitName') ?? ''),
    packLevels,
    // Entered in rupees, stored in paisa. The conversion happens once, here at
    // the boundary (Phase 9 §1).
    pricePaisa: rupeesToPaisa(Number(form.get('price') ?? 0)),
    mrpPaisa: mrp === '' ? null : rupeesToPaisa(Number(mrp)),
    minStockBaseUnits: minStock === '' ? null : Math.trunc(Number(minStock)),
    needsCompletion: form.get('needsCompletion') === 'on',
    globalProductId: String(form.get('globalProductId') ?? '').trim() || null,
  };
}

/** Rejections are structural; the message shown to a person is composed here (I5). */
function messageFor(result: Extract<CatalogResult<unknown>, { ok: false }>): string {
  if ('conflict' in result) {
    return result.conflict === 'barcode_taken'
      ? `That barcode is already on ${result.productName}. Remove it there first.`
      : 'That product no longer exists.';
  }

  const first = result.rejections[0];
  switch (first?.reason) {
    case 'name_required':
      return 'Give the product a name.';
    case 'base_unit_required':
      return 'Name the base unit — the smallest thing you sell, like tab or bottle.';
    case 'price_required':
      return 'Enter a price in rupees.';
    case 'price_negative':
      return 'A price cannot be negative.';
    case 'min_stock_negative':
      return 'A minimum stock level cannot be negative.';
    case 'pack_level_name_required':
      return 'Every pack level needs a name, like strip:10.';
    case 'pack_level_factor_invalid':
      return 'Each pack level needs a whole number bigger than 1, like strip:10.';
    case 'pack_level_duplicate_name':
      return `Two pack levels are both called “${first.name}”.`;
    case 'pack_level_collides_with_base':
      return `“${first.name}” is already the base unit.`;
    case 'pack_level_not_ascending':
      return 'List pack levels smallest first, like strip:10, box:200.';
    case 'barcode_required':
      return 'Scan or type the barcode.';
    case 'barcode_unknown_unit_level':
      return `This product has no unit level called “${first.unitLevelName}”.`;
    default:
      return 'That did not save. Check the fields and try again.';
  }
}

export async function saveProduct(
  productId: Uuid | null,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const gate = await requireOwner();
  if ('error' in gate) {
    return { status: 'error', message: gate.error };
  }

  const scope = scopeFor(gate.session);
  const draft = draftFromForm(form);
  const result = productId
    ? await editProduct(scope, productId, draft)
    : await createProduct(scope, draft);

  if (!result.ok) {
    return { status: 'error', message: messageFor(result) };
  }

  // The counter's search index reads the catalog too, so a saved product has
  // to reach /sale as well as /products.
  revalidateAfter('catalog');
  return { status: 'saved' };
}

export async function saveBarcode(
  productId: Uuid,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const gate = await requireOwner();
  if ('error' in gate) {
    return { status: 'error', message: gate.error };
  }

  const result = await addBarcode(scopeFor(gate.session), productId, {
    barcode: String(form.get('barcode') ?? ''),
    unitLevelName: String(form.get('unitLevelName') ?? ''),
  });

  if (!result.ok) {
    return { status: 'error', message: messageFor(result) };
  }

  revalidateAfter('catalog');
  return { status: 'saved' };
}

export async function unlinkBarcode(productId: Uuid, barcodeId: Uuid): Promise<void> {
  const gate = await requireOwner();
  if ('error' in gate) {
    return;
  }
  await removeBarcode(scopeFor(gate.session), productId, barcodeId);
  revalidateAfter('catalog');
}

export async function archiveProduct(productId: Uuid, isActive: boolean): Promise<void> {
  const gate = await requireOwner();
  if ('error' in gate) {
    return;
  }
  await setProductActive(scopeFor(gate.session), productId, isActive);
  revalidateAfter('catalog');
}

/**
 * Searches Mehvar's shared catalogue while a product is being added.
 *
 * Read-only and identity-only. It reaches `global_products`, which has no
 * tenant column, and cross-references the caller's own catalogue purely to
 * report what they already stock — nothing about one pharmacy can reach
 * another through it (T3).
 */
export async function searchCatalogAction(term: string): Promise<CatalogSuggestion[]> {
  const gate = await requireOwner();
  if ('error' in gate) {
    return [];
  }
  return searchGlobalCatalog(scopeFor(gate.session), term);
}
