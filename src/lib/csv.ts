/**
 * CSV serialization — Phase 9 §8's export. "No format cleverness": RFC 4180
 * quoting and nothing else — no locale-aware number formatting, no date
 * reformatting. A cell is quoted whenever it contains a comma, a quote, or a
 * newline; a quote inside a quoted cell doubles, per the spec.
 */

function cell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** All rows must share the same columns; the header comes from the first row's keys. */
export function toCsv(rows: ReadonlyArray<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return '';
  }
  const columns = Object.keys(rows[0]!);
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => cell(row[column])).join(','));
  }
  return lines.join('\r\n');
}
