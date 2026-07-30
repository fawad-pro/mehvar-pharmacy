import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { findProduct } from '@/db/catalog-queries';
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
  const product = await findProduct(scopeFor(session), productId);
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

      <BarcodePanel
        productId={product.id}
        baseUnitName={product.baseUnitName}
        packLevels={product.packLevels}
        barcodes={product.barcodes}
      />

      <ProductForm
        initial={{
          id: product.id,
          name: product.name,
          manufacturer: product.manufacturer ?? '',
          form: product.form ?? '',
          strength: product.strength ?? '',
          formulaText: product.formulaText ?? '',
          baseUnitName: product.baseUnitName,
          packLevels: formatPackLevels(product.packLevels),
          // Paisa in the database, rupees in the field. Two decimal places
          // exactly, so a price never renders as 3.4999999.
          priceRupees: (product.pricePaisa / 100).toFixed(2),
          mrpRupees: product.mrpPaisa === null ? '' : (product.mrpPaisa / 100).toFixed(2),
          minStock: product.minStockBaseUnits === null ? '' : String(product.minStockBaseUnits),
          needsCompletion: product.needsCompletion,
        }}
      />
    </section>
  );
}
