/**
 * What a scanned code identifies — pure, shared by the counter and the server.
 *
 * A keyboard-wedge scanner types whatever the symbol holds (I1). For a 1D
 * barcode that is a run of digits. For the 2D GS1 DataMatrix printed on
 * medicine packs it is an element string: `01` + a 14-digit GTIN, then fields
 * such as `17` (expiry) and `10` (batch), e.g.
 *
 *     01 08002660031693 17 280531 10 892302XV
 *
 * Only the GTIN identifies the product; expiry and batch change with every
 * delivery. Matching the whole string would find a product only for the one
 * batch it was linked from.
 *
 * Equivalence is deliberately narrow. A GTIN-13 (the EAN under a box's 1D
 * barcode) and the GTIN-14 formed by prefixing a single `0` are the same item
 * by GS1's own definition. A GTIN-14 with indicator digit 1–9 is a different
 * packaging level (a case of boxes) and is never folded into the item's code.
 * Nothing else is normalised: a code that is not a valid GTIN is matched
 * exactly as typed.
 */

/** GS1's mod-10 check digit, over every digit but the last. */
function hasValidCheckDigit(digits: string): boolean {
  if (!/^\d{8,14}$/.test(digits)) {
    return false;
  }
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    // Weights alternate 3, 1, … counting from the rightmost body digit.
    const weight = (body.length - i) % 2 === 1 ? 3 : 1;
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/**
 * Removes what the scanner adds around the data: surrounding whitespace, the
 * optional AIM symbology prefix (`]d2` for DataMatrix, `]C1` for GS1-128,
 * `]Q3` for QR, `]E0` for EAN), and the GS separator (0x1D) that ends a
 * variable-length GS1 field. Scanners configured to send GS deliver it as a
 * control character; one that is not configured drops it, which is fine,
 * because the GTIN is always the fixed-length first field.
 */
export function cleanScannedCode(raw: string): string {
  return raw
    .trim()
    .replace(/^\][A-Za-z][0-9A-Za-z]/, '')
    .replace(/[\s\u001d]/g, '');
}

/**
 * The GTIN-14 in a GS1 element string, or null if the code is not one.
 *
 * Accepts the machine form (`01…`) and the human-readable form printed under
 * the symbol (`(01)…`). The check digit must be valid, so an internal code
 * that merely starts with `01` is not mistaken for a pack.
 */
export function gtinFromElementString(raw: string): string | null {
  const code = cleanScannedCode(raw);
  const match = /^(?:\(01\)|01)(\d{14})/.exec(code);
  const gtin = match?.[1];
  return gtin !== undefined && hasValidCheckDigit(gtin) ? gtin : null;
}

/**
 * Every key a code may be found under, most specific first.
 *
 *  - the code as scanned, cleaned — so any code saved exactly as scanned
 *    (including a full 2D string saved before this module existed) still
 *    matches itself;
 *  - the GTIN-14, when the code is a GS1 element string or a bare GTIN-14;
 *  - the GTIN-13 ⇄ `0`-prefixed GTIN-14 pair, for a valid GTIN only.
 */
export function barcodeKeys(raw: string): string[] {
  const cleaned = cleanScannedCode(raw);
  const keys = new Set<string>([cleaned]);

  const gtin14 =
    gtinFromElementString(cleaned) ??
    (/^\d{14}$/.test(cleaned) && hasValidCheckDigit(cleaned) ? cleaned : null);
  if (gtin14) {
    keys.add(gtin14);
    if (gtin14.startsWith('0')) {
      keys.add(gtin14.slice(1));
    }
  }
  if (/^\d{13}$/.test(cleaned) && hasValidCheckDigit(cleaned)) {
    keys.add(`0${cleaned}`);
  }
  return [...keys].filter((key) => key !== '');
}

/**
 * What to save when a code is linked to a product: the GTIN for a GS1 element
 * string (the batch and expiry are not the product's identity), otherwise the
 * cleaned code as scanned. Codes already saved are never rewritten.
 */
export function barcodeToStore(raw: string): string {
  return gtinFromElementString(raw) ?? cleanScannedCode(raw);
}

/**
 * Does this look like something a scanner produced, rather than a name being
 * typed? A GS1 element string, or a run of six or more digits. Used to decide
 * that an unmatched entry is an unknown CODE (link it, or add a product by
 * name) rather than an unknown NAME (add it as typed).
 */
export function looksLikeScannedCode(raw: string): boolean {
  const cleaned = cleanScannedCode(raw);
  return gtinFromElementString(cleaned) !== null || /^\d{6,}$/.test(cleaned);
}
