/**
 * Dosage form — the word on the box, normalised to the word a pharmacist uses.
 *
 * Form matters for identity as much as strength does. "Augmentin 625 tablet"
 * and "Augmentin 156 syrup" are different products in every way that counts,
 * and two entries whose only difference is `tab` versus `Tablet` are one
 * product entered twice.
 *
 * The vocabulary below is deliberately SHORT. It is not an attempt to enumerate
 * pharmaceutical dosage forms — that list runs to hundreds and most of it never
 * reaches a retail counter. It covers what a Pakistani retail pharmacy actually
 * stocks, and anything outside it is kept verbatim rather than forced into a
 * bucket. An unrecognised form is not an error; it is a form we have not met.
 *
 * WHAT IS DELIBERATELY *NOT* MERGED
 *
 * Syrup and suspension are kept apart, as are cream and ointment. They look
 * like synonyms and are not: a suspension needs shaking and settles, an
 * ointment is greasy where a cream is not, and a customer handed the wrong one
 * has been handed the wrong thing. Merging them would make the catalog tidier
 * and the shop worse.
 */

/** The canonical forms. Ordered as a pharmacist would list them. */
export const CANONICAL_FORMS = [
  'tablet',
  'capsule',
  'syrup',
  'suspension',
  'drops',
  'injection',
  'infusion',
  'cream',
  'ointment',
  'gel',
  'lotion',
  'inhaler',
  'sachet',
  'suppository',
  'spray',
  'solution',
  'powder',
  'patch',
] as const;

export type CanonicalForm = (typeof CANONICAL_FORMS)[number];

/**
 * Spellings seen on real packs, invoices and competitor exports.
 *
 * Plural and full-stop variants are handled mechanically before lookup, so this
 * table only carries genuine abbreviations and alternative words.
 */
const SYNONYMS: Record<string, CanonicalForm> = {
  tab: 'tablet',
  tabs: 'tablet',
  tablets: 'tablet',
  'f.c tablet': 'tablet',
  'fc tablet': 'tablet',
  'film coated tablet': 'tablet',
  'coated tablet': 'tablet',
  'dispersible tablet': 'tablet',
  'chewable tablet': 'tablet',

  cap: 'capsule',
  caps: 'capsule',
  capsules: 'capsule',

  syp: 'syrup',
  syrups: 'syrup',

  susp: 'suspension',
  suspensions: 'suspension',
  'dry suspension': 'suspension',
  'oral suspension': 'suspension',

  drop: 'drops',
  'eye drops': 'drops',
  'ear drops': 'drops',
  'nasal drops': 'drops',

  inj: 'injection',
  injections: 'injection',
  amp: 'injection',
  ampoule: 'injection',
  ampoules: 'injection',
  vial: 'injection',
  vials: 'injection',

  iv: 'infusion',
  'i.v': 'infusion',
  'iv infusion': 'infusion',
  drip: 'infusion',

  creams: 'cream',
  oint: 'ointment',
  ointments: 'ointment',
  gels: 'gel',
  lotions: 'lotion',

  inhalers: 'inhaler',
  puff: 'inhaler',
  'metered dose inhaler': 'inhaler',
  mdi: 'inhaler',

  sachets: 'sachet',
  powders: 'powder',
  supp: 'suppository',
  suppositories: 'suppository',
  sprays: 'spray',
  solutions: 'solution',
  patches: 'patch',
};

const CANONICAL_SET = new Set<string>(CANONICAL_FORMS);

/**
 * Reduces a form label to its canonical word, or returns the cleaned-up
 * original when it is not one we know.
 *
 * Never returns null for a non-empty input: an unknown form still has to
 * participate in identity comparison, and comparing two unknown forms as
 * cleaned text is exactly right.
 */
export function normaliseForm(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const cleaned = raw
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned === '') return null;
  if (CANONICAL_SET.has(cleaned)) return cleaned;

  const synonym = SYNONYMS[cleaned];
  if (synonym) return synonym;

  // A trailing plural is the commonest unlisted variant; try it before giving
  // up so the table does not have to carry every "-s".
  if (cleaned.endsWith('s')) {
    const singular = cleaned.slice(0, -1);
    if (CANONICAL_SET.has(singular)) return singular;
    const singularSynonym = SYNONYMS[singular];
    if (singularSynonym) return singularSynonym;
  }

  /*
   * Kept as written rather than bucketed.
   *
   * The alternative — mapping anything containing "tab" to tablet — would fold
   * "tablet for oral suspension" into plain tablets, which is a different
   * product. An unrecognised form comparing only against itself is correct
   * behaviour, and it shows up in the catalog as an odd word somebody can fix.
   */
  return cleaned;
}

/** True when the label was recognised, for surfaces that want to say so. */
export function isCanonicalForm(value: string | null): value is CanonicalForm {
  return value !== null && CANONICAL_SET.has(value);
}

/** Title-cased for display: "tablet" → "Tablet". */
export function formatForm(value: string | null): string | null {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
