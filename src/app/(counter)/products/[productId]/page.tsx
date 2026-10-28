import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { alternativesFor, findProduct, productHasHistory } from '@/db/catalog-queries';
import { formatPackLevels } from '@/domain/catalog/product';
import { baseQty } from '@/lib/branded';
import { describeQuantity } from '@/lib/quantity';

import { ProductForm } from '../product-form';
import { BarcodePanel } from './barcode-panel';
import { RemovePanel } from './remove-panel';

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  /** [PCN-012] Set by "Replace this product" on arrival here. */
  searchParams: Promise<{ replaced?: string; removed?: string; unlinked?: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const { productId } = await params;
  const arrival = await searchParams;
  const unlinked = (arrival.unlinked ?? '')
    .split(',')
    .filter(Boolean)
    .map((pair) => {
      const at = pair.lastIndexOf(':');
      return { barcode: pair.slice(0, at), unitLevelName: pair.slice(at + 1) };
    });
  const scope = scopeFor(session);
  const [product, alternatives, hasHistory] = await Promise.all([
    findProduct(scope, productId),
    alternativesFor(scope, productId),
    productHasHistory(scope, productId),
  ]);
  if (!product) {
    notFound();
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-5 p-4">
      <header>
        <Link href="/products" className="text-blue-600 text-sm">
          ← Products
        </Link>
        <h1 className="text-navy mt-1 text-2xl font-semibold">
          {product.name}
          {product.strength ? (
            <span className="text-ink-2 font-normal"> {product.strength}</span>
          ) : null}
        </h1>
        <p className="text-ink-2 text-sm">
          {product.stockBase === null
            ? 'No stock recorded yet'
            : `${describeQuantity(baseQty(product.stockBase), product.baseUnitName, product.packLevels)} on hand`}
        </p>
      </header>

      {arrival.replaced !== undefined ? (
        <div className="bg-surface shadow-card rounded-card px-3 py-2 text-sm" role="status" aria-label="Replaced">
          <p className="text-navy font-medium">
            Replaced.{' '}
            {arrival.replaced === '1' ? '1 batch' : `${arrival.replaced} batches`} moved here with
            their cost.
          </p>
          {unlinked.length > 0 ? (
            <>
              <p className="mt-1">Link these barcodes again — their unit is not on this pack:</p>
              <ul className="numeral">
                {unlinked.map((code) => (
                  <li key={code.barcode}>
                    {code.barcode} <span className="text-ink-2">(was on {code.unitLevelName})</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {arrival.removed !== undefined && !product.isActive && unlinked.length > 0 ? (
        <div
          className="bg-surface shadow-card rounded-card px-3 py-2 text-sm"
          role="status"
          aria-label="Removed"
        >
          <p>These barcodes were unlinked, so the right product can take them:</p>
          <ul className="numeral">
            {unlinked.map((code) => (
              <li key={code.barcode}>
                {code.barcode} <span className="text-ink-2">({code.unitLevelName})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* [PCN-012] A replaced product is history: say where it went. */}
      {product.replacedByProductId ? (
        <p className="bg-surface shadow-card rounded-card px-3 py-2 text-sm" role="note">
          Replaced — this product is no longer sold.{' '}
          <Link
            href={`/products/${product.replacedByProductId}`}
            className="text-blue-600 hover:underline"
          >
            Open its replacement
          </Link>
        </p>
      ) : hasHistory ? (
        <p className="text-ink-2 text-sm">
          Pack sizes set up wrong, or stock under the wrong product?{' '}
          <Link href={`/products/${product.id}/replace`} className="text-blue-600 hover:underline">
            Replace this product
          </Link>{' '}
          — the stock moves to a new product with the right pack.
        </p>
      ) : null}

      {/* "Panadol nahi hai — kya chalega?"
          
          The substitution question, answered from THIS shop's shelves rather
          than from the shared catalogue. Listing medicines the pharmacy does
          not stock would answer a question nobody asked and bury the one they
          did. Driven by `equivalenceKey` — same formula, strength and form —
          which is emphatically not the same test as "is this a duplicate"
          (see domain/catalog/identity.ts). */}
      {alternatives.length > 0 ? (
        <div className="bg-surface shadow-card rounded-card p-3">
          <h2 className="text-ink-2 mb-1 text-xs tracking-[0.14em] uppercase">
            Same medicine, other brands
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {alternatives.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/products/${row.id}`} className="text-blue-600 hover:underline">
                  {row.name}
                </Link>
                <span className="text-ink-2">
                  {[row.strength, row.manufacturer].filter(Boolean).join(' · ')}
                </span>
                {/* Stock is why this list is useful at all: an alternative
                    that is also out is not an answer. */}
                <span className="numeral text-ink-2 ml-auto text-xs">
                  {row.stockBase === null || row.stockBase <= 0 ? (
                    <span className="text-amber-text">none on hand</span>
                  ) : (
                    `${row.stockBase} on hand`
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* A replaced product is already off sale, and restoring it would
          duplicate its replacement; it gets neither control. */}
      {product.replacedByProductId ? null : (
        <RemovePanel
          productId={product.id}
          productName={product.name}
          isActive={product.isActive}
          canReplace={hasHistory}
        />
      )}

      <BarcodePanel
        productId={product.id}
        baseUnitName={product.baseUnitName}
        packLevels={product.packLevels}
        barcodes={product.barcodes}
      />

      <ProductForm
        initial={{
          id: product.id,
          globalProductId: product.globalProductId,
          name: product.name,
          manufacturer: product.manufacturer ?? '',
          form: product.form ?? '',
          strength: product.strength ?? '',
          formulaText: product.formulaText ?? '',
          baseUnitName: product.baseUnitName,
          packLevels: formatPackLevels(product.packLevels),
          // Paisa in the database, rupees in the field. Two decimal places
          // exactly, so a price never renders as 3.4999999.
          // [PCN-012] Each unit's own price, as the owner set it (or as it was
          // derived for a product from before PCN-012).
          unitPriceRupees: Object.fromEntries(
            product.units.map((unit) => [unit.name, (unit.pricePaisa / 100).toFixed(2)]),
          ),
          // [PCN-012] As printed, on the unit it is printed on; an MRP from
          // before PCN-012 is per base unit.
          ...mrpInitial(product),
          minStock: product.minStockBaseUnits === null ? '' : String(product.minStockBaseUnits),
          needsCompletion: product.needsCompletion,
          // [PCN-012] Said before Save, not discovered after it.
          unitsLocked: hasHistory,
        }}
      />
    </section>
  );
}

function mrpInitial(product: {
  mrpPaisa: number | null;
  mrpUnit: { key: string; paisa: number } | null;
  units: readonly { key: string; name: string }[];
  baseUnitName: string;
}): { mrpRupees: string; mrpUnitName: string | null } {
  const named = product.mrpUnit
    ? product.units.find((unit) => unit.key === product.mrpUnit?.key)
    : undefined;
  if (product.mrpUnit && named) {
    return { mrpRupees: (product.mrpUnit.paisa / 100).toFixed(2), mrpUnitName: named.name };
  }
  return product.mrpPaisa === null
    ? { mrpRupees: '', mrpUnitName: null }
    : { mrpRupees: (product.mrpPaisa / 100).toFixed(2), mrpUnitName: product.baseUnitName };
}
