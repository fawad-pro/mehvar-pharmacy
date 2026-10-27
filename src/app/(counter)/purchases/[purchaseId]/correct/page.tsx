import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, scopeFor } from '@/auth/session';
import { batchCostPositions } from '@/db/batch-cost-queries';
import { batchesForPurchase, correctionsForPurchase } from '@/db/correction-queries';
import { findPurchase } from '@/db/purchase-queries';
import { correctedLine, lineStateOf } from '@/domain/purchases/purchase-correction';

import { CorrectSurface, type CorrectableLineView } from './correct-surface';

/**
 * [PCN-009] Correct a received invoice, or send goods back to its supplier.
 *
 * Its own page, reached from the invoice's review page by the one control that
 * says it changes something (Day 9: reviewing never enters a workflow that can
 * change something). Owner-only, like the acts it performs.
 */
export default async function CorrectPurchasePage({
  params,
}: {
  params: Promise<{ purchaseId: string }>;
}) {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }
  const { purchaseId } = await params;
  if (session.userRole !== 'owner') {
    redirect(`/purchases/${purchaseId}`);
  }

  const scope = scopeFor(session);
  const purchase = await findPurchase(scope, purchaseId);
  if (!purchase) {
    notFound();
  }
  const [corrections, lineBatches] = await Promise.all([
    correctionsForPurchase(scope, purchaseId),
    batchesForPurchase(scope, purchaseId),
  ]);
  // [PCN-012] Each batch's cost position, for the exact suggested credit.
  const positions = await batchCostPositions(
    scope,
    lineBatches.map((batch) => batch.batchId),
  );

  const lines: CorrectableLineView[] = purchase.lines.flatMap((line) => {
    const batch = lineBatches.find((candidate) => candidate.lineId === line.lineId);
    if (!batch) return [];
    const current = correctedLine(
      lineStateOf(line),
      corrections.filter((correction) => correction.purchaseLineId === line.lineId),
    );
    return [
      {
        lineId: line.lineId,
        batchId: batch.batchId,
        productName: line.productName,
        baseUnitName: line.baseUnitName,
        packLevels: [...line.packLevels],
        qtyBase: current.qtyBase,
        bonusQtyBase: current.bonusQtyBase,
        // [PCN-012] The line's own unit: a box line is corrected in boxes.
        unitName: line.unitName ?? line.baseUnitName,
        factor: current.factor,
        unitCostPaisa: current.unitCostPaisa,
        onHandBase: batch.qtyRemainingBase,
        costPosition: positions.get(batch.batchId) ?? {
          basis: { totalPaisa: 0, receivedBase: 0 },
          takenBase: 0,
        },
        expiryDate: line.expiryDate,
      },
    ];
  });

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <Link href={`/purchases/${purchaseId}`} className="text-green-600 text-sm">
        ← Back to the invoice
      </Link>
      <header>
        <p className="text-ink/50 text-xs tracking-[0.14em] uppercase">Correct or return</p>
        <h1 className="text-green-900 text-2xl font-semibold">
          {purchase.supplierName ?? 'No supplier'}
          {purchase.invoiceRef ? (
            <span className="text-ink/60 numeral ml-2 text-lg">{purchase.invoiceRef}</span>
          ) : null}
        </h1>
        <p className="text-ink/60 mt-1 text-sm">
          Corrections are recorded beside the invoice, never over it, and every one appears on the
          Day screen. Needs a connection.
        </p>
      </header>
      <CorrectSurface lines={lines} supplierName={purchase.supplierName} />
    </section>
  );
}
