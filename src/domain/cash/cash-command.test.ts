import { describe, expect, it } from 'vitest';

import { directionFor, validateCashMovementCommand, type CashMovementCommand } from './cash-command';

function command(overrides: Partial<CashMovementCommand> = {}): CashMovementCommand {
  return {
    movementId: 'movement-1',
    direction: 'in',
    amountPaisa: 500,
    reason: 'opening_float',
    note: null,
    ...overrides,
  };
}

describe('directionFor', () => {
  it('implies in for an opening float', () => {
    expect(directionFor('opening_float')).toBe('in');
  });

  it('implies out for a withdrawal or an expense', () => {
    expect(directionFor('owner_withdrawal')).toBe('out');
    expect(directionFor('expense')).toBe('out');
  });

  it('has no implied direction for an over/short — the count decides it', () => {
    expect(directionFor('over_short')).toBeNull();
  });
});

describe('validateCashMovementCommand', () => {
  it('accepts a movement whose direction matches its reason', () => {
    expect(validateCashMovementCommand(command()).ok).toBe(true);
  });

  it('rejects a non-positive amount', () => {
    expect(validateCashMovementCommand(command({ amountPaisa: 0 }))).toEqual({
      ok: false,
      reason: 'invalid_amount',
    });
  });

  it('rejects a direction that contradicts its reason', () => {
    expect(
      validateCashMovementCommand(command({ reason: 'expense', direction: 'in' })),
    ).toEqual({ ok: false, reason: 'direction_mismatch' });
  });

  it('accepts an over/short entry in either direction', () => {
    expect(
      validateCashMovementCommand(command({ reason: 'over_short', direction: 'in' })).ok,
    ).toBe(true);
    expect(
      validateCashMovementCommand(command({ reason: 'over_short', direction: 'out' })).ok,
    ).toBe(true);
  });
});
