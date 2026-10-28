'use server';

/**
 * Products screen server actions.
 *
 * Thin: parse the form, hand it to `domain/catalog`, translate the typed result
 * into something the form can render. Authorization is enforced here, on the
 * server, never by hiding UI (Phase 12 §5).
 */

import { requireCapability } from '@/auth/capabilities';
import { currentSession, scopeFor } from '@/auth/session';
import { keyFor } from '@/client/keyboard/registry';
import {
  addBarcode,
  createProduct,
  editProduct,
  removeBarcode,
  removeProduct,
  restoreProduct,
  type CatalogResult,
} from '@/domain/catalog/writers';
import {
  findBarcodeOwner,
  findProduct,
  globalCatalogSize,
  searchGlobalCatalog,
} from '@/db/catalog-queries';
import {
  replaceIntoProduct,
  replaceProduct,
  type ReplaceProductResult,
} from '@/domain/inventory/replace-product';
import {
  parsePackLevels,
  type CatalogSearchResult,
  type ProductDraft,
} from '@/domain/catalog/product';
import { parseRupeeInput } from '@/domain/sales/cart';
import { baseQty } from '@/lib/branded';
import { describeQuantity } from '@/lib/quantity';
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
    return {
      error: `Only the owner can change the catalog. Press ${keyFor('switch-user')} to switch user.`,
    } as const;
  }
  return { session } as const;
}

/**
 * Authoring a product is owner-only AND licence-gated (PCN-006 Profile C:
 * `author_product` is withheld while restricted). Catalogue *browsing* —
 * `searchCatalogAction` below — is not gated, so a restricted install can still
 * look up medicine identity; only creating or editing a tenant product is new
 * business and paused.
 */
async function requireAuthoring() {
  const gate = await requireOwner();
  if ('error' in gate) return gate;
  const licensed = requireCapability(gate.session, 'author_product');
  if (!licensed.ok) return { error: licensed.message } as const;
  return gate;
}

function draftFromForm(form: FormData): ProductDraft {
  const packLevels = parsePackLevels(String(form.get('packLevels') ?? ''));
  // [PCN-012] `unitPrice-0` is the base unit, then one per pack level. Entered
  // in rupees, stored in paisa: the conversion happens once, here at the
  // boundary (Phase 9 §1). A blank or unreadable box is "not typed".
  // Unreadable includes a number too large to hold exactly (a scanned code),
  // which used to throw out of this action.
  const unitPrices = Array.from({ length: packLevels.length + 1 }, (_, index) =>
    parseRupeeInput(String(form.get(`unitPrice-${index}`) ?? '')),
  );
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
    // [PCN-012] Prices arrive per unit and decide the per-base price; with
    // none typed at all there is no price, which validation refuses rather
    // than saving a product at Rs 0.
    pricePaisa: unitPrices.some((price) => price !== null) ? 0 : Number.NaN,
    unitPrices,
    mrpPaisa: parseRupeeInput(mrp),
    // [PCN-012] The unit the MRP is printed on, by position.
    mrpUnitIndex: /^\d+$/.test(String(form.get('mrpUnit') ?? ''))
      ? Number(form.get('mrpUnit'))
      : null,
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
      return 'Enter a price for at least one unit — the strip, the box or the single piece.';
    case 'price_negative':
      return 'A price cannot be negative.';
    case 'mrp_unit_unknown':
      return 'Choose which unit the MRP is printed on.';
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
    case 'pack_level_not_nested':
      return `Each pack must hold a whole number of the one before it — this one is not a whole number of “${first.below}”. A box of 10 strips of 10 tablets is box:100.`;
    case 'pack_structure_locked':
      return 'This product already has stock or sales, so its pack sizes cannot change — everything recorded so far is counted in them. You can rename a unit or add a bigger pack at the end. If a pack size is wrong, use “Replace this product”.';
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
  const gate = await requireAuthoring();
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

  // Revalidates the server-rendered pages. The counter's search index is client
  // state that this does not reach; the form refreshes it (`useCatalog`), and
  // the search box pulls changes whenever it is arrived at.
  revalidateAfter('catalog');
  return { status: 'saved' };
}

export async function saveBarcode(
  productId: Uuid,
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const gate = await requireAuthoring();
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

export type LinkCodeOutcome = { ok: true } | { ok: false; message: string };

/**
 * Which product, if any, already owns a scanned code — asked by the quick-item
 * dialog before it saves a new product with that code, so a stale counter index
 * can never lead to a code being put on a second product. Read-only, so any
 * signed-in user may ask: a salesman adds quick items too (W6).
 */
export async function barcodeOwnerAction(
  code: string,
): Promise<{ productId: string; productName: string } | null> {
  const session = await currentSession();
  if (!session) {
    return null;
  }
  return (await findBarcodeOwner(scopeFor(session), code)) ?? null;
}

/**
 * Links a code scanned at the counter to a product — Phase 6 §4's "unknown
 * barcode scanned → five-second link to a product", reached from the inline
 * prompt Phase 10 §5 puts on an unknown scan. Same writer and the same
 * owner-only gate as the Products screen's barcode panel.
 */
export async function linkScannedCode(
  productId: Uuid,
  code: string,
  unitLevelName: string,
): Promise<LinkCodeOutcome> {
  const gate = await requireAuthoring();
  if ('error' in gate) {
    return { ok: false, message: gate.error };
  }

  const result = await addBarcode(scopeFor(gate.session), productId, {
    barcode: code,
    unitLevelName,
  });
  if (!result.ok) {
    return { ok: false, message: messageFor(result) };
  }

  revalidateAfter('catalog');
  return { ok: true };
}

export async function unlinkBarcode(productId: Uuid, barcodeId: Uuid): Promise<void> {
  const gate = await requireAuthoring();
  if ('error' in gate) {
    return;
  }
  await removeBarcode(scopeFor(gate.session), productId, barcodeId);
  revalidateAfter('catalog');
}

export type RemoveOutcome =
  | { ok: true; unlinked: Array<{ barcode: string; unitLevelName: string }> }
  | { ok: false; message: string; blockedBy?: 'stock' | 'pending' };

/**
 * Removes a product entered by mistake. The refusals say what to do next,
 * in the product's own units (P9): a count that reads "40" when the shelf
 * holds four strips sends the operator looking for the wrong thing.
 */
export async function removeProductAction(productId: Uuid): Promise<RemoveOutcome> {
  const gate = await requireAuthoring();
  if ('error' in gate) {
    return { ok: false, message: gate.error };
  }
  const scope = scopeFor(gate.session);
  const result = await removeProduct(scope, productId);
  if (result.ok) {
    revalidateAfter('catalog');
    return { ok: true, unlinked: result.unlinked };
  }
  if (result.refusal === 'not_found') {
    return { ok: false, message: 'That product no longer exists.' };
  }
  const product = await findProduct(scope, productId);
  const counted = (base: number) =>
    product
      ? describeQuantity(baseQty(base), product.baseUnitName, product.packLevels)
      : String(base);
  if (result.refusal === 'has_stock') {
    return {
      ok: false,
      blockedBy: 'stock',
      message:
        result.stockBase > 0
          ? `It still has ${counted(result.stockBase)} on hand. Remove that stock first — “Entered by mistake” if it was never there — or replace it with the right product.`
          : `It is ${counted(-result.stockBase)} below zero. Correct the count first.`,
    };
  }
  return {
    ok: false,
    blockedBy: 'pending',
    message: `${counted(result.pendingBase)} sold with no stock behind it is still waiting. Receive or count that stock first.`,
  };
}

export async function restoreProductAction(
  productId: Uuid,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const gate = await requireAuthoring();
  if ('error' in gate) {
    return { ok: false, message: gate.error };
  }
  const result = await restoreProduct(scopeFor(gate.session), productId);
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.refusal === 'replaced'
          ? 'This product was replaced. Its stock and barcodes are on the replacement.'
          : 'That product no longer exists.',
    };
  }
  revalidateAfter('catalog');
  return { ok: true };
}

/**
 * Searches Mehvar's shared catalogue while a product is being added.
 *
 * Read-only and identity-only. It reaches `global_products`, which has no
 * tenant column, and cross-references the caller's own catalogue purely to
 * report what they already stock — nothing about one pharmacy can reach
 * another through it (T3).
 */
export async function searchCatalogAction(term: string): Promise<CatalogSearchResult> {
  const gate = await requireOwner();
  if ('error' in gate) {
    return { catalogLoaded: true, matches: [] };
  }

  const [matches, size] = await Promise.all([
    searchGlobalCatalog(scopeFor(gate.session), term),
    globalCatalogSize(),
  ]);

  /*
   * The size is reported alongside the matches so the screen can tell "nothing
   * matched" apart from "the catalogue was never loaded". They look the same to
   * an operator and are entirely different problems — and the second one is
   * what shipped: a fresh developer setup left `global_products` empty and the
   * picker answered "nothing matches" to every query ever typed.
   */
  return { catalogLoaded: size > 0, matches };
}

export type ReplaceOutcome =
  | {
      ok: true;
      newProductId: string;
      unlinkedBarcodes: { barcode: string; unitLevelName: string }[];
    }
  | { ok: false; message: string };

/**
 * [PCN-012] "Replace this product": the old product's identity and settings
 * carry across; the pack, prices and each batch's count are what the owner
 * confirmed on the screen.
 */
export async function replaceProductAction(
  oldProductId: Uuid,
  input: {
    name: string;
    baseUnitName: string;
    packLevels: string;
    /** Rupees as typed per unit, smallest first; blank for not typed. */
    unitPrices: string[];
    batches: { batchId: string; expectedRemainingBase: number; newQtyBase: number }[];
    note: string;
  },
): Promise<ReplaceOutcome> {
  const gate = await requireAuthoring();
  if ('error' in gate) {
    return { ok: false, message: gate.error };
  }
  const scope = scopeFor(gate.session);
  const old = await findProduct(scope, oldProductId);
  if (!old) {
    return { ok: false, message: 'That product no longer exists.' };
  }

  const packLevels = parsePackLevels(input.packLevels);
  const unitPrices = input.unitPrices.map((price) => parseRupeeInput(price));
  // The MRP carries across when the unit it is printed on is still there.
  const names = [input.baseUnitName.trim(), ...packLevels.map((level) => level.name)];
  const mrpName = old.mrpUnit
    ? old.units.find((unit) => unit.key === old.mrpUnit?.key)?.name
    : undefined;
  const mrpUnitIndex = mrpName === undefined ? -1 : names.indexOf(mrpName);

  const result = await replaceProduct(scope, {
    oldProductId,
    product: {
      name: input.name,
      manufacturer: old.manufacturer,
      form: old.form,
      strength: old.strength,
      formulaText: old.formulaText,
      baseUnitName: input.baseUnitName,
      packLevels,
      pricePaisa: unitPrices.some((price) => price !== null) ? 0 : Number.NaN,
      unitPrices,
      mrpPaisa: mrpUnitIndex >= 0 && old.mrpUnit ? old.mrpUnit.paisa : null,
      mrpUnitIndex: mrpUnitIndex >= 0 ? mrpUnitIndex : null,
      minStockBaseUnits: old.minStockBaseUnits,
      needsCompletion: old.needsCompletion,
      globalProductId: old.globalProductId,
    },
    batches: input.batches.map((batch) => ({
      batchId: batch.batchId as Uuid,
      expectedRemainingBase: batch.expectedRemainingBase,
      newQtyBase: batch.newQtyBase,
    })),
    note: input.note.trim() === '' ? null : input.note.trim(),
  });

  if (!result.ok) {
    return { ok: false, message: replaceRefusalMessage(result) };
  }

  revalidateAfter('catalog', 'stock');
  return {
    ok: true,
    newProductId: result.value.newProductId,
    unlinkedBarcodes: result.value.unlinkedBarcodes,
  };
}

/**
 * [PCN-013] Moves the stock into a product the shop already has. Same owner
 * gate and the same confirmed counts as a replacement; the counts are in the
 * receiving product's packs.
 */
export async function replaceIntoProductAction(
  oldProductId: Uuid,
  input: {
    intoProductId: string;
    batches: { batchId: string; expectedRemainingBase: number; newQtyBase: number }[];
    note: string;
  },
): Promise<ReplaceOutcome> {
  const gate = await requireAuthoring();
  if ('error' in gate) {
    return { ok: false, message: gate.error };
  }
  const result = await replaceIntoProduct(scopeFor(gate.session), {
    oldProductId,
    intoProductId: input.intoProductId as Uuid,
    batches: input.batches.map((batch) => ({
      batchId: batch.batchId as Uuid,
      expectedRemainingBase: batch.expectedRemainingBase,
      newQtyBase: batch.newQtyBase,
    })),
    note: input.note.trim() === '' ? null : input.note.trim(),
  });
  if (!result.ok) {
    return { ok: false, message: replaceRefusalMessage(result) };
  }
  revalidateAfter('catalog', 'stock');
  return {
    ok: true,
    newProductId: result.value.newProductId,
    unlinkedBarcodes: result.value.unlinkedBarcodes,
  };
}

/** I5 — what to do next, for either kind of replacement. */
function replaceRefusalMessage(result: Extract<ReplaceProductResult, { ok: false }>): string {
  switch (result.reason) {
    case 'already_replaced':
      return 'This product has already been replaced.';
    case 'stale_batches':
      return 'Stock of this product changed while you were counting. Reload and count again.';
    case 'invalid_count':
      return 'Every batch needs a count above zero. If a batch is gone, write it off on Adjust first.';
    case 'invalid_product':
      return messageFor(result.detail as Extract<CatalogResult<unknown>, { ok: false }>);
    case 'invalid_target':
      return 'Choose another product to move the stock to — one that is on sale, and not this one.';
    case 'base_unit_differs':
      return 'Those two count different units, so the counts would change meaning. Choose a product counted the same way, or replace with a new product.';
    default:
      return 'That product no longer exists.';
  }
}
