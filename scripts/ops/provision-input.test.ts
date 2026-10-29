import { describe, expect, it } from 'vitest';

import { readProvisionInput } from './provision-input';

const base = { MEHVAR_SHOP_NAME: 'Al-Shifa Medical Store', MEHVAR_OWNER_PIN: '4821' };

describe('tenant:provision input', () => {
  it('derives the login name from the shop name and defaults the rest', () => {
    const input = readProvisionInput(base);
    expect(input).toMatchObject({
      slug: 'al-shifa-medical-store',
      ownerName: 'Owner',
      deviceName: 'Counter 1',
      plan: 'pilot',
      entitlementEndsAt: null,
    });
  });

  it('refuses a missing shop name and a malformed PIN', () => {
    expect(() => readProvisionInput({ MEHVAR_OWNER_PIN: '4821' })).toThrow(/MEHVAR_SHOP_NAME/);
    expect(() => readProvisionInput({ ...base, MEHVAR_OWNER_PIN: '12a4' })).toThrow(/4 digits/);
  });

  it('refuses a login name that nobody could type', () => {
    expect(() => readProvisionInput({ ...base, MEHVAR_SHOP_SLUG: 'Al Shifa!' })).toThrow(
      /not usable/,
    );
  });

  it('reads an end date and refuses junk', () => {
    const input = readProvisionInput({ ...base, MEHVAR_ENTITLEMENT_ENDS: '2027-03-31' });
    expect(input.entitlementEndsAt?.toISOString()).toBe('2027-03-31T00:00:00.000Z');
    expect(() => readProvisionInput({ ...base, MEHVAR_ENTITLEMENT_ENDS: 'soon' })).toThrow(
      /must be a date/,
    );
  });
});
