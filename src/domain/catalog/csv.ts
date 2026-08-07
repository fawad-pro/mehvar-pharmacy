/**
 * Reading a distributor's or a competitor's export.
 *
 * WHAT THESE FILES ARE ACTUALLY LIKE
 *
 * Not clean. A Pakistani distributor's price list is a spreadsheet somebody
 * maintains by hand; a competitor's export is whatever their software emits.
 * Between them you meet: BOM markers from Excel, CRLF line endings, quoted
 * fields containing commas, prices written "1,250.00" and "Rs 350/-", column
 * headers in a dozen spellings, blank rows, a totals row at the bottom, and the
 * same medicine on two lines because someone edited it twice.
 *
 * None of that is exceptional and none of it should stop an import. What must
 * never happen is a row being read WRONG — a price off by a hundred, a strength
 * misattributed — because a wrong row is invisible where a rejected row is not.
 * So every rule here fails a row rather than guessing at it, and the operator
 * sees exactly which lines could not be read and why.
 *
 * PURE, AND SEPARATE FROM APPLYING
 *
 * This module turns text into rows and says what is wrong with them. It never
 * writes. Phase 6 §3.3 asks for "review-before-commit", and the only way to
 * mean it is for the reading half to be a function that returns a plan.
 */

import { identityKey, type MedicineIdentity } from './identity';
import type { PackProduct } from './pack';
import { parseStrength } from './strength';
import { normaliseForm } from './form';

/* -------------------------------------------------------------------------- */
/* Splitting the text                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A CSV parser, because the alternative is a dependency for 40 lines.
 *
 * Handles RFC-4180 quoting (`"a,b"`, `""` for a literal quote), CRLF, and a
 * UTF-8 BOM. Deliberately does not handle exotic dialects: a file this cannot
 * split is a file the operator should re-export, and saying so is better than
 * a heuristic that half-works.
 */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  // Excel writes a BOM. Left in place it becomes part of the first header,
  // which then matches nothing and the whole file looks like it has no columns.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;

    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r') {
      field += character;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // A row of nothing but empty fields is a blank line, and every hand-kept
  // spreadsheet has them.
  return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
}

/* -------------------------------------------------------------------------- */
/* Working out which column is which                                           */
/* -------------------------------------------------------------------------- */

/** The fields an import can fill. Only `name` is required. */
export type ColumnRole =
  | 'name'
  | 'manufacturer'
  | 'formula'
  | 'form'
  | 'strength'
  | 'packSize'
  | 'mrp'
  | 'barcode';

/**
 * Header spellings seen in the wild, per role.
 *
 * Matched against a header that has been lowercased and stripped of
 * punctuation, so "Product Name", "PRODUCT_NAME" and "product-name" all reduce
 * to "product name" before they get here.
 */
const HEADER_HINTS: Record<ColumnRole, readonly string[]> = {
  name: ['name', 'product', 'product name', 'item', 'item name', 'brand', 'brand name', 'description'],
  manufacturer: ['manufacturer', 'company', 'maker', 'firm', 'supplier', 'mfg', 'mfr', 'principal'],
  formula: ['formula', 'salt', 'generic', 'generic name', 'composition', 'ingredients', 'molecule'],
  form: ['form', 'dosage form', 'type', 'pack type', 'presentation'],
  strength: ['strength', 'potency', 'dose', 'dosage', 'mg'],
  packSize: ['pack', 'pack size', 'packing', 'units per pack', 'qty per pack', 'pack qty'],
  mrp: ['mrp', 'price', 'retail price', 'rate', 'trade price', 'tp', 'max retail price'],
  barcode: ['barcode', 'bar code', 'ean', 'upc', 'gtin', 'code'],
};

export function normaliseHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Guesses the role of each column from its header.
 *
 * A guess, explicitly — the operator confirms it before anything is imported.
 * That is why this returns a mapping to be shown rather than applying one: a
 * mis-guessed column nobody was asked about is how a price column ends up in
 * the strength field.
 *
 * Scored across every (column, role) pair and assigned best-first, rather than
 * walking columns left to right and letting each take the first role it
 * matches. The difference shows in a file headed `Name, Code, Barcode`: "code"
 * is a listed spelling of barcode, so a left-to-right pass claims the role for
 * the wrong column and leaves the column literally headed "Barcode" unmapped.
 * Scoring lets the better match win wherever it happens to sit.
 */
export function inferColumns(headers: readonly string[]): (ColumnRole | null)[] {
  const cleaned = headers.map(normaliseHeader);

  /** 3 = the role's canonical name, 2 = a known spelling, 1 = a partial. */
  function score(header: string, role: ColumnRole): number {
    if (header === '') return 0;
    const hints = HEADER_HINTS[role];
    if (header === hints[0]) return 3;
    if (hints.includes(header)) return 2;
    return hints.some((hint) => header.includes(hint) || hint.includes(header)) ? 1 : 0;
  }

  const candidates: { index: number; role: ColumnRole; score: number }[] = [];
  for (const [index, header] of cleaned.entries()) {
    for (const role of Object.keys(HEADER_HINTS) as ColumnRole[]) {
      const value = score(header, role);
      if (value > 0) candidates.push({ index, role, score: value });
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.index - right.index);

  const assignment: (ColumnRole | null)[] = headers.map(() => null);
  const takenRoles = new Set<ColumnRole>();
  for (const candidate of candidates) {
    // Each column gets one role and each role one column, so a file carrying
    // both "Price" and "Trade Price" does not map both to MRP and quietly keep
    // whichever came last.
    if (assignment[candidate.index] !== null || takenRoles.has(candidate.role)) continue;
    assignment[candidate.index] = candidate.role;
    takenRoles.add(candidate.role);
  }

  return assignment;
}

/* -------------------------------------------------------------------------- */
/* Reading values                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Money, from whatever a spreadsheet put in the cell.
 *
 * Accepts "350", "350.00", "Rs 350", "1,250.50", "350/-". Returns integer
 * paisa, because money is integer paisa everywhere in this system (Phase 11 §2)
 * and a rupees-as-float import is a rounding error entering through the front
 * door.
 *
 * Returns null rather than 0 for anything unreadable. Zero is a real price —
 * it means "free" — and conflating it with "could not read this" would import
 * silence as a fact.
 */
export function parseMoneyCell(raw: string): number | null {
  const cleaned = raw
    .replace(/rs\.?/gi, '')
    .replace(/pkr/gi, '')
    .replace(/[,\s]/g, '')
    .replace(/\/-$/, '')
    .trim();
  if (cleaned === '') return null;
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(cleaned)) return null;

  // Two decimal places exactly; `Math.round` on the float would turn 350.07
  // into 35006 about one time in a thousand.
  const [rupees, fraction = ''] = cleaned.split('.');
  const paisaPart = `${fraction}00`.slice(0, 2);
  return Number(rupees) * 100 + Number(paisaPart);
}

/**
 * Pack size, from "10", "1x10", "10's", "strip of 10", "10 tab".
 *
 * Only the count is taken; naming the level is the operator's job because a
 * distributor's "pack" is a strip in one file and a box in the next, and
 * guessing wrong corrupts every stock figure that product ever has (Phase 5 §2).
 */
export function parsePackSizeCell(raw: string): number | null {
  const cleaned = raw.toLowerCase().trim();
  if (cleaned === '') return null;

  // "1x10" and "2 x 15" — the last factor is the units per pack.
  const cross = /(\d+)\s*[x×]\s*(\d+)/.exec(cleaned);
  if (cross) {
    const value = Number(cross[2]);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  const digits = /(\d+)/.exec(cleaned);
  if (!digits) return null;
  const value = Number(digits[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Turning rows into a reviewable plan                                         */
/* -------------------------------------------------------------------------- */

export type RowProblem =
  | 'no-name'
  | 'unreadable-price'
  | 'unreadable-pack-size'
  | 'duplicate-in-file';

export interface ParsedRow {
  /** 1-based, counting the header — the number the operator sees in Excel. */
  readonly line: number;
  readonly name: string;
  readonly manufacturer: string | null;
  readonly formulaText: string | null;
  readonly form: string | null;
  readonly strength: string | null;
  readonly packSize: number | null;
  readonly mrpPaisa: number | null;
  readonly barcode: string | null;
  readonly identityKey: string;
  /** Why this row cannot be imported. Empty means it can. */
  readonly problems: readonly RowProblem[];
  /** True when the strength was read and understood, so it can be shown back. */
  readonly strengthParsed: boolean;
}

export interface ParsedCsv {
  readonly headers: readonly string[];
  readonly columns: readonly (ColumnRole | null)[];
  readonly rows: readonly ParsedRow[];
  readonly usableCount: number;
}

/** I5 — what to do about it, not what rule was broken. */
export function describeRowProblem(problem: RowProblem): string {
  switch (problem) {
    case 'no-name':
      return 'No medicine name in this row.';
    case 'unreadable-price':
      return 'The price could not be read.';
    case 'unreadable-pack-size':
      return 'The pack size could not be read.';
    case 'duplicate-in-file':
      return 'The same medicine appears earlier in this file.';
  }
}

/**
 * Reads the whole file against a column mapping.
 *
 * Never throws and never drops a row silently: a row that cannot be imported
 * comes back carrying its problems, so the review screen can show it greyed out
 * with a reason rather than leaving the operator to wonder why 400 rows became
 * 380.
 */
export function parseCatalogCsv(
  text: string,
  columnOverrides?: readonly (ColumnRole | null)[],
): ParsedCsv {
  const grid = splitCsv(text);
  if (grid.length === 0) {
    return { headers: [], columns: [], rows: [], usableCount: 0 };
  }

  const headers = grid[0]!;
  const columns = columnOverrides ?? inferColumns(headers);

  const roleAt = (role: ColumnRole): number => columns.indexOf(role);
  const nameAt = roleAt('name');

  const seen = new Set<string>();
  const rows: ParsedRow[] = [];

  for (const [offset, cells] of grid.slice(1).entries()) {
    const cell = (role: ColumnRole): string => {
      const index = roleAt(role);
      return index >= 0 ? (cells[index] ?? '').trim() : '';
    };

    const name = nameAt >= 0 ? (cells[nameAt] ?? '').trim() : '';
    const problems: RowProblem[] = [];
    if (name === '') problems.push('no-name');

    const mrpRaw = cell('mrp');
    const mrpPaisa = mrpRaw === '' ? null : parseMoneyCell(mrpRaw);
    if (mrpRaw !== '' && mrpPaisa === null) problems.push('unreadable-price');

    const packRaw = cell('packSize');
    const packSize = packRaw === '' ? null : parsePackSizeCell(packRaw);
    if (packRaw !== '' && packSize === null) problems.push('unreadable-pack-size');

    const identity: MedicineIdentity = {
      name,
      manufacturer: cell('manufacturer') || null,
      formulaText: cell('formula') || null,
      form: normaliseForm(cell('form') || null),
      strength: cell('strength') || null,
    };
    const key = identityKey(identity);

    /*
     * A file listing one medicine twice is normal — somebody edited a row and
     * added another instead of replacing it. The first wins and the second is
     * flagged, rather than the importer quietly keeping the last, because
     * "which one did it take?" is a question nobody should have to ask.
     */
    if (name !== '' && seen.has(key)) {
      problems.push('duplicate-in-file');
    } else if (name !== '') {
      seen.add(key);
    }

    rows.push({
      line: offset + 2,
      name,
      manufacturer: identity.manufacturer ?? null,
      formulaText: identity.formulaText ?? null,
      form: identity.form ?? null,
      strength: identity.strength ?? null,
      packSize,
      mrpPaisa,
      barcode: cell('barcode') || null,
      identityKey: key,
      problems,
      strengthParsed: parseStrength(identity.strength) !== null,
    });
  }

  return {
    headers,
    columns,
    rows,
    usableCount: rows.filter((row) => row.problems.length === 0).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Becoming a pack                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Turns reviewed rows into pack products.
 *
 * A CSV import does NOT get its own way of writing the global catalogue. It
 * becomes a pack and goes through `applyCatalogPack` like everything else, so
 * there is exactly one writer, one idempotency rule and one place where the
 * identity-only boundary is enforced. A second write path would be a second set
 * of these guarantees to keep in step, and they would drift.
 *
 * Rows carrying problems are excluded — this is the "commit" half of
 * review-before-commit, and by the time it runs the operator has seen what was
 * dropped.
 *
 * Everything imported this way is `reference` quality, never `verified`.
 * Verified means somebody checked the pack structure against a real box
 * (Phase 6 §5); a spreadsheet from a distributor has not been checked by
 * anyone, and laundering it into the tier the catalogue's trustworthiness rests
 * on would quietly destroy the distinction.
 */
export function rowsToPackProducts(
  rows: readonly ParsedRow[],
  options: { readonly packLevelName?: string } = {},
): PackProduct[] {
  const levelName = options.packLevelName ?? 'pack';

  return rows
    .filter((row) => row.problems.length === 0)
    .map((row) => {
      const barcodes =
        row.barcode && /^[0-9]{6,14}$/.test(row.barcode)
          ? [{ barcode: row.barcode, unitLevelName: 'unit' }]
          : [];

      return {
        name: row.name,
        manufacturer: row.manufacturer,
        formulaText: row.formulaText,
        form: row.form,
        strength: row.strength,
        /*
         * A pack size becomes a level above a nameless base unit.
         *
         * The base unit is called "unit" rather than guessed at, because a
         * distributor's "pack of 10" does not say whether those are tablets,
         * capsules or sachets — and a wrong base unit name is visible to the
         * operator, where a wrong FACTOR would silently corrupt stock
         * arithmetic (Phase 5 §2). Naming it properly is a completion job.
         */
        packLevels:
          row.packSize === null
            ? []
            : [
                { name: 'unit', factor: 1 },
                { name: levelName, factor: row.packSize },
              ],
        referenceMrpPaisa: row.mrpPaisa,
        quality: 'reference' as const,
        ...(barcodes.length > 0 ? { barcodes } : {}),
      };
    });
}

/* -------------------------------------------------------------------------- */
/* Correcting the guess                                                        */
/* -------------------------------------------------------------------------- */

export const COLUMN_ROLES: readonly ColumnRole[] = [
  'name',
  'manufacturer',
  'formula',
  'form',
  'strength',
  'packSize',
  'mrp',
  'barcode',
];

export type MapOverrideResult =
  | { readonly ok: true; readonly columns: (ColumnRole | null)[] }
  | { readonly ok: false; readonly message: string };

/**
 * Applies an operator's corrections to the guessed column mapping.
 *
 * `"0=name,3=mrp"`, or `"4=none"` to ignore a column. Only the columns named
 * are changed, so fixing one wrong guess does not mean restating all eight.
 *
 * Claiming a role RELEASES it from wherever it was: a role belongs to one
 * column, and silently ending up with two MRP columns would mean one of them
 * quietly winning. Pure and separately tested because a mis-mapped column is
 * how a price ends up in the strength field, which is invisible afterwards.
 */
export function applyColumnOverrides(
  guessed: readonly (ColumnRole | null)[],
  spec: string,
): MapOverrideResult {
  const columns = [...guessed];
  const trimmed = spec.trim();
  if (trimmed === '') return { ok: true, columns };

  for (const pair of trimmed.split(',')) {
    const [rawIndex, rawRole] = pair.split('=');
    const index = Number((rawIndex ?? '').trim());
    const role = (rawRole ?? '').trim();

    if (!Number.isInteger(index) || index < 0 || index >= columns.length) {
      return {
        ok: false,
        message: `There is no column ${String(rawIndex).trim()} — this file has ${columns.length}.`,
      };
    }
    if (role !== 'none' && !COLUMN_ROLES.includes(role as ColumnRole)) {
      return {
        ok: false,
        message: `"${role}" is not one of: ${COLUMN_ROLES.join(', ')}, none.`,
      };
    }

    if (role === 'none') {
      columns[index] = null;
      continue;
    }
    const previous = columns.indexOf(role as ColumnRole);
    if (previous >= 0) columns[previous] = null;
    columns[index] = role as ColumnRole;
  }

  return { ok: true, columns };
}
