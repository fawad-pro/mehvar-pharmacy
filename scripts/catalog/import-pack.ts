/**
 * Imports a catalogue pack into this installation.
 *
 * Runs offline by design — it reads a file and writes to the local database,
 * and touches the network for nothing. That is the whole shape of catalogue
 * updates in a local-first product: someone copies a file onto the machine
 * (installer, USB stick, WhatsApp, email attachment) and this applies it.
 *
 * Called by the installer with the bundled starter pack, and by hand or from
 * Settings for every update after that.
 *
 * Usage:
 *   npm run catalog:import -- <pack.signed.json>            (a verified envelope)
 *   npm run catalog:import -- <path> --origin installer
 *   npm run catalog:import -- <raw-pack.json> --trusted-local (build-produced only)
 *
 * A pack that arrives from outside the application MUST be a signed envelope,
 * verified against the trust root. A RAW (unsigned) pack is accepted only with
 * `--trusted-local`, which asserts it is the build-produced starter pack that
 * ships inside the code-signed installer — see `domain/catalog/signed-pack.ts`.
 *
 * `dotenv/config` first, like every other script that reaches the database.
 * Without it this reads `.env` only when the shell already happens to export
 * the variables — which is true on a developer machine mid-session and false
 * on every clean run, so it fails exactly where it must not.
 */

import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyCatalogPack, currentCatalog } from '../../src/db/catalog-pack-queries';
import { installationPermits } from '../../src/db/licence-gate-queries';
import { closeDatabase } from '../../src/db/client';
import {
  compareCatalogVersions,
  describeProblem,
  readPackJson,
} from '../../src/domain/catalog/pack';
import { looksSigned, verifySignedPack } from '../../src/domain/catalog/signed-pack';

function signedPackError(reason: 'malformed' | 'unknown_key' | 'bad_signature'): string {
  switch (reason) {
    case 'unknown_key':
      return 'This catalogue was signed with a key this copy of Mehvar does not recognise. Update Mehvar, or contact support.';
    case 'bad_signature':
      return 'This catalogue’s signature does not check out — it may have been altered in transit. Download it again.';
    case 'malformed':
      return 'That file is not a readable signed catalogue.';
  }
}

function argumentValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const [, , first] = process.argv;
  if (!first || first.startsWith('--')) {
    console.error('Usage: npm run catalog:import -- <path-to-pack.json> [--origin <name>]');
    process.exit(2);
  }

  const path = resolve(first);
  const origin = argumentValue('--origin') ?? 'manual';

  const trustedLocal = process.argv.includes('--trusted-local');

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`Could not read ${path}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // [Stage 2] Trust before structure. A signed envelope is verified against the
  // trust root here; only then is its contents parsed. A raw pack is refused
  // unless the caller asserts it is the build-produced local artifact.
  let packText: string;
  if (looksSigned(text)) {
    const verified = verifySignedPack(text);
    if (!verified.ok) {
      console.error(signedPackError(verified.reason));
      process.exit(1);
    }
    packText = verified.packJson;
  } else if (trustedLocal) {
    packText = text;
  } else {
    console.error(
      'This catalogue is not signed, so it cannot be trusted for import.\n' +
        'Catalogue updates from Mehvar arrive as a signed file. If this is the\n' +
        'starter catalogue built on this machine, re-run with --trusted-local.',
    );
    process.exit(1);
  }

  const parsed = readPackJson(packText);
  if (!parsed.ok) {
    // The same sentence the operator would see in the application — one
    // wording for one problem, wherever it is met.
    console.error(describeProblem(parsed.problem));
    process.exit(1);
  }

  const existing = await currentCatalog();
  if (existing) {
    const direction = compareCatalogVersions(parsed.pack.catalogVersion, existing.catalogVersion);
    if (direction < 0) {
      /*
       * Warn, do not refuse.
       *
       * Rolling back to a known-good catalogue is a legitimate thing to want
       * during a support call, and a tool that will not let you is a tool
       * somebody works around with psql. Saying it out loud is enough — the
       * import is recorded either way, so the history shows what happened.
       */
      console.warn(
        `Note: ${parsed.pack.catalogVersion} is OLDER than the ${existing.catalogVersion} ` +
          'already applied. Importing anyway.',
      );
    } else if (direction === 0) {
      console.log(
        `${existing.catalogVersion} is already applied. Re-importing is safe and will refresh it.`,
      );
    }
  }

  // [PCN-005] Catalogue updates are one of the four things a lapsed licence
  // withholds. Nothing about selling changes — the pharmacy keeps trading on
  // the catalogue it already has, and W6's quick item still means an unknown
  // medicine never blocks a sale.
  if (!(await installationPermits('catalog_pack'))) {
    console.error(
      'This pharmacy’s licence has lapsed, so catalogue updates are paused.\n' +
        'Selling, printing and export are unaffected. Renew in Settings → Licence,\n' +
        'or contact Mehvar support.',
    );
    await closeDatabase();
    process.exit(1);
  }

  const summary = await applyCatalogPack(parsed.pack, origin);

  console.log(`Catalogue ${summary.catalogVersion} applied from ${origin}.`);
  console.log(`  ${summary.inserted} new, ${summary.updated} updated.`);
  if (summary.barcodesLinked > 0) {
    console.log(`  ${summary.barcodesLinked} barcode(s) linked.`);
  }
  const collapsed = parsed.pack.productCount - (summary.inserted + summary.updated);
  if (collapsed > 0) {
    console.warn(
      `  ${collapsed} entr${collapsed === 1 ? 'y was' : 'ies were'} the same medicine as ` +
        'another in the file, and only the last was kept.',
    );
  }
  console.log('No pharmacy products, prices or stock were changed.');
}

main()
  .then(() => closeDatabase())
  .catch(async (error: unknown) => {
    console.error(error);
    await closeDatabase();
    process.exit(1);
  });
