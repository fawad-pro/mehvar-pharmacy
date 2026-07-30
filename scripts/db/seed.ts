/**
 * `db:seed` — the demo pharmacy.
 *
 * ============================================================================
 * NOT YET IMPLEMENTED. Session 1 / Day 1 (Phase 13 §3).
 * ============================================================================
 *
 * Phase 11 §4 fixes its contents precisely: "~50 curated products with real
 * pack structures, a customer with balance, an open purchase draft". Phase 13
 * Day 1 adds opening batches.
 *
 * This seed is not a test fixture. Per Phase 12 §1 it is also the staging
 * environment's data, which doubles as the sales demo environment (Phase 11 §5)
 * — demos are the sales channel (Phase 13 §1.2), so this data is customer-facing
 * and its quality is product quality.
 */
import 'dotenv/config';

async function main(): Promise<void> {
  console.log('No seed yet — the demo pharmacy lands in Session 1 (Day 1).');
  return Promise.resolve();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
