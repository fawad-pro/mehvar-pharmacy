/**
 * `npm run licence:keygen` — mint a trust-root keypair.
 *
 * Run this on the founder's own machine, never on a build agent and never in
 * CI. The private half goes to a password manager and nowhere else; the public
 * half goes into `TRUST_ROOT_KEYS` in `src/domain/trust/keys.ts`.
 *
 * Mint TWO, at the same sitting: `mehvar-1` to sign with, and `mehvar-2` as a
 * cold spare that is never used until it has to be. Rotation is then a one-line
 * change plus a normal release rather than an emergency.
 *
 * No `dotenv/config` here, deliberately: this reaches neither the database nor
 * `src/env`, and a script that reads `.env` as a side effect of being imported
 * is worse than the bug that would prevent.
 */

import { generateKeyPairSync } from 'node:crypto';

function main(): void {
  const kid = process.argv[2] ?? 'mehvar-1';
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  console.log(`Key id:      ${kid}`);
  console.log('');
  console.log('Public  (paste into src/domain/trust/keys.ts → PRODUCTION_KEYS):');
  console.log(
    `  '${kid}': '${publicKey.export({ type: 'spki', format: 'der' }).toString('base64url')}',`,
  );
  console.log('');
  console.log('Private (password manager ONLY — never a repository, never CI):');
  console.log(`  ${privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url')}`);
  console.log('');
  console.log('Save the private half to a file and point MEHVAR_LICENCE_SIGNING_KEY at it.');
}

main();
