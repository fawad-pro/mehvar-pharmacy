/**
 * `npm run licence:issue` — mint a perpetual licence for one pharmacy.
 *
 *   npm run licence:issue -- --slug al-shifa --name "Al-Shifa Medical Store"
 *
 * Prints one line of text the founder sends over WhatsApp and the owner pastes
 * into Settings → Licence. Nothing here touches the database or the network:
 * issuing is a signature over a JSON payload, and at this scale a private
 * append-only file is a better ledger than a service nobody has to operate.
 *
 * PCN-006: the licence is **perpetual and identity-only**. There is no term,
 * expiry, grace or warn period — a valid bound token authorizes an installation
 * forever. `issuedAt` is kept as unforgeable support metadata and drives no
 * capability. A re-issue shares the original `--licence-id` so Invariant L2
 * supersedes within one licence.
 *
 * No `dotenv/config`: this reaches neither the database nor `src/env`. It reads
 * one variable, `MEHVAR_LICENCE_SIGNING_KEY`, and says so if it is missing.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';

import { signPayload } from '../../src/domain/licensing/sign';
import { LICENCE_FORMAT_VERSION, type LicencePayload } from '../../src/domain/licensing/state';
import { DEV_KID, hasProductionKey } from '../../src/domain/trust/keys';
import { uuidv7 } from '../../src/lib/uuid';

import { DEV_PRIVATE_KEY_PKCS8_BASE64URL } from './dev-key';

const LEDGER = 'licences.jsonl';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * The signing key, and the warning that goes with the fallback.
 *
 * Falling back to the dev key is what keeps the chain runnable before a
 * production key exists. It must never be quiet about it: a token signed with a
 * published private key is forgeable by anybody who reads this repository.
 */
function signingKey(): { key: ReturnType<typeof createPrivateKey>; kid: string } {
  const path = process.env.MEHVAR_LICENCE_SIGNING_KEY;
  if (path !== undefined && path.trim() !== '') {
    const raw = readFileSync(path.trim(), 'utf8').trim();
    const kid = flag('kid') ?? 'mehvar-1';
    return {
      key: createPrivateKey({ key: Buffer.from(raw, 'base64url'), format: 'der', type: 'pkcs8' }),
      kid,
    };
  }

  console.warn('');
  console.warn('  ⚠  Signing with the DEVELOPMENT key.');
  console.warn('     Its private half is committed in scripts/licence/dev-key.ts, so this');
  console.warn('     token can be forged by anyone with the repository. Fine for a demo or');
  console.warn('     a test; NOT fine for a paying pharmacy.');
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
  const name = flag('name');
  if (slug === undefined || name === undefined) {
    console.error(
      'Usage: npm run licence:issue -- --slug <pharmacy-slug> --name "<Customer Name>"\n' +
        '                             [--licence-id <uuid>]   re-issue an existing licence\n' +
        '                             [--branches <n>]        multi-branch metadata (unenforced)\n' +
        '                             [--kid <key-id>]        signing key id (default mehvar-1)',
    );
    process.exit(2);
    return;
  }

  const issuedAt = new Date();
  const { key, kid } = signingKey();

  const payload: LicencePayload = {
    v: LICENCE_FORMAT_VERSION,
    kid,
    licenceId: flag('licence-id') ?? uuidv7(),
    tenantSlug: slug,
    customerName: name,
    plan: 'standard',
    branches: Number(flag('branches') ?? 1),
    issuedAt: issuedAt.toISOString(),
  };

  const token = signPayload(payload, key);

  console.log(`Pharmacy:   ${name}  (${slug})`);
  console.log(`Licence id: ${payload.licenceId}`);
  console.log(`Issued:     ${issuedAt.toISOString().slice(0, 10)}  (perpetual — never expires)`);
  console.log('');
  console.log(token);
  console.log('');
  console.log('Send that line to the pharmacy. They paste it into Settings → Licence.');

  // A re-issue shares its licence id (Invariant L2 supersedes within one), so
  // the ledger is what tells the founder which id to re-issue against.
  try {
    appendFileSync(LEDGER, `${JSON.stringify({ ...payload, token })}\n`, 'utf8');
    console.log(`Recorded in ${LEDGER}.`);
  } catch (error) {
    console.warn(
      `Could not append to ${LEDGER}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

main();
