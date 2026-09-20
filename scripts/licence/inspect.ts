/**
 * `npm run licence:inspect -- <token>` — the support tool.
 *
 * Paste what the customer pasted and see exactly what the software sees. No
 * database, no network, no configuration: it decodes, verifies and prints.
 *
 * It exists because "it says my licence is invalid" is otherwise a conversation
 * with no shared facts in it.
 */

import { readFileSync } from 'node:fs';

import { REVOCATION_PREFIX, verifyRevocation } from '../../src/domain/licensing/revocation';
import { LICENCE_FORMAT_VERSION } from '../../src/domain/licensing/state';
import { parseToken } from '../../src/domain/licensing/token';
import { verifyToken } from '../../src/domain/licensing/verify';

function main(): void {
  const argument = process.argv[2];
  if (argument === undefined) {
    console.error('Usage: npm run licence:inspect -- <token | path-to-file>');
    process.exit(2);
    return;
  }

  let token = argument.trim();
  if (!token.startsWith('MEHVAR')) {
    try {
      token = readFileSync(token, 'utf8').trim();
    } catch {
      // Not a path either — fall through and let the parser say so plainly.
    }
  }

  if (token.startsWith(`${REVOCATION_PREFIX}.`)) {
    const verified = verifyRevocation(token);
    if (verified.ok) {
      const r = verified.revocation.payload;
      console.log(`Revocation for licence ${r.licenceId}`);
      console.log(`Pharmacy:    ${r.tenantSlug}`);
      console.log(`Reason:      ${r.reason}`);
      console.log(`Revoked at:  ${r.revokedAt.slice(0, 10)}`);
      console.log(`Signed by:   ${r.kid}`);
      console.log('Signature:   VALID against this build\u2019s trust root.');
    } else {
      console.log(`Revocation signature REFUSED — ${verified.reason}.`);
      process.exitCode = 1;
    }
    return;
  }

  const parsed = parseToken(token);
  if (!parsed.ok) {
    console.error(
      parsed.reason === 'format_too_new'
        ? `This licence needs a newer Mehvar (format ${parsed.found}; this build reads ${LICENCE_FORMAT_VERSION}).`
        : 'That is not a readable Mehvar licence. Check it was pasted whole, in one line.',
    );
    process.exit(1);
    return;
  }

  const { payload } = parsed;
  console.log(`Pharmacy:    ${payload.customerName}  (${payload.tenantSlug})`);
  console.log(`Licence id:  ${payload.licenceId}`);
  console.log(`Signed by:   ${payload.kid}`);
  console.log(`Issued:      ${payload.issuedAt.slice(0, 10)}  (perpetual — never expires)`);
  if (payload.plan !== undefined) console.log(`Plan:        ${payload.plan}`);
  if (payload.branches !== undefined) console.log(`Branches:    ${payload.branches}`);
  console.log('');

  const verified = verifyToken(token);
  if (verified.ok) {
    console.log('Signature:   VALID against this build’s trust root.');
  } else {
    console.log(`Signature:   REFUSED — ${verified.reason}.`);
    if (verified.reason === 'unknown_key') {
      console.log('             This build does not carry the key that signed it.');
    }
    process.exitCode = 1;
  }
}

main();
