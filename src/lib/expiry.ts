/**
 * Expiry as a pack prints it — PCN-017.
 *
 * Packs print a month and a year ("EXP 03/2028"), never a day, so an expiry is
 * typed as `MM/YY` or `MM/YYYY` and stored as the LAST day of that month:
 * "good through the end of the month". That is GS1's own reading of a day of
 * `00` (`domain/catalog/barcode.ts`), so a typed pack and a scanned one agree.
 *
 * This is the only place typed text becomes an expiry date. Rows stored before
 * PCN-017 keep their dates (ADR-1); `formatExpiry` reads them the same way.
 */

/** `YYYY-MM-DD`, the stored shape. */
export type ExpiryDate = string;

/**
 * `MM/YY`, `MM/YYYY` (also `M/YY`, with `-`, `.` or a space for the slash), or
 * four bare digits `MMYY` — a phone's number pad has no slash. Returns the last
 * day of that month, or null when the text is not a month and year. Empty text
 * is null too; the caller says whether an expiry was required.
 */
export function parseExpiryInput(text: string): ExpiryDate | null {
  const trimmed = text.trim();
  const match =
    /^(\d{1,2})\s*[/.\- ]\s*(\d{2}|\d{4})$/.exec(trimmed) ?? /^(\d{2})(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const month = Number(match[1]);
  const yearText = match[2]!;
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  if (month < 1 || month > 12 || year < 2000 || year > 2099) {
    return null;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/** A stored expiry, read as `MM/YYYY` everywhere (PCN-017). */
export function formatExpiry(date: ExpiryDate): string {
  const [year, month] = date.split('-');
  return year && month ? `${month}/${year}` : date;
}
