/**
 * The data export carries every event table (T3, Phase 9 §8).
 *
 * "Completeness is the feature", and it slipped once: `supplier_payments`
 * (PCN-007) was never added to the export, so a supplier balance could not be
 * reproduced from the export a pharmacy owns. A new event table has three
 * homes — `EVENT_TABLES` (grants), the test purge, and the export — and this
 * pins the third against the first. Exclusions must say why.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EVENT_TABLES } from '../src/db/schema';

const NOT_EXPORTED = new Map<string, string>([
  ['licences', 'PCN-005 licensing records: the vendor relationship, not Phase 9 §2–§4 data.'],
  ['clock_observations', 'PCN-005 licensing evidence about the machine clock.'],
  ['revocations', 'Stage 2 licensing records, as licences.'],
]);

const exportSource = readFileSync(join(process.cwd(), 'src', 'db', 'export-queries.ts'), 'utf8');

describe('the export covers every event table', () => {
  for (const table of EVENT_TABLES) {
    it(`${table} is exported, or excluded with a reason`, () => {
      if (NOT_EXPORTED.has(table)) return;
      expect(exportSource, `${table} is missing from tenantDataExport`).toContain(
        `name: '${table}'`,
      );
    });
  }

  it('has no stale exclusions', () => {
    for (const table of NOT_EXPORTED.keys()) {
      expect(EVENT_TABLES as readonly string[]).toContain(table);
    }
  });
});
