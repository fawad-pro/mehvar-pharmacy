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

/**
 * What a GS1 element string says, field by field.
 *
 * Only the GTIN identifies the product (`barcodeKeys` and `barcodeToStore`
 * use it alone). The other fields describe the one pack in the operator's
 * hand: when it expires, which batch it came from. Receive Stock fills a
 * line's batch and expiry from them, and the counter warns on an expired
 * pack; neither changes what the code IS.
 */
export interface Gs1Fields {
  /** AI 01 — the GTIN-14, check digit validated. */
  readonly gtin: string;
  /** AI 17 — expiry date, ISO `YYYY-MM-DD`. */
  readonly expiry: string | null;
  /** AI 11 — production date, ISO `YYYY-MM-DD`. */
  readonly productionDate: string | null;
  /** AI 10 — batch or lot number. */
  readonly batch: string | null;
  /** AI 21 — serial number. */
  readonly serial: string | null;
}

/** Fixed-length AIs this parser reads, by data length. 15 (best before) is skipped. */
const FIXED_AIS: Readonly<Record<string, number>> = { '01': 14, '11': 6, '15': 6, '17': 6 };
/** Variable-length AIs, up to 20 characters, ended by GS or the end of the code. */
const VARIABLE_AIS = new Set(['10', '21']);
const VARIABLE_MAX = 20;
const GS = '\u001d';

/**
 * YYMMDD → `YYYY-MM-DD`, or null if it is not a date. The century is 20YY:
 * medicine dates sit within a few years of today. A day of `00` means the
 * last day of that month — GS1's own rule for packs that print month and year.
 */
function gs1Date(yymmdd: string): string | null {
  if (!/^\d{6}$/.test(yymmdd)) {
    return null;
  }
  const year = 2000 + Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = yymmdd.slice(4, 6) === '00' ? lastDay : Number(yymmdd.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > lastDay) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The raw AI → value pairs, from the human-readable `(01)…` form. */
function bracketedPairs(code: string): Array<[string, string]> | null {
  const pairs: Array<[string, string]> = [];
  const pattern = /\((\d{2})\)([^()]*)/gy;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = pattern.exec(code)) !== null) {
    pairs.push([match[1]!, match[2]!.replace(/[\s\u001d]/g, '')]);
    consumed = pattern.lastIndex;
  }
  return consumed === code.length && pairs.length > 0 ? pairs : null;
}

/**
 * The raw AI → value pairs, from the string a scanner types.
 *
 * A variable-length field (batch, serial) ends at GS. A scanner that is not set
 * to send GS drops it, and then the field can only run to the end of the code:
 * GS1 puts variable fields last for exactly this reason, and the packs seen at
 * the pilot do (`01…17…10<batch>`). A pack printing batch THEN serial, read by
 * such a scanner, joins the two into one value that no parser can split; it is
 * refused only when it is longer than a batch can be. Reading it right needs the
 * scanner to transmit GS.
 */
function scannedPairs(code: string): Array<[string, string]> | null {
  const pairs: Array<[string, string]> = [];
  let at = 0;
  while (at < code.length) {
    if (code[at] === GS) {
      at += 1;
      continue;
    }
    const ai = code.slice(at, at + 2);
    const fixed = FIXED_AIS[ai];
    if (fixed !== undefined) {
      const value = code.slice(at + 2, at + 2 + fixed);
      if (value.length !== fixed) {
        return pairs.length > 0 ? pairs : null;
      }
      pairs.push([ai, value]);
      at += 2 + fixed;
    } else if (VARIABLE_AIS.has(ai)) {
      const end = code.indexOf(GS, at + 2);
      const value = code.slice(at + 2, end === -1 ? code.length : end);
      if (value.length === 0 || value.length > VARIABLE_MAX) {
        // Not a batch or serial as GS1 defines one: stop rather than guess.
        return pairs.length > 0 ? pairs : null;
      }
      pairs.push([ai, value]);
      at = end === -1 ? code.length : end + 1;
    } else {
      // An AI this parser does not read: what came before it is still good.
      return pairs.length > 0 ? pairs : null;
    }
  }
  return pairs;
}

/**
 * Splits a GS1 element string into its fields, or returns null when the code
 * is not one: it must start with a GTIN (AI 01) whose check digit is valid,
 * exactly the test `gtinFromElementString` applies. A plain EAN, an internal
 * code or a typed name is never a GS1 string.
 */
export function parseGs1(raw: string): Gs1Fields | null {
  const framed = raw.trim().replace(/^\][A-Za-z][0-9A-Za-z]/, '');
  const pairs = framed.startsWith('(')
    ? bracketedPairs(framed.replace(/\s/g, ''))
    : scannedPairs(framed.replace(/[^\S\u001d]/g, ''));
  const first = pairs?.[0];
  if (!pairs || !first || first[0] !== '01' || !hasValidCheckDigit(first[1])) {
    return null;
  }
  const value = (ai: string): string | null => pairs.find(([key]) => key === ai)?.[1] ?? null;
  const date = (ai: string): string | null => {
    const found = value(ai);
    return found === null ? null : gs1Date(found);
  };
  return {
    gtin: first[1],
    expiry: date('17'),
    productionDate: date('11'),
    batch: value('10'),
    serial: value('21'),
  };
}
