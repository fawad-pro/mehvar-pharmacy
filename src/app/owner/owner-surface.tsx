'use client';

/**
 * Owner remote view — W11. Bottom-tab navigation, huge numerals (I6), read
 * only (V1). "This is what 'check your shop from anywhere' in the sales
 * pitch concretely is" (Phase 10 §2).
 */

import { useState } from 'react';

import { formatPaisa } from '@/lib/money';
import { paisa } from '@/lib/branded';

type Tab = 'today' | 'stock' | 'udhaar';

/**
 * Shaped like `ThreeNumbers` (`@/db/reporting-queries`) but declared fresh
 * rather than imported — a client component must never import from a module
 * that reaches the database, even for a type (Day 5's rule): the type import
 * is erased at compile time, but nothing here can verify that by reading the
 * file, so the rule is "don't name the module" rather than "the import is
 * safe if it's type-only".
 */
interface ThreeNumbers {
  readonly salesPaisa: number;
  readonly expectedCashPaisa: number;
  readonly udhaarOwedPaisa: number;
  readonly udhaarCreditPaisa: number;
  readonly customersOwing: number;
  readonly customersInCredit: number;
}

interface LowStockItem {
  productName: string;
  onHandBase: number;
  minStockBaseUnits: number;
  baseUnitName: string;
  /** [PCN-012] The amount in the product's own units ("3 box, 2 strip"). */
  onHand: string;
}

interface ExpiringItem {
  productName: string;
  expiryDate: string;
  qtyRemainingBase: number;
  baseUnitName: string;
}

interface IncidentItem {
  productName: string;
  pendingBase: number;
  baseUnitName: string;
  /** [PCN-012] The shortfall in the product's own units. */
  amount: string;
}

interface CustomerItem {
  id: string;
  name: string;
  phone: string | null;
  balancePaisa: number;
}

export function OwnerSurface({
  tenantName,
  numbers,
  lowStock,
  expiring,
  incidents,
  customers,
}: {
  tenantName: string;
  numbers: ThreeNumbers;
  lowStock: LowStockItem[];
  expiring: ExpiringItem[];
  incidents: IncidentItem[];
  customers: CustomerItem[];
}) {
  const [tab, setTab] = useState<Tab>('today');

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <header className="border-line border-b p-4">
        <p className="text-green-600 text-xs font-medium tracking-[0.18em] uppercase">Mehvar</p>
        <h1 className="text-green-900 text-lg font-semibold">{tenantName}</h1>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-20">
        {tab === 'today' ? <TodayTab numbers={numbers} incidents={incidents} /> : null}
        {tab === 'stock' ? <StockTab lowStock={lowStock} expiring={expiring} /> : null}
        {tab === 'udhaar' ? <UdhaarTab customers={customers} /> : null}
      </main>

      <nav
        className="border-line bg-paper fixed bottom-0 left-0 right-0 mx-auto flex max-w-md border-t"
        aria-label="Owner view"
      >
        {(
          [
            { id: 'today', label: 'Today' },
            { id: 'stock', label: 'Stock' },
            { id: 'udhaar', label: 'Udhaar' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
            }}
            aria-current={tab === item.id ? 'page' : undefined}
            className={[
              'min-h-touch flex-1 py-3 text-sm font-medium',
              tab === item.id ? 'text-green-900 border-green-600 border-t-2' : 'text-ink/50',
            ].join(' ')}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function TodayTab({
  numbers,
  incidents,
}: {
  numbers: ThreeNumbers;
  incidents: IncidentItem[];
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* The three numbers, huge (I6) — this tab answers all three of the
          owner's questions in one glance. */}
      <div className="grid grid-cols-1 gap-3">
        <NumberCard label="Today's sales" amountPaisa={numbers.salesPaisa} />
        <NumberCard label="Expected cash in drawer" amountPaisa={numbers.expectedCashPaisa} />
        <NumberCard label="Owed to you" amountPaisa={numbers.udhaarOwedPaisa} amber />
      </div>

      <div>
        <h2 className="text-green-900 mb-2 font-medium">Sold more than the system had</h2>
        {incidents.length === 0 ? (
          <p className="text-ink/50 text-sm">Nothing outstanding.</p>
        ) : (
          <ul className="border-line divide-line divide-y rounded border text-sm">
            {incidents.map((incident) => (
              <li key={incident.productName} className="flex justify-between px-3 py-2">
                <span>{incident.productName}</span>
                <span className="numeral text-amber">{incident.amount}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StockTab({
  lowStock,
  expiring,
}: {
  lowStock: LowStockItem[];
  expiring: ExpiringItem[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-green-900 mb-2 flex items-baseline gap-2 font-medium">
          Expiring within 30 days
          <span className="numeral text-ink/50 text-sm font-normal">{expiring.length}</span>
        </h2>
        {expiring.length === 0 ? (
          <p className="text-ink/50 text-sm">Nothing expiring soon.</p>
        ) : (
          <ul className="border-line divide-line divide-y rounded border text-sm">
            {expiring.map((row) => (
              <li
                key={`${row.productName}-${row.expiryDate}`}
                className="flex justify-between px-3 py-2"
              >
                <span>{row.productName}</span>
                <span className="numeral text-amber">{row.expiryDate}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="text-green-900 mb-2 flex items-baseline gap-2 font-medium">
          Running low
          <span className="numeral text-ink/50 text-sm font-normal">{lowStock.length}</span>
        </h2>
        {lowStock.length === 0 ? (
          <p className="text-ink/50 text-sm">Nothing below its minimum.</p>
        ) : (
          <ul className="border-line divide-line divide-y rounded border text-sm">
            {lowStock.map((row) => (
              <li key={row.productName} className="flex justify-between px-3 py-2">
                <span>{row.productName}</span>
                <span className="numeral text-sm">{row.onHand}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function UdhaarTab({ customers }: { customers: CustomerItem[] }) {
  return (
    <div>
      <h2 className="text-green-900 mb-2 font-medium">Balances, largest first</h2>
      {customers.length === 0 ? (
        <p className="text-ink/50 text-sm">No udhaar customers yet.</p>
      ) : (
        <ul className="border-line divide-line divide-y rounded border text-sm">
          {customers.map((customer) => (
            <li key={customer.id} className="flex justify-between px-3 py-2">
              <span>{customer.name}</span>
              <span className="numeral font-medium">
                {formatPaisa(paisa(customer.balancePaisa))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NumberCard({
  label,
  amountPaisa,
  amber = false,
}: {
  label: string;
  amountPaisa: number;
  amber?: boolean;
}) {
  return (
    <div className="border-line rounded border p-4">
      <p className="text-ink/60 text-xs tracking-[0.1em] uppercase">{label}</p>
      <p className={`numeral mt-1 text-3xl font-semibold ${amber ? 'text-amber' : 'text-green-900'}`}>
        {formatPaisa(paisa(amountPaisa), { withSymbol: true })}
      </p>
    </div>
  );
}
