/**
 * Builds a catalogue pack from a source list.
 *
 * WHAT THIS IS FOR
 *
 * The pack is how the catalogue reaches a pharmacy without an application
 * release (see `domain/catalog/pack.ts`). This script is how a pack is made —
 * today from the curated seed list that already ships with the product, later
 * from a DRAP extract or a distributor export processed into the same shape.
 *
 * ON THE STARTER PACK'S CONTENTS
 *
 * It carries the ~50 curated products Phase 11 §4 fixes, marked `verified`,
 * because those are the ones with hand-checked pack structures. That is the
 * *head* of Phase 6 §3's plan and not its breadth: the ~25k DRAP identity seed
 * is a data project with real lead time, and no amount of code substitutes for
 * it. Inventing thousands of plausible-looking medicines to fill the gap would
 * put unverified strengths in front of a pharmacist, which is the one thing a
 * medicine catalogue must never do — so the pipeline is built to accept that
 * data the day it exists, and ships honestly small until then.
 *
 * Usage:
 *   npm run catalog:build -- --version 2026.08.1
 *   npm run catalog:build -- --version 2026.08.1 --out dist/catalog.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { SEED_PRODUCTS } from '../db/seed-data';

import { identityKey } from '../../src/domain/catalog/identity';
import { PACK_FORMAT, readPack, type PackProduct } from '../../src/domain/catalog/pack';

function argumentValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

/** `YYYY.MM.N` — this month, revision 1, when nobody says otherwise. */
function defaultVersion(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, '0')}.1`;
}

function main(): void {
  const catalogVersion = argumentValue('--version') ?? defaultVersion();
  const outPath = resolve(argumentValue('--out') ?? 'dist/catalog/mehvar-catalog.json');

  const products: PackProduct[] = SEED_PRODUCTS.map((seed) => ({
    name: seed.name,
    manufacturer: seed.manufacturer,
    formulaText: seed.formula,
    form: seed.form,
    strength: seed.strength,
    packLevels: [{ name: seed.baseUnit, factor: 1 }, ...seed.packLevels],
    // The seed's MRP is paisa per base unit, which is what the pack carries.
    referenceMrpPaisa: seed.mrp,
    // Hand-checked against real packs, so this is the verified tier (Phase 6 §5).
    quality: 'verified',
    ...(seed.barcode ? { barcodes: [{ barcode: seed.barcode, unitLevelName: seed.baseUnit }] } : {}),
  }));

  /*
   * Refuse to ship a pack with two entries for one medicine.
   *
   * The importer would collapse them silently and the shop would never know,
   * but a duplicate in the SOURCE is a curation error someone needs to fix —
   * and the moment to notice it is while building, not after it has been
   * distributed. Failing here is the whole point.
   */
  const seen = new Map<string, string>();
  for (const product of products) {
    const key = identityKey({
      name: product.name,
      strength: product.strength ?? null,
      form: product.form ?? null,
      manufacturer: product.manufacturer ?? null,
      formulaText: product.formulaText ?? null,
    });
    const previous = seen.get(key);
    if (previous) {
      console.error(
        `Two entries are the same medicine: "${previous}" and "${product.name}" ` +
          `(${product.strength ?? 'no strength'}, ${product.form ?? 'no form'}, ` +
          `${product.manufacturer ?? 'no manufacturer'}).`,
      );
      process.exit(1);
    }
    seen.set(key, product.name);
  }

  const pack = {
    format: PACK_FORMAT,
    catalogVersion,
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    products,
  };

  // Validated with the same reader the application uses, so a pack that would
  // be refused on a pharmacy machine is refused here instead.
  const check = readPack(pack);
  if (!check.ok) {
    console.error('The pack this script just built is not valid:', check.problem);
    process.exit(1);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');

  console.log(
    `Catalogue ${catalogVersion}: ${products.length} medicines, pack format ${PACK_FORMAT}`,
  );
  console.log(`Written to ${outPath}`);
}

main();
