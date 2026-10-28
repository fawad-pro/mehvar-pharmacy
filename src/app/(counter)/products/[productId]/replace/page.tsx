import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { batchesOnHand } from '@/db/adjustment-queries';
import { findProduct } from '@/db/catalog-queries';
import { formatPackLevels } from '@/domain/catalog/product';

import { ReplaceSurface } from './replace-surface';

/**
 * [PCN-012] "Replace this product" — the fix for pack sizes set wrong after
 * stock or sales exist. Owner-only, at the action.
 */
export default async function ReplaceProductPage({
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
  const product = await findProduct(scope, productId);
  if (!product) {
    notFound();
  }

  if (product.replacedByProductId) {
    return (
      <section className="mx-auto flex max-w-2xl flex-col gap-3 p-4">
        <h1 className="text-green-900 text-2xl font-semibold">{product.name}</h1>
        <p>
          This product has been replaced.{' '}
          <Link
            href={`/products/${product.replacedByProductId}`}
            className="text-green-700 hover:underline"
          >
            Open its replacement
          </Link>
        </p>
      </section>
    );
  }

  const stock = await batchesOnHand(scope, product.id);

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-5 p-4">
      <header>
        <Link href={`/products/${product.id}`} className="text-green-600 text-sm">
          ← {product.name}
        </Link>
        <h1 className="text-green-900 mt-1 text-2xl font-semibold">Replace this product</h1>
        <p className="text-ink/70 mt-1 text-sm leading-snug">
          For a pack set up wrong, or stock entered under the wrong product. Mehvar moves the stock
          — to a new product with the right pack, or to one you already have — at the count you
          confirm, with its cost. Past sales stay on this product, which stops being sold.
        </p>
      </header>
      <ReplaceSurface
        product={{
          id: product.id,
          name: product.name,
          baseUnitName: product.baseUnitName,
          packLevels: product.packLevels,
          packLevelsText: formatPackLevels(product.packLevels),
          unitPriceRupees: Object.fromEntries(
            product.units.map((unit) => [unit.name, (unit.pricePaisa / 100).toFixed(2)]),
          ),
          barcodes: product.barcodes.map((code) => ({
            barcode: code.barcode,
            unitLevelName: code.unitLevelName,
          })),
        }}
        batches={stock.map((batch) => ({
          batchId: batch.batchId,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          qtyRemainingBase: batch.qtyRemainingBase,
        }))}
      />
    </section>
  );
}
