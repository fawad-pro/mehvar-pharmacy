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

  const parsed = parseToken(token);
  if (!parsed.ok) {
    console.error(
      parsed.reason === 'format_too_new'
        ? `This licence needs a newer Mehvar (format ${parsed.found}; this build reads 1).`
        : 'That is not a readable Mehvar licence. Check it was pasted whole, in one line.',
    );
    process.exit(1);
    return;
  }

  const { payload } = parsed;
  console.log(`Pharmacy:    ${payload.customerName}  (${payload.tenantSlug})`);
  console.log(`Licence id:  ${payload.licenceId}`);
  console.log(`Signed by:   ${payload.kid}`);
  console.log(`Issued:      ${payload.issuedAt.slice(0, 10)}`);
  console.log(
    `Paid until:  ${payload.entitlementEndsAt.slice(0, 10)}  (+${payload.graceDays} days grace)`,
  );
  console.log(`Token until: ${payload.expiresAt.slice(0, 10)}  (a notice only — never restricts)`);
  console.log(`Warns from:  ${payload.warnDays} days out`);
  if (payload.clockCeiling !== undefined) {
    console.log(`Clock ceiling: ${payload.clockCeiling}`);
  }
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
