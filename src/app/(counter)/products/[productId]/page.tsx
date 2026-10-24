import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { alternativesFor, findProduct, productHasHistory } from '@/db/catalog-queries';
import { formatPackLevels } from '@/domain/catalog/product';
import { baseQty } from '@/lib/branded';
import { describeQuantity } from '@/lib/quantity';

import { ProductForm } from '../product-form';
import { BarcodePanel } from './barcode-panel';

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  const { productId } = await params;
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
        <Link href="/products" className="text-green-600 text-sm">
          ← Products
        </Link>
        <h1 className="text-green-900 mt-1 text-2xl font-semibold">
          {product.name}
          {product.strength ? (
            <span className="text-ink/60 font-normal"> {product.strength}</span>
          ) : null}
        </h1>
        <p className="text-ink/50 text-sm">
          {product.stockBase === null
            ? 'No stock recorded yet'
            : `${describeQuantity(baseQty(product.stockBase), product.baseUnitName, product.packLevels)} on hand`}
        </p>
      </header>

      {/* "Panadol nahi hai — kya chalega?"
          
          The substitution question, answered from THIS shop's shelves rather
          than from the shared catalogue. Listing medicines the pharmacy does
          not stock would answer a question nobody asked and bury the one they
          did. Driven by `equivalenceKey` — same formula, strength and form —
          which is emphatically not the same test as "is this a duplicate"
          (see domain/catalog/identity.ts). */}
      {alternatives.length > 0 ? (
        <div className="border-line rounded border p-3">
          <h2 className="text-ink/60 mb-1 text-xs tracking-[0.14em] uppercase">
            Same medicine, other brands
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {alternatives.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/products/${row.id}`} className="text-green-700 hover:underline">
                  {row.name}
                </Link>
                <span className="text-ink/50">
                  {[row.strength, row.manufacturer].filter(Boolean).join(' · ')}
                </span>
                {/* Stock is why this list is useful at all: an alternative
                    that is also out is not an answer. */}
                <span className="numeral text-ink/60 ml-auto text-xs">
                  {row.stockBase === null || row.stockBase <= 0 ? (
                    <span className="text-amber">none on hand</span>
                  ) : (
                    `${row.stockBase} on hand`
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
          mrpRupees: product.mrpPaisa === null ? '' : (product.mrpPaisa / 100).toFixed(2),
          minStock: product.minStockBaseUnits === null ? '' : String(product.minStockBaseUnits),
          needsCompletion: product.needsCompletion,
          // [PCN-012] Said before Save, not discovered after it.
          unitsLocked: hasHistory,
        }}
      />
    </section>
  );
}
