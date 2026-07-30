'use server';

/**
 * Customer and udhaar actions — thin wrappers (same posture as `sale/actions.ts`).
 *
 * Every rule lives in the domain or in `src/db`; this file only establishes who
 * is acting and translates typed results for the client.
 */

import { currentSession, scopeFor } from '@/auth/session';
import { createCustomer } from '@/domain/udhaar/writers';
import { commitSettlement, type SettlementResult } from '@/domain/udhaar/commit-settlement';

type SettlementRejection = Extract<SettlementResult, { ok: false }>['reason'];
import {
  customerLedger,
  customerBalance,
  findCustomer,
  listCustomers,
  searchCustomers,
  type CustomerLedgerRow,
  type CustomerPage,
} from '@/db/udhaar-queries';

export interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
  balancePaisa: number;
}

export async function searchCustomersAction(term: string): Promise<CustomerHit[]> {
  const session = await currentSession();
  if (!session) {
    return [];
  }
  return searchCustomers(scopeFor(session), term);
}

export type CreateCustomerOutcome =
  | { ok: true; customer: CustomerHit }
  | { ok: false; message: string };

function messageForCustomer(reason: 'name_required' | 'phone_invalid'): string {
  switch (reason) {
    case 'name_required':
      return 'A name is needed.';
    case 'phone_invalid':
      return 'That phone number does not look right.';
    default:
      return 'That did not save. Try again.';
  }
}

export async function createCustomerAction(input: {
  name: string;
  phone: string | null;
}): Promise<CreateCustomerOutcome> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.tenantSuspended) {
    return { ok: false, message: 'This pharmacy’s account is on hold. Contact support.' };
  }

  const result = await createCustomer(scopeFor(session), input);
  if (!result.ok) {
    const first = result.rejections[0];
    return { ok: false, message: messageForCustomer(first?.reason ?? 'name_required') };
  }

  return {
    ok: true,
    customer: { id: result.value.id, name: input.name.trim(), phone: input.phone, balancePaisa: 0 },
  };
}

export type CommitSettlementOutcome =
  | {
      ok: true;
      receiptNumber: string;
      alreadyCommitted: boolean;
      statement: { previousBalancePaisa: number; amountPaisa: number; newBalancePaisa: number };
    }
  | { ok: false; message: string };

function messageForSettlement(reason: SettlementRejection): string {
  switch (reason) {
    case 'customer_required':
      return 'Pick a customer first.';
    case 'amount_not_positive':
      return 'Enter an amount greater than zero.';
    default:
      return 'That did not save. Try again.';
  }
}

export async function commitSettlementAction(input: {
  paymentId: string;
  receiptNumber: string;
  customerId: string;
  amountPaisa: number;
  clientCommittedAt: string;
}): Promise<CommitSettlementOutcome> {
  const session = await currentSession();
  if (!session) {
    return { ok: false, message: 'This device needs to sign in again.' };
  }
  if (session.tenantSuspended) {
    return { ok: false, message: 'This pharmacy’s account is on hold. Contact support.' };
  }

  const result = await commitSettlement(scopeFor(session), {
    paymentId: input.paymentId,
    receiptNumber: input.receiptNumber,
    customerId: input.customerId,
    amountPaisa: input.amountPaisa,
    origin: 'online',
    clientSchemaVersion: 1,
    clientCommittedAt: new Date(input.clientCommittedAt),
  });

  if (!result.ok) {
    return { ok: false, message: messageForSettlement(result.reason) };
  }

  return {
    ok: true,
    receiptNumber: result.value.receiptNumber,
    alreadyCommitted: result.value.alreadyCommitted,
    statement: {
      previousBalancePaisa: result.value.statement.previousBalancePaisa,
      amountPaisa: result.value.statement.amountPaisa,
      newBalancePaisa: result.value.statement.newBalancePaisa,
    },
  };
}

export async function listCustomersAction(query: {
  search?: string;
  page?: number;
}): Promise<CustomerPage> {
  const session = await currentSession();
  if (!session) {
    return { items: [], total: 0, page: 1, pageSize: 50, pageCount: 1 };
  }
  return listCustomers(scopeFor(session), query);
}

export interface CustomerDetail {
  id: string;
  name: string;
  phone: string | null;
  balancePaisa: number;
  ledger: CustomerLedgerRow[];
}

export async function customerDetailAction(customerId: string): Promise<CustomerDetail | null> {
  const session = await currentSession();
  if (!session) {
    return null;
  }
  const scope = scopeFor(session);
  const customer = await findCustomer(scope, customerId);
  if (!customer) {
    return null;
  }
  const [balancePaisa, ledger] = await Promise.all([
    customerBalance(scope, customerId),
    customerLedger(scope, customerId),
  ]);
  return { ...customer, balancePaisa, ledger };
}
