/**
 * Tenant slugs — the pharmacy's typed login identity.
 *
 * PCN-001: one domain serves every tenant, so a device or an owner arriving at
 * the login screen must name which pharmacy they belong to. That name is typed,
 * on a counter keyboard, by someone who may be reading it off a printed sheet.
 *
 * Kept short and ASCII on purpose. A shop named in Urdu script is the common
 * case in this market, and a slug carrying those characters is one nobody at
 * the counter can enter — so a name that reduces to nothing gets a generated
 * fallback rather than an empty string.
 */

import { uuidv7 } from './uuid';

/** Long enough to stay readable; short enough to retype without error. */
const MAX_SLUG_LENGTH = 40;

export function slugify(name: string, fallbackSuffix?: string): string {
  const slug = name
    .normalize('NFKD')
    // Strip the combining marks NFKD just separated out.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    // Slicing can leave a trailing hyphen behind.
    .replace(/-+$/g, '');

  if (slug !== '') return slug;

  /*
   * The fallback must carry entropy, because `tenants.slug` is unique.
   *
   * Take it from the END of the uuid: UUIDv7 leads with 48 bits of millisecond
   * timestamp, so the first hex characters are near-identical between two
   * installs and identical within the same millisecond. The tail is random.
   */
  const source = (fallbackSuffix ?? uuidv7()).replace(/-/g, '');
  return `shop-${source.slice(-8)}`;
}
