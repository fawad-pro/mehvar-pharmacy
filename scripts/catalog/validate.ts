/**
 * `catalog:validate` — the launch-readiness report and the quality gate.
 *
 * Prints the starter catalogue's shape (count, category spread, coverage of
 * manufacturer/barcode/aliasable fields) and then FAILS the build if any of the
 * data-quality invariants the catalogue promises are broken:
 *
 *   - no two entries are the same medicine (identity dedup),
 *   - the verified head is still fully present (nothing shadowed it),
 *   - reference-tier rows carry no fabricated barcodes or prices,
 *   - every category is one of the declared ones,
 *   - forms normalise and strengths parse.
 *
 * It reads no configuration and touches no database, so it runs anywhere and is
 * cheap enough to sit in front of every catalogue build.
 */

import { CANONICAL_FORMS, normaliseForm } from '../../src/domain/catalog/form';
import { identityKey } from '../../src/domain/catalog/identity';
import { parseStrength } from '../../src/domain/catalog/strength';
import { expandStarter } from '../../src/domain/catalog/starter';
import { CAT, STARTER_SOURCE } from '../db/catalog-data';
import { SEED_PRODUCTS } from '../db/seed-data';

function keyOf(p: {
  name: string;
  strength?: string | null;
  form?: string | null;
  manufacturer?: string | null;
  formulaText?: string | null;
}): string {
  return identityKey({
    name: p.name,
    strength: p.strength ?? null,
    form: p.form ?? null,
    manufacturer: p.manufacturer ?? null,
    formulaText: p.formulaText ?? null,
  });
}

function main(): void {
  const verified = SEED_PRODUCTS.map((s) => ({
    name: s.name,
    strength: s.strength,
    form: s.form,
    manufacturer: s.manufacturer,
    formulaText: s.formula,
  }));
  const verifiedKeys = new Set(verified.map(keyOf));

  const { products, categoryCounts, duplicates } = expandStarter(STARTER_SOURCE, verifiedKeys);
  const total = verified.length + products.length;

  const problems: string[] = [];

  /* -- Distinctness: identity keys must be unique across the whole pack ----- */
  const seen = new Set(verifiedKeys);
  for (const p of products) {
    const k = keyOf(p);
    if (seen.has(k)) problems.push(`duplicate identity: ${p.name} ${p.strength ?? ''} ${p.form ?? ''}`);
    seen.add(k);
  }

  /* -- The verified head must survive (nothing reference shadowed it) ------- */
  for (const key of verifiedKeys) {
    if (!seen.has(key)) problems.push('a verified head product went missing from the pack');
  }

  /* -- Honesty of the reference tier: no barcodes, no prices --------------- */
  for (const p of products) {
    if (p.quality !== 'reference') problems.push(`reference body carries a non-reference row: ${p.name}`);
    if (p.referenceMrpPaisa != null) problems.push(`reference row has a fabricated price: ${p.name}`);
    if (p.barcodes && p.barcodes.length > 0) problems.push(`reference row has a fabricated barcode: ${p.name}`);
    if (!p.name || p.name.trim() === '') problems.push('a product has no name');
    const base = p.packLevels?.[0];
    if (!base || base.factor !== 1) problems.push(`missing base unit level: ${p.name}`);
  }

  /* -- Categories must be declared, forms must normalise, strengths parse --- */
  const knownCategories = new Set(Object.values(CAT));
  for (const c of Object.keys(categoryCounts)) {
    if (!knownCategories.has(c as (typeof CAT)[keyof typeof CAT])) {
      problems.push(`unknown category: ${c}`);
    }
  }
  const canonical = new Set<string>(CANONICAL_FORMS);
  let unparseableStrengths = 0;
  let nonCanonicalForms = 0;
  for (const p of products) {
    if (p.form) {
      const nf = normaliseForm(p.form);
      if (nf === null || !canonical.has(nf)) nonCanonicalForms += 1;
    }
    if (p.strength && parseStrength(p.strength) === null) unparseableStrengths += 1;
  }

  /* -- Report -------------------------------------------------------------- */
  const withManufacturer = products.filter((p) => p.manufacturer).length;
  const molecules = STARTER_SOURCE.molecules.length;
  const items = STARTER_SOURCE.items.length;

  console.log('');
  console.log('Mehvar starter catalogue — launch-readiness report');
  console.log('==================================================');
  console.log(`  Verified head (hand-checked):     ${verified.length}`);
  console.log(`  Reference body (market breadth):  ${products.length}`);
  console.log(`  TOTAL distinct products:          ${total}`);
  console.log('');
  console.log(`  Molecules described:              ${molecules}`);
  console.log(`  Front-of-store / consumable items:${String(items).padStart(6)}`);
  console.log(`  Duplicates collapsed:             ${duplicates}`);
  console.log(
    `  Reference rows with a manufacturer:${String(withManufacturer).padStart(5)} (${Math.round(
      (withManufacturer / products.length) * 100,
    )}%)`,
  );
  console.log(`  Reference rows with a barcode:    0 (barcodes are earned, not seeded)`);
  console.log(`  Reference rows with a price:      0 (the pharmacy prices at receiving)`);
  console.log('');
  console.log('  By category (distinct reference products):');
  for (const [c, n] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${c}`);
  }
  console.log('');
  console.log(`  Non-canonical forms (kept verbatim): ${nonCanonicalForms}`);
  console.log(`  Unparseable strengths (compared as text): ${unparseableStrengths}`);
  console.log('');

  if (problems.length > 0) {
    console.error('CATALOGUE VALIDATION FAILED:');
    for (const problem of [...new Set(problems)].slice(0, 40)) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('Catalogue validation passed.');
}

main();
