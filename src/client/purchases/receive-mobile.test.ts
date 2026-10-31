import { describe, expect, it } from 'vitest';

import { lineCostPaisa, purchaseWarnings } from '@/domain/purchases/purchase-command';
import { formatExpiry } from '@/lib/expiry';
import { formatPaisa } from '@/lib/money';
import { paisa } from '@/lib/branded';
import type { DraftLine } from '@/client/purchases/draft';

describe('Mobile Receive Stock Workflow', () => {
  it('correctly calculates line costs and invoice total for multiple products', () => {
    const line1: DraftLine = {
      lineId: 'line-1',
      productId: 'prod-1',
      productName: 'Hydryllin Syrup',
      baseUnitName: 'bottle',
      qtyBase: 5,
      bonusQtyBase: 0,
      unitCostPaisa: paisa(15000), // Rs 150.00
      expiryDate: '2028-03-31',
      batchNumber: 'HYD-001',
      mrpAtReceivingPaisa: paisa(18000),
      priceAtReceivingPaisa: paisa(18000),
      entered: {
        unitKey: 'bottle',
        unitName: 'bottle',
        unitCount: 5,
        bonusUnitCount: 0,
        unitCostPaisa: paisa(15000),
        pricePaisa: paisa(18000),
      },
    };

    const line2: DraftLine = {
      lineId: 'line-2',
      productId: 'prod-2',
      productName: 'Galvus 50mg',
      baseUnitName: 'box',
      qtyBase: 2,
      bonusQtyBase: 0,
      unitCostPaisa: paisa(140000), // Rs 1,400.00
      expiryDate: '2027-06-30',
      batchNumber: 'GLV-999',
      mrpAtReceivingPaisa: paisa(150000),
      priceAtReceivingPaisa: paisa(150000),
      entered: {
        unitKey: 'box',
        unitName: 'box',
        unitCount: 2,
        bonusUnitCount: 0,
        unitCostPaisa: paisa(140000),
        pricePaisa: paisa(150000),
      },
    };

    const line1Cost = lineCostPaisa(line1);
    expect(line1Cost).toBe(75000); // 5 * 150 = 750.00 (75000 paisa)
    expect(formatPaisa(paisa(line1Cost), { withSymbol: true })).toBe('Rs 750.00');

    const line2Cost = lineCostPaisa(line2);
    expect(line2Cost).toBe(280000); // 2 * 1400 = 2800.00 (280000 paisa)
    expect(formatPaisa(paisa(line2Cost), { withSymbol: true })).toBe('Rs 2,800.00');

    const totalInvoicePaisa = line1Cost + line2Cost;
    expect(totalInvoicePaisa).toBe(355000); // Rs 3,550.00
    expect(formatPaisa(paisa(totalInvoicePaisa), { withSymbol: true })).toBe('Rs 3,550.00');
  });

  it('formats expiry and batch clearly for mobile display', () => {
    const expiryDate = '2028-03-31';
    expect(formatExpiry(expiryDate)).toBe('03/2028');
  });

  it('validates warnings on received stock without blocking entry', () => {
    // Selling price less than cost generates warning
    const command = {
      purchaseId: 'p-1',
      supplierId: 'sup-1',
      invoiceRef: 'INV-123',
      invoiceDate: '2026-10-31',
      note: null,
      cashPaidPaisa: 355000,
      lines: [
        {
          lineId: 'line-3',
          productId: 'prod-3',
          productName: 'Panadol CF',
          baseUnitName: 'tab',
          qtyBase: 10,
          bonusQtyBase: 0,
          unitCostPaisa: paisa(5000), // Rs 50
          expiryDate: '2027-01-31',
          batchNumber: 'B123',
          mrpAtReceivingPaisa: null,
          priceAtReceivingPaisa: paisa(4000), // Rs 40 (less than cost!)
          entered: {
            unitKey: 'tab',
            unitName: 'tab',
            unitCount: 10,
            bonusUnitCount: 0,
            unitCostPaisa: paisa(5000),
            pricePaisa: paisa(4000),
          },
        },
      ],
    };

    const warnings = purchaseWarnings(command);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.kind === 'price_below_cost')).toBe(true);
  });
});
