/**
 * `npm run licence:revoke` — mint a signed revocation (Stage 2).
 *
 *   npm run licence:revoke -- --slug al-shifa --licence-id <uuid> --reason chargeback
 *
 * Prints one line the refresh endpoint hands back to a pharmacy, which moves
 * that licence to `restricted` the moment it verifies — the pharmacy keeps
 * selling, printing and exporting; only restocking stops. A revocation NEVER
 * deletes data.
 *
 * Same trust root and same signing-key handling as `licence:issue`: reads
 * `MEHVAR_LICENCE_SIGNING_KEY`, and — for a demo or a test — falls back to the
 * published development key with a loud warning. No database, no network.
 */

import { createPrivateKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { signRevocation, type RevocationPayload } from '../../src/domain/licensing/revocation';
import { DEV_KID, hasProductionKey } from '../../src/domain/trust/keys';

import { DEV_PRIVATE_KEY_PKCS8_BASE64URL } from './dev-key';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function signingKey(): { key: KeyObject; kid: string } {
  const path = process.env.MEHVAR_LICENCE_SIGNING_KEY;
  if (path !== undefined && path.trim() !== '') {
    const raw = readFileSync(path.trim(), 'utf8').trim();
    return {
      key: createPrivateKey({ key: Buffer.from(raw, 'base64url'), format: 'der', type: 'pkcs8' }),
      kid: flag('kid') ?? 'mehvar-1',
    };
  }

  console.warn('');
  console.warn('  ⚠  Signing the revocation with the DEVELOPMENT key.');
  console.warn('     Its private half is committed, so this is forgeable by anyone with the');
  console.warn('     repository. Fine for a demo or a test; NOT fine for a real revocation.');
  if (!hasProductionKey()) {
    console.warn('     No production key is provisioned yet — run: npm run licence:keygen');
  }
  console.warn('');
  return {
    key: createPrivateKey({
      key: Buffer.from(DEV_PRIVATE_KEY_PKCS8_BASE64URL, 'base64url'),
      format: 'der',
      type: 'pkcs8',
    }),
    kid: DEV_KID,
  };
}

function main(): void {
  const slug = flag('slug');
  const licenceId = flag('licence-id');
  if (slug === undefined || licenceId === undefined) {
    console.error(
      'Usage: npm run licence:revoke -- --slug <pharmacy-slug> --licence-id <uuid>\n' +
        '                               [--reason <chargeback|superseded|fraud|...>]',
    );
    process.exit(2);
    return;
  }

  const { key, kid } = signingKey();
  const payload: RevocationPayload = {
    v: 1,
    kid,
    licenceId,
    tenantSlug: slug,
    revokedAt: new Date().toISOString(),
    reason: flag('reason') ?? 'revoked',
  };

  const token = signRevocation(payload, key);

  console.log(`Pharmacy:    ${slug}`);
  console.log(`Licence id:  ${licenceId}`);
  console.log(`Reason:      ${payload.reason}`);
  console.log('');
  console.log(token);
  console.log('');
  console.log('The refresh endpoint returns this as { revocation }. It moves the licence to');
  console.log('restricted on verification — selling, printing and export are unaffected.');
}

main();
