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
 * It carries the curated starter catalogue in `seed-data.ts` — ~150 of the
 * most commonly stocked medicines and pharmacy products in Pakistan, each with
 * a hand-checked, DRAP-cross-referenced pack structure — marked `verified`.
 * That is the *head* of Phase 6 §3's plan and not its breadth: the ~25k DRAP
 * identity seed is a data project with real lead time, and no amount of code
 * substitutes for it. Inventing thousands of plausible-looking medicines to
 * fill the gap would put unverified strengths in front of a pharmacist, which
 * is the one thing a medicine catalogue must never do — so the pipeline is
 * built to accept that data the day it exists, and every entry that ships is
 * one whose identity was verified rather than guessed.
 *
 * Usage:
 *   npm run catalog:build -- --version 2026.08.1
 *   npm run catalog:build -- --version 2026.08.1 --out dist/catalog.json
 *   npm run catalog:build -- --version 2026.08.1 --sign --out dist/pack.signed.json
 *
 * `--sign` wraps the pack in a trust-root-signed envelope for distribution
 * (roadmap Phase 3). It reads the signing key from MEHVAR_LICENCE_SIGNING_KEY,
 * and — for a demo or a test — falls back to the published development key with
 * a loud warning, exactly as `licence:issue` does. The UNSIGNED output remains
 * the default: it is the build-produced starter pack the installer bundles and
 * imports with --trusted-local.
 */

import { createPrivateKey, type KeyObject } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { SEED_PRODUCTS } from '../db/seed-data';
import { DEV_PRIVATE_KEY_PKCS8_BASE64URL } from '../licence/dev-key';

import { identityKey } from '../../src/domain/catalog/identity';
import { PACK_FORMAT, readPack, type PackProduct } from '../../src/domain/catalog/pack';
import { signPack } from '../../src/domain/catalog/signed-pack';
import { DEV_KID, hasProductionKey } from '../../src/domain/trust/keys';

function argumentValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

/** `YYYY.MM.N` — this month, revision 1, when nobody says otherwise. */
function defaultVersion(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, '0')}.1`;
}

function signingKey(): { key: KeyObject; kid: string } {
  const path = process.env.MEHVAR_LICENCE_SIGNING_KEY;
  if (path !== undefined && path.trim() !== '') {
    const raw = readFileSync(path.trim(), 'utf8').trim();
    return {
      key: createPrivateKey({ key: Buffer.from(raw, 'base64url'), format: 'der', type: 'pkcs8' }),
      kid: argumentValue('--kid') ?? 'mehvar-1',
    };
  }

  console.warn('');
  console.warn('  ⚠  Signing the catalogue with the DEVELOPMENT key.');
  console.warn('     Its private half is committed, so this pack can be forged by anyone with');
  console.warn('     the repository. Fine for a demo or a test; NOT fine for distribution.');
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
  const catalogVersion = argumentValue('--version') ?? defaultVersion();
  const sign = process.argv.includes('--sign');
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
    ...(seed.barcode
      ? { barcodes: [{ barcode: seed.barcode, unitLevelName: seed.baseUnit }] }
      : {}),
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
  if (sign) {
    const { key, kid } = signingKey();
    const envelope = signPack(JSON.stringify(pack), kid, key);
    writeFileSync(outPath, `${envelope}\n`, 'utf8');
    console.log(`Catalogue ${catalogVersion}: ${products.length} medicines, signed by ${kid}`);
  } else {
    writeFileSync(outPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
    console.log(
      `Catalogue ${catalogVersion}: ${products.length} medicines, pack format ${PACK_FORMAT} (unsigned)`,
    );
  }
  console.log(`Written to ${outPath}`);
}

main();
