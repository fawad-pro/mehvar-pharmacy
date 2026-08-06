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
 *   npm run catalog:import -- <path-to-pack.json>
 *   npm run catalog:import -- <path> --origin installer
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
import { closeDatabase } from '../../src/db/client';
import { compareCatalogVersions, describeProblem, readPackJson } from '../../src/domain/catalog/pack';

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

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`Could not read ${path}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  const parsed = readPackJson(text);
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
