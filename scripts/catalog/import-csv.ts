/**
 * Imports a distributor list, competitor export or DRAP extract.
 *
 * REVIEW BEFORE COMMIT, MEANT LITERALLY
 *
 * Phase 6 §3.3 asks for "mapping assistant, duplicate detection against the
 * global catalog, review-before-commit". This runs in review mode by DEFAULT:
 * it reads the file, shows which column it thinks is which, reports what it
 * could not read and why, and writes nothing. `--commit` is a second,
 * deliberate act.
 *
 * That ordering is the point. These files are 25,000 rows from a source nobody
 * has checked, and an import that writes first and reports afterwards leaves
 * the operator reading a description of damage already done.
 *
 * OFFLINE, AND THROUGH THE SAME WRITER
 *
 * Reads a file, writes to the local database, touches the network for nothing.
 * The rows become a catalogue pack and go through `applyCatalogPack`, so a CSV
 * import inherits the pack path's idempotency and its identity-only boundary
 * rather than reimplementing either.
 *
 * Usage:
 *   npm run catalog:csv -- list.csv
 *   npm run catalog:csv -- list.csv --map 0=name,2=mrp --commit
 *   npm run catalog:csv -- list.csv --commit --version 2026.09.1 --pack-level strip
 */

import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applyCatalogPack } from '../../src/db/catalog-pack-queries';
import { closeDatabase } from '../../src/db/client';
import {
  applyColumnOverrides,
  describeRowProblem,
  parseCatalogCsv,
  rowsToPackProducts,
} from '../../src/domain/catalog/csv';
import { PACK_FORMAT, readPack } from '../../src/domain/catalog/pack';

function argumentValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function defaultVersion(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, '0')}.1`;
}

async function main(): Promise<void> {
  const [, , first] = process.argv;
  if (!first || first.startsWith('--')) {
    console.error('Usage: npm run catalog:csv -- <file.csv> [--map 0=name,...] [--commit]');
    process.exit(2);
  }

  const path = resolve(first);
  const commit = process.argv.includes('--commit');
  const packLevelName = argumentValue('--pack-level') ?? 'pack';

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`Could not read ${path}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  const firstPass = parseCatalogCsv(text);
  if (firstPass.headers.length === 0) {
    console.error('That file has no rows.');
    process.exit(1);
  }

  const overridden = applyColumnOverrides(firstPass.columns, argumentValue('--map') ?? '');
  if (!overridden.ok) {
    console.error(`--map: ${overridden.message}`);
    process.exit(1);
  }
  const parsed = parseCatalogCsv(text, overridden.columns);

  // --- What it thinks the columns are -------------------------------------
  console.log(`\n${path}`);
  console.log(`${parsed.rows.length} row(s) after the header.\n`);
  console.log('Columns:');
  for (const [index, header] of parsed.headers.entries()) {
    const role = parsed.columns[index];
    console.log(
      `  ${String(index).padStart(2)}  ${header.padEnd(24).slice(0, 24)}  ${role ?? '— ignored'}`,
    );
  }
  if (!parsed.columns.includes('name')) {
    console.error(
      '\nNo column looks like the medicine name. Name it with --map, e.g. --map 0=name',
    );
    process.exit(1);
  }
  console.log('\n  Wrong? Correct it with --map, e.g. --map 2=strength,5=mrp\n');

  // --- What could not be read ---------------------------------------------
  const problems = parsed.rows.filter((row) => row.problems.length > 0);
  if (problems.length > 0) {
    console.log(`${problems.length} row(s) cannot be imported:`);
    // Capped: a 25,000-row DRAP extract with a systematic problem would
    // otherwise print 25,000 identical lines and bury the summary.
    for (const row of problems.slice(0, 20)) {
      const why = row.problems.map(describeRowProblem).join(' ');
      console.log(`  line ${row.line}: ${row.name || '(no name)'} — ${why}`);
    }
    if (problems.length > 20) {
      console.log(`  … and ${problems.length - 20} more.`);
    }
    console.log('');
  }

  const unparsedStrength = parsed.rows.filter(
    (row) => row.problems.length === 0 && row.strength !== null && !row.strengthParsed,
  );
  if (unparsedStrength.length > 0) {
    // Not a failure — plenty of real labels are unusual — but worth saying,
    // because an unreadable strength weakens duplicate detection for that row.
    console.log(
      `${unparsedStrength.length} row(s) have a strength Mehvar could not read; they will import, ` +
        'but will only match duplicates by exact text.',
    );
    console.log(`  e.g. ${unparsedStrength.slice(0, 3).map((row) => row.strength).join(', ')}\n`);
  }

  const products = rowsToPackProducts(parsed.rows, { packLevelName });
  console.log(`${products.length} medicine(s) ready to import.`);

  if (!commit) {
    console.log('\nNothing was written. Re-run with --commit to apply.\n');
    return;
  }

  const catalogVersion = argumentValue('--version') ?? defaultVersion();
  const pack = readPack({
    format: PACK_FORMAT,
    catalogVersion,
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    products,
  });
  if (!pack.ok) {
    console.error('\nThe rows did not make a valid catalogue:', pack.problem);
    process.exit(1);
  }

  const summary = await applyCatalogPack(pack.pack, `csv:${path.split(/[\\/]/).pop()}`);
  console.log(`\nCatalogue ${summary.catalogVersion} applied.`);
  console.log(`  ${summary.inserted} new, ${summary.updated} updated.`);
  if (summary.barcodesLinked > 0) console.log(`  ${summary.barcodesLinked} barcode(s) linked.`);
  console.log('Imported as reference data — pack structures are unverified until someone checks a box.');
  console.log('No pharmacy products, prices or stock were changed.\n');
}

main()
  .then(() => closeDatabase())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await closeDatabase();
    process.exit(1);
  });
