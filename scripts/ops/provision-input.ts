/**
 * Reading and checking what `tenant:provision` is asked to create.
 *
 * Pure and separate from the script so the refusals are testable without a
 * database. Every input arrives as an environment variable, like `init`: the
 * founder runs it from the Railway shell or CLI, not a wizard.
 */
import { isWellFormedPin, PIN_LENGTH } from '../../src/auth/pin-policy';
import { slugify } from '../../src/lib/slug';

export interface ProvisionInput {
  shopName: string;
  slug: string;
  ownerName: string;
  ownerPin: string;
  deviceName: string;
  address: string | undefined;
  phone: string | undefined;
  timeZone: string;
  plan: string;
  /** Null: the entitlement has no end date. */
  entitlementEndsAt: Date | null;
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

export function readProvisionInput(
  env: Readonly<Record<string, string | undefined>>,
): ProvisionInput {
  const shopName = required('MEHVAR_SHOP_NAME', env.MEHVAR_SHOP_NAME);
  const ownerPin = required('MEHVAR_OWNER_PIN', env.MEHVAR_OWNER_PIN);

  if (!isWellFormedPin(ownerPin)) {
    throw new Error(`MEHVAR_OWNER_PIN must be exactly ${PIN_LENGTH} digits.`);
  }

  const slug = env.MEHVAR_SHOP_SLUG?.trim() || slugify(shopName);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(
      `The login name "${slug}" is not usable: lowercase letters, digits and single hyphens only. ` +
        'Set MEHVAR_SHOP_SLUG.',
    );
  }

  let entitlementEndsAt: Date | null = null;
  const ends = env.MEHVAR_ENTITLEMENT_ENDS?.trim();
  if (ends) {
    entitlementEndsAt = new Date(ends);
    if (Number.isNaN(entitlementEndsAt.getTime())) {
      throw new Error('MEHVAR_ENTITLEMENT_ENDS must be a date, for example 2027-03-31.');
    }
  }

  return {
    shopName,
    slug,
    ownerName: env.MEHVAR_OWNER_NAME?.trim() || 'Owner',
    ownerPin,
    deviceName: env.MEHVAR_DEVICE_NAME?.trim() || 'Counter 1',
    address: env.MEHVAR_SHOP_ADDRESS?.trim() || undefined,
    phone: env.MEHVAR_SHOP_PHONE?.trim() || undefined,
    timeZone: env.TENANT_TIME_ZONE?.trim() || 'Asia/Karachi',
    plan: env.MEHVAR_ENTITLEMENT_PLAN?.trim() || 'pilot',
    entitlementEndsAt,
  };
}
