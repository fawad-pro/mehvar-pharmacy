/**
 * The starter catalogue body — Pakistan's common pharmacy shelf, as data.
 *
 * WHAT THIS FILE IS
 *
 * `seed-data.ts` is the hand-checked *head* (~150 verified fast movers, with
 * real pack structures and reference MRPs). This file is the *body* Phase 6 §3.1
 * calls for: broad identity coverage of the medicines a Pakistani independent
 * pharmacy actually stocks, so a shop that installs Mehvar can search for
 * familiar brands and salts on day one instead of typing thousands of products
 * by hand. Together they answer the question the catalogue exists to answer —
 * "does Mehvar already know my shop?" — with yes.
 *
 * HOW IT IS ORGANISED
 *
 * Each molecule is stated once: its therapeutic category, the forms and
 * strengths it is genuinely sold in, and the real Pakistani brands that sell it.
 * `expandStarter` (domain/catalog/starter.ts) multiplies those into individual
 * sellable SKUs and removes duplicates. Writing it this way keeps the facts
 * checkable — one strength stated once, not copied across fifty rows — and keeps
 * the file maintainable as brands come and go.
 *
 * THE HONESTY RULES THIS FILE KEEPS (Phase 6 §5)
 *
 *  - Everything here is `reference` quality. The brand↔molecule pairing and the
 *    strengths are drawn from the registered Pakistani market; the exact strip
 *    and box counts were not individually inspected the way the verified head's
 *    were, so pack structure above the base unit is left for the pharmacy to set
 *    when it receives stock (W7). A strip-of-10 guessed for every product would
 *    be false pack data, and false is worse than absent.
 *  - No barcodes. Barcodes are earned from real scans (Phase 6 §4), never
 *    derived from a name.
 *  - No prices. D4 — the pack in hand is authoritative; the shop enters its own.
 *  - No invented manufacturers. Where a maker is known it is named; where it is
 *    not, it is left absent (and `includeGeneric` adds a salt-named entry, which
 *    is always true), rather than guessed.
 *
 * Nothing here is a price list, a stock list, or tenant data. It is shared
 * identity, distributable to every pharmacy precisely because it belongs to none
 * of them (T3).
 */

import type {
  StarterBrand,
  StarterItem,
  StarterMolecule,
  StarterPresentation,
  StarterSource,
} from '../../src/domain/catalog/starter';

/* -------------------------------------------------------------------------- */
/* Therapeutic categories — the twelve priority areas plus common adjacencies  */
/* -------------------------------------------------------------------------- */

const CAT = {
  pain: 'Pain & Fever',
  antibiotics: 'Antibiotics & Anti-infectives',
  diabetes: 'Diabetes',
  cardio: 'Hypertension & Cardiovascular',
  gastro: 'Gastrointestinal',
  allergy: 'Allergy',
  respiratory: 'Asthma & COPD',
  vitamins: 'Vitamins & Minerals',
  derma: 'Dermatology',
  eyeear: 'Eye & Ear',
  womens: "Women's Health",
  pediatrics: 'Pediatrics',
  cns: 'CNS & Psychiatry',
  urology: 'Urology & Nephrology',
  hormones: 'Hormones & Thyroid',
  otc: 'OTC & General',
  supplies: 'Consumables & Devices',
} as const;

/* -------------------------------------------------------------------------- */
/* Presentation + brand builders — keep the molecule tables readable           */
/* -------------------------------------------------------------------------- */

type S = string | null;

const tab = (...strengths: S[]): StarterPresentation => ({
  form: 'Tablet',
  baseUnit: 'tab',
  strengths,
});
const cap = (...strengths: S[]): StarterPresentation => ({
  form: 'Capsule',
  baseUnit: 'cap',
  strengths,
});
const syr = (...strengths: S[]): StarterPresentation => ({
  form: 'Syrup',
  baseUnit: 'bottle',
  strengths,
});
const susp = (...strengths: S[]): StarterPresentation => ({
  form: 'Suspension',
  baseUnit: 'bottle',
  strengths,
});
const inj = (...strengths: S[]): StarterPresentation => ({
  form: 'Injection',
  baseUnit: 'vial',
  strengths,
});
const infusion = (...strengths: S[]): StarterPresentation => ({
  form: 'Infusion',
  baseUnit: 'bottle',
  strengths,
});
const drops = (...strengths: S[]): StarterPresentation => ({
  form: 'Drops',
  baseUnit: 'bottle',
  strengths,
});
const eyeDrops = (...strengths: S[]): StarterPresentation => ({
  form: 'Drops',
  baseUnit: 'bottle',
  strengths,
});
const cream = (...strengths: S[]): StarterPresentation => ({
  form: 'Cream',
  baseUnit: 'tube',
  strengths,
});
const oint = (...strengths: S[]): StarterPresentation => ({
  form: 'Ointment',
  baseUnit: 'tube',
  strengths,
});
const gel = (...strengths: S[]): StarterPresentation => ({
  form: 'Gel',
  baseUnit: 'tube',
  strengths,
});
const lotion = (...strengths: S[]): StarterPresentation => ({
  form: 'Lotion',
  baseUnit: 'bottle',
  strengths,
});
const sachet = (...strengths: S[]): StarterPresentation => ({
  form: 'Sachet',
  baseUnit: 'sachet',
  strengths,
});
const inhaler = (...strengths: S[]): StarterPresentation => ({
  form: 'Inhaler',
  baseUnit: 'inhaler',
  strengths,
});
const spray = (...strengths: S[]): StarterPresentation => ({
  form: 'Spray',
  baseUnit: 'bottle',
  strengths,
});
const supp = (...strengths: S[]): StarterPresentation => ({
  form: 'Suppository',
  baseUnit: 'suppository',
  strengths,
});

/** A brand and, where known, its maker and the presentation keys it ships. */
const b = (name: string, manufacturer?: string, forms?: string[]): StarterBrand => ({
  name,
  ...(manufacturer ? { manufacturer } : {}),
  ...(forms ? { forms } : {}),
});

/* ========================================================================== */
/* MOLECULES                                                                   */
/* ========================================================================== */

const MOLECULES: StarterMolecule[] = [
  /* ---------------------------------------------------------------------- */
  /* 1. PAIN & FEVER                                                         */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Paracetamol',
    category: CAT.pain,
    includeGeneric: true,
    presentations: {
      tab: tab('500mg', '650mg'),
      susp: susp('120mg/5ml', '250mg/5ml'),
      drops: drops('80mg/ml'),
      inf: infusion('1000mg/100ml'),
      supp: supp('125mg', '250mg'),
    },
    brands: [
      b('Panadol', 'GSK', ['tab']),
      b('Calpol', 'GSK', ['susp', 'drops']),
      b('Disprol', 'Reckitt Benckiser', ['tab', 'susp']),
      b('Febrol', 'Salman', ['susp', 'drops']),
      b('Provas', 'Genix Pharma', ['inf']),
      b('Paracen', 'English Pharma', ['tab', 'susp']),
      b('Acamol', 'Wilshire', ['tab']),
      b('Pyrigesic', 'Wilshire', ['tab', 'susp']),
      b('Temp', 'Hilton', ['susp', 'drops']),
      b('Fevago', 'Herbion', ['susp']),
    ],
  },
  {
    generic: 'Ibuprofen',
    category: CAT.pain,
    includeGeneric: true,
    presentations: {
      tab: tab('200mg', '400mg', '600mg'),
      susp: susp('100mg/5ml'),
    },
    brands: [
      b('Brufen', 'Abbott', ['tab', 'susp']),
      b('Ibrufen', 'Global Pharma', ['tab']),
      b('Ratigesic', 'Rati Pharma', ['tab']),
      b('Rofen', 'Wilshire', ['tab', 'susp']),
      b('Perfen', 'English Pharma', ['tab']),
      b('Inflam', 'Bosch', ['tab']),
    ],
  },
  {
    generic: 'Diclofenac Sodium',
    category: CAT.pain,
    includeGeneric: true,
    presentations: {
      tab: tab('50mg', '75mg', '100mg'),
      inj: inj('75mg/3ml'),
      gel: gel('1%'),
      supp: supp('50mg', '100mg'),
    },
    brands: [
      b('Voltral', 'Novartis', ['tab', 'inj', 'gel', 'supp']),
      b('Dicloran', 'Sami', ['tab', 'inj', 'gel']),
      b('Artifen', 'Wilshire', ['tab', 'inj']),
      b('Dyclo', 'Global Pharma', ['tab', 'inj']),
      b('Caflam', 'Novartis', ['tab']),
      b('Nidol', 'Genix Pharma', ['tab', 'gel']),
    ],
  },
  {
    generic: 'Diclofenac Potassium',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('50mg') },
    brands: [b('Cataflam', 'Novartis'), b('Instaflam', 'Hilton'), b('Difnal', 'Genix Pharma')],
  },
  {
    generic: 'Aspirin',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('75mg', '150mg', '300mg') },
    brands: [
      b('Disprin', 'Reckitt Benckiser'),
      b('Ascard', 'Atco', ['tab']),
      b('Loprin', 'Highnoon', ['tab']),
      b('Cardiprin', 'Reckitt Benckiser'),
      b('Ecosprin', 'Wilshire'),
    ],
  },
  {
    generic: 'Mefenamic Acid',
    category: CAT.pain,
    includeGeneric: true,
    presentations: {
      tab: tab('250mg', '500mg'),
      susp: susp('50mg/5ml'),
    },
    brands: [
      b('Ponstan', 'Pfizer', ['tab', 'susp']),
      b('Mefnac', 'Sami', ['tab']),
      b('Dolfen', 'Barrett Hodgson', ['tab', 'susp']),
      b('Meflam', 'Wilshire', ['tab']),
    ],
  },
  {
    generic: 'Naproxen',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('250mg', '500mg') },
    brands: [
      b('Synflex', 'Sanofi'),
      b('Naprosyn', 'Atco'),
      b('Xenobid', 'Wilshire'),
      b('Napa', 'Pharmedic'),
    ],
  },
  {
    generic: 'Nimesulide',
    category: CAT.pain,
    includeGeneric: true,
    presentations: {
      tab: tab('100mg'),
      susp: susp('50mg/5ml'),
    },
    brands: [
      b('Nims', 'Sami', ['tab', 'susp']),
      b('Nimesa', 'Aventis'),
      b('Pyrafen', 'Wilshire', ['tab']),
    ],
  },
  {
    generic: 'Ketoprofen',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { cap: cap('50mg', '100mg'), inj: inj('100mg/2ml') },
    brands: [b('Profenid', 'Sanofi'), b('Ketofen', 'Wilshire')],
  },
  {
    generic: 'Ketorolac',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('10mg'), inj: inj('30mg/ml') },
    brands: [b('Toradol', 'Roche', ['tab', 'inj']), b('Toranate', 'Genix Pharma', ['inj'])],
  },
  {
    generic: 'Tramadol',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { cap: cap('50mg'), inj: inj('100mg/2ml') },
    brands: [
      b('Tramal', 'Searle', ['cap', 'inj']),
      b('Kinz', 'Sami', ['cap', 'inj']),
      b('Tonoflex', 'Sami', ['cap', 'inj']),
    ],
  },
  {
    generic: 'Etoricoxib',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('60mg', '90mg', '120mg') },
    brands: [
      b('Arcoxia', 'MSD'),
      b('Etori', 'Hilton'),
      b('Oxib', 'Wilshire'),
      b('Zeetec', 'Getz Pharma'),
    ],
  },
  {
    generic: 'Celecoxib',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { cap: cap('100mg', '200mg') },
    brands: [b('Celebrex', 'Pfizer'), b('Celbex', 'Hilton'), b('Artiz', 'Wilshire')],
  },
  {
    generic: 'Meloxicam',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('7.5mg', '15mg') },
    brands: [b('Mobic', 'Boehringer Ingelheim'), b('Meloxin', 'Genix Pharma')],
  },
  {
    generic: 'Piroxicam',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { cap: cap('20mg'), gel: gel('0.5%') },
    brands: [b('Feldene', 'Pfizer', ['cap', 'gel']), b('Pirox', 'Wilshire', ['cap'])],
  },
  {
    generic: 'Paracetamol + Orphenadrine',
    category: CAT.pain,
    presentations: { tab: tab('450mg+35mg') },
    brands: [b('Nuberol', 'Searle'), b('Norgesic', 'Searle')],
  },
  {
    generic: 'Paracetamol + Tramadol',
    category: CAT.pain,
    presentations: { tab: tab('325mg+37.5mg') },
    brands: [b('Tonoflex-P', 'Sami'), b('Sigmol', 'Hilton')],
  },
  {
    generic: 'Paracetamol + Caffeine',
    category: CAT.pain,
    presentations: { tab: tab('500mg+65mg') },
    brands: [b('Panadol Extra', 'GSK'), b('Disprol Extra', 'Reckitt Benckiser')],
  },
  {
    generic: 'Thiocolchicoside',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { cap: cap('4mg', '8mg'), inj: inj('4mg/2ml') },
    brands: [b('Myoril', 'Sanofi'), b('Muscoril', 'Genix Pharma')],
  },
  {
    generic: 'Tizanidine',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('2mg', '4mg') },
    brands: [b('Sirdalud', 'Novartis'), b('Tizan', 'Wilshire')],
  },

  /* ---------------------------------------------------------------------- */
  /* 2. ANTIBIOTICS & ANTI-INFECTIVES                                        */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Amoxicillin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: {
      cap: cap('250mg', '500mg'),
      susp: susp('125mg/5ml', '250mg/5ml'),
      drops: drops('100mg/ml'),
    },
    brands: [
      b('Amoxil', 'GSK', ['cap', 'susp', 'drops']),
      b('Ospamox', 'Sandoz', ['cap', 'susp']),
      b('Kamox', 'Bosch', ['cap', 'susp']),
      b('Amoxinova', 'Novamed', ['cap']),
      b('Moxal', 'Wilshire', ['cap', 'susp']),
      b('Amoxifar', 'Genix Pharma', ['cap']),
      b('Trimox', 'Hilton', ['cap', 'susp']),
    ],
  },
  {
    generic: 'Amoxicillin + Clavulanic Acid',
    category: CAT.antibiotics,
    presentations: {
      tab: tab('375mg', '625mg', '1000mg'),
      susp: susp('156mg/5ml', '228mg/5ml', '312mg/5ml', '457mg/5ml'),
      inj: inj('600mg', '1.2g'),
    },
    brands: [
      b('Augmentin', 'GSK', ['tab', 'susp', 'inj']),
      b('Curam', 'Sandoz', ['tab', 'susp']),
      b('Calamox', 'Bosch', ['tab', 'susp']),
      b('Klavox', 'Wilshire', ['tab', 'susp']),
      b('Amoxiclav', 'Genix Pharma', ['tab', 'susp']),
      b('Megamentin', 'Hilton', ['tab', 'susp']),
      b('Novaclav', 'Novamed', ['tab', 'susp']),
    ],
  },
  {
    generic: 'Ampicillin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('250mg', '500mg'), inj: inj('250mg', '500mg', '1g') },
    brands: [b('Penbritin', 'GSK', ['cap']), b('Ampicin', 'Wilshire', ['cap', 'inj'])],
  },
  {
    generic: 'Cloxacillin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('250mg', '500mg'), inj: inj('250mg', '500mg') },
    brands: [b('Orbenin', 'GSK', ['cap']), b('Cloxacap', 'Wilshire', ['cap'])],
  },
  {
    generic: 'Ampicillin + Cloxacillin',
    category: CAT.antibiotics,
    presentations: { cap: cap('250mg', '500mg'), inj: inj('500mg') },
    brands: [b('Ampiclox', 'Wilshire', ['cap', 'inj']), b('Ampilox', 'Genix Pharma', ['cap'])],
  },
  {
    generic: 'Cephradine',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: {
      cap: cap('250mg', '500mg'),
      susp: susp('125mg/5ml', '250mg/5ml'),
      inj: inj('500mg', '1g'),
      drops: drops('100mg/ml'),
    },
    brands: [
      b('Velosef', 'GSK', ['cap', 'susp', 'inj', 'drops']),
      b('Ceffe', 'Wilshire', ['cap', 'susp']),
      b('Cefradin', 'Genix Pharma', ['cap', 'susp', 'inj']),
      b('Ultrasef', 'Hilton', ['cap', 'susp']),
    ],
  },
  {
    generic: 'Cephalexin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('250mg', '500mg'), susp: susp('125mg/5ml', '250mg/5ml') },
    brands: [b('Keflex', 'Barrett Hodgson', ['cap', 'susp']), b('Ceporex', 'GSK', ['cap', 'susp'])],
  },
  {
    generic: 'Cefadroxil',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('250mg', '500mg'), susp: susp('125mg/5ml', '250mg/5ml') },
    brands: [b('Duricef', 'Barrett Hodgson', ['cap', 'susp']), b('Cefadrox', 'Wilshire', ['cap'])],
  },
  {
    generic: 'Cefuroxime',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: {
      tab: tab('250mg', '500mg'),
      susp: susp('125mg/5ml', '250mg/5ml'),
      inj: inj('750mg', '1.5g'),
    },
    brands: [
      b('Zinnat', 'GSK', ['tab', 'susp']),
      b('Zinacef', 'GSK', ['inj']),
      b('Cefasyn', 'Genix Pharma', ['tab', 'susp']),
      b('Ceroxim', 'Getz Pharma', ['tab', 'susp', 'inj']),
    ],
  },
  {
    generic: 'Cefixime',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: {
      cap: cap('200mg', '400mg'),
      susp: susp('100mg/5ml'),
      tab: tab('200mg', '400mg'),
    },
    brands: [
      b('Cefspan', 'Hilton', ['cap', 'susp']),
      b('Cefiget', 'Getz Pharma', ['cap', 'susp']),
      b('Suprax', 'Barrett Hodgson', ['cap', 'susp']),
      b('Cefim', 'Wilshire', ['cap', 'susp']),
      b('Longacef', 'Sami', ['cap', 'susp']),
      b('Ceforan', 'Sami', ['cap', 'susp']),
    ],
  },
  {
    generic: 'Cefpodoxime',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('100mg', '200mg'), susp: susp('40mg/5ml') },
    brands: [b('Cefodox', 'Getz Pharma', ['tab', 'susp']), b('Podocef', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Ceftriaxone',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('250mg', '500mg', '1g', '2g') },
    brands: [
      b('Rocephin', 'Roche'),
      b('Oxidil', 'Hilton'),
      b('Ceftrex', 'Getz Pharma'),
      b('Zetro', 'Sami'),
      b('Broadces', 'Wilshire'),
    ],
  },
  {
    generic: 'Cefotaxime',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('250mg', '500mg', '1g') },
    brands: [b('Claforan', 'Sanofi'), b('Cefotax', 'Wilshire'), b('Zimaxime', 'Getz Pharma')],
  },
  {
    generic: 'Ceftazidime',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('500mg', '1g') },
    brands: [b('Fortum', 'GSK'), b('Zidime', 'Getz Pharma')],
  },
  {
    generic: 'Cefaclor',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('250mg', '500mg'), susp: susp('125mg/5ml', '250mg/5ml') },
    brands: [b('Ceclor', 'CCL'), b('Distaclor', 'Barrett Hodgson')],
  },
  {
    generic: 'Cefepime',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('500mg', '1g') },
    brands: [b('Maxipime', 'Barrett Hodgson'), b('Cefimax', 'Getz Pharma')],
  },
  {
    generic: 'Azithromycin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: {
      tab: tab('250mg', '500mg'),
      susp: susp('200mg/5ml'),
      cap: cap('250mg', '500mg'),
    },
    brands: [
      b('Zithromax', 'Pfizer', ['tab', 'susp']),
      b('Azomax', 'Sami', ['tab', 'susp', 'cap']),
      b('Azgard', 'Getz Pharma', ['tab', 'susp']),
      b('Zetro', 'Sami', ['tab', 'susp']),
      b('Trozy', 'Wilshire', ['tab', 'susp']),
      b('Azic', 'Genix Pharma', ['tab', 'susp']),
    ],
  },
  {
    generic: 'Clarithromycin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('250mg', '500mg'), susp: susp('125mg/5ml', '250mg/5ml') },
    brands: [
      b('Klaricid', 'Abbott', ['tab', 'susp']),
      b('Klariget', 'Getz Pharma', ['tab', 'susp']),
      b('Claritek', 'Wilshire', ['tab']),
    ],
  },
  {
    generic: 'Erythromycin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('250mg', '500mg'), susp: susp('125mg/5ml', '250mg/5ml') },
    brands: [b('Erythrocin', 'Abbott', ['tab', 'susp']), b('Ilosone', 'Barrett Hodgson', ['susp'])],
  },
  {
    generic: 'Roxithromycin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('150mg', '300mg') },
    brands: [b('Rulid', 'Sanofi'), b('Roxin', 'Wilshire')],
  },
  {
    generic: 'Ciprofloxacin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: {
      tab: tab('250mg', '500mg', '750mg'),
      inf: infusion('200mg/100ml'),
      susp: susp('250mg/5ml'),
    },
    brands: [
      b('Ciproxin', 'Bayer', ['tab', 'inf']),
      b('Novidat', 'Sami', ['tab', 'inf', 'susp']),
      b('Cifran', 'Barrett Hodgson', ['tab']),
      b('Ciprofar', 'Genix Pharma', ['tab']),
      b('Zoxil', 'Wilshire', ['tab']),
      b('Ciprem', 'Hilton', ['tab']),
    ],
  },
  {
    generic: 'Levofloxacin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('250mg', '500mg', '750mg'), inf: infusion('500mg/100ml') },
    brands: [
      b('Leflox', 'Getz Pharma', ['tab', 'inf']),
      b('Tavanic', 'Sanofi', ['tab']),
      b('Levoquin', 'Wilshire', ['tab']),
      b('Levobact', 'Hilton', ['tab']),
    ],
  },
  {
    generic: 'Moxifloxacin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('400mg'), inf: infusion('400mg/250ml') },
    brands: [b('Avelox', 'Bayer', ['tab']), b('Moxiget', 'Getz Pharma', ['tab', 'inf'])],
  },
  {
    generic: 'Ofloxacin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('200mg', '400mg') },
    brands: [b('Tarivid', 'Sanofi'), b('Oflox', 'Wilshire')],
  },
  {
    generic: 'Doxycycline',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('100mg') },
    brands: [b('Vibramycin', 'Pfizer'), b('Doxin', 'Wilshire'), b('Doxycap', 'Genix Pharma')],
  },
  {
    generic: 'Minocycline',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('50mg', '100mg') },
    brands: [b('Minocin', 'Wyeth')],
  },
  {
    generic: 'Metronidazole',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: {
      tab: tab('200mg', '400mg'),
      susp: susp('200mg/5ml'),
      inf: infusion('500mg/100ml'),
    },
    brands: [
      b('Flagyl', 'Sanofi', ['tab', 'susp', 'inf']),
      b('Metrozine', 'Wilshire', ['tab', 'susp']),
      b('Amrizole', 'Sami', ['tab', 'susp']),
      b('Nidagyl', 'Genix Pharma', ['tab', 'susp']),
    ],
  },
  {
    generic: 'Tinidazole',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('500mg') },
    brands: [b('Fasigyn', 'Pfizer'), b('Tinvista', 'Wilshire')],
  },
  {
    generic: 'Secnidazole',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('500mg', '1000mg') },
    brands: [b('Secnil', 'Wilshire'), b('Secni', 'Hilton')],
  },
  {
    generic: 'Nitrofurantoin',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '100mg') },
    brands: [b('Furadantin', 'Barrett Hodgson'), b('Uvamin', 'Sami')],
  },
  {
    generic: 'Clindamycin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('150mg', '300mg'), inj: inj('300mg/2ml') },
    brands: [b('Dalacin C', 'Pfizer', ['cap', 'inj']), b('Clindal', 'Wilshire', ['cap'])],
  },
  {
    generic: 'Linezolid',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('600mg'), inf: infusion('600mg/300ml') },
    brands: [b('Zyvox', 'Pfizer', ['tab']), b('Linzo', 'Getz Pharma', ['tab', 'inf'])],
  },
  {
    generic: 'Gentamicin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('20mg', '40mg', '80mg') },
    brands: [b('Refobacin', 'Merck'), b('Genticin', 'Wilshire')],
  },
  {
    generic: 'Amikacin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('100mg', '250mg', '500mg') },
    brands: [b('Amikin', 'Barrett Hodgson'), b('Amicin', 'Wilshire')],
  },
  {
    generic: 'Sulfamethoxazole + Trimethoprim',
    category: CAT.antibiotics,
    presentations: { tab: tab('400mg+80mg', '800mg+160mg'), susp: susp('200mg+40mg/5ml') },
    brands: [
      b('Septran', 'GSK', ['tab', 'susp']),
      b('Cotrim', 'Wilshire', ['tab', 'susp']),
      b('Trimoxal', 'Genix Pharma', ['tab']),
    ],
  },
  {
    generic: 'Fusidic Acid',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('2%'), oint: oint('2%') },
    brands: [b('Fucidin', 'LEO Pharma', ['cream', 'oint']), b('Fusi', 'Wilshire', ['cream'])],
  },
  {
    generic: 'Mupirocin',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { oint: oint('2%') },
    brands: [b('Bactroban', 'GSK'), b('Mupiban', 'Wilshire')],
  },
  {
    generic: 'Meropenem',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('500mg', '1g') },
    brands: [b('Meronem', 'Pfizer'), b('Penem', 'Getz Pharma')],
  },
  {
    generic: 'Piperacillin + Tazobactam',
    category: CAT.antibiotics,
    presentations: { inj: inj('2.25g', '4.5g') },
    brands: [b('Tazocin', 'Pfizer'), b('Pipracil', 'Getz Pharma')],
  },
  {
    generic: 'Sulbactam + Cefoperazone',
    category: CAT.antibiotics,
    presentations: { inj: inj('1.5g', '2g') },
    brands: [b('Sulzon', 'Pfizer'), b('Cefosaf', 'Getz Pharma')],
  },
  {
    generic: 'Vancomycin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('500mg', '1g') },
    brands: [b('Vancocin', 'Barrett Hodgson')],
  },


  /* ---------------------------------------------------------------------- */
  /* 3. GASTROINTESTINAL                                                     */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Omeprazole',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { cap: cap('20mg', '40mg'), inj: inj('40mg') },
    brands: [
      b('Risek', 'Getz Pharma', ['cap', 'inj']),
      b('Omez', 'Wilshire', ['cap']),
      b('Zole', 'Hilton', ['cap']),
      b('Ulcezol', 'Wilshire', ['cap']),
      b('Omeprol', 'Genix Pharma', ['cap']),
    ],
  },
  {
    generic: 'Esomeprazole',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('20mg', '40mg'), inj: inj('40mg') },
    brands: [
      b('Nexium', 'AstraZeneca', ['tab', 'inj']),
      b('Nexum', 'Getz Pharma', ['tab', 'inj']),
      b('Esso', 'Hilton', ['tab']),
      b('Esomep', 'Wilshire', ['tab']),
    ],
  },
  {
    generic: 'Pantoprazole',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('20mg', '40mg'), inj: inj('40mg') },
    brands: [
      b('Sozol', 'Sami', ['tab', 'inj']),
      b('Zopent', 'Getz Pharma', ['tab', 'inj']),
      b('Pantop', 'Hilton', ['tab']),
      b('Protium', 'Wilshire', ['tab']),
      b('Panloc', 'Genix Pharma', ['tab', 'inj']),
      b('Pantonix', 'Bosch', ['tab']),
      b('Peptron', 'CCL', ['tab']),
    ],
  },
  {
    generic: 'Rabeprazole',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '20mg') },
    brands: [b('Pariet', 'Barrett Hodgson'), b('Rabecid', 'Wilshire'), b('Rabifin', 'Hilton')],
  },
  {
    generic: 'Lansoprazole',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { cap: cap('15mg', '30mg') },
    brands: [b('Lanzol', 'Wilshire'), b('Lanpro', 'Hilton')],
  },
  {
    generic: 'Ranitidine',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('150mg', '300mg'), inj: inj('50mg/2ml'), syr: syr('75mg/5ml') },
    brands: [
      b('Zantac', 'GSK', ['tab', 'inj', 'syr']),
      b('Ranidin', 'Wilshire', ['tab']),
      b('Peptigard', 'Hilton', ['tab']),
    ],
  },
  {
    generic: 'Famotidine',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('20mg', '40mg') },
    brands: [b('Peptidine', 'Wilshire'), b('Famo', 'Hilton')],
  },
  {
    generic: 'Domperidone',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('10mg'), susp: susp('5mg/5ml') },
    brands: [
      b('Motilium', 'Barrett Hodgson', ['tab', 'susp']),
      b('Domel', 'Wilshire', ['tab', 'susp']),
      b('Dom', 'Hilton', ['tab']),
    ],
  },
  {
    generic: 'Metoclopramide',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('10mg'), inj: inj('10mg/2ml'), syr: syr('5mg/5ml') },
    brands: [b('Maxolon', 'Barrett Hodgson', ['tab', 'inj', 'syr']), b('Metovern', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Itopride',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('50mg') },
    brands: [b('Ganaton', 'Abbott'), b('Itofly', 'Wilshire')],
  },
  {
    generic: 'Hyoscine Butylbromide',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('10mg'), inj: inj('20mg/ml') },
    brands: [b('Buscopan', 'Sami', ['tab', 'inj']), b('Spasm', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Mebeverine',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('135mg'), cap: cap('200mg') },
    brands: [b('Colofac', 'Abbott', ['tab']), b('Duspatalin', 'Abbott', ['cap'])],
  },
  {
    generic: 'Drotaverine',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('40mg', '80mg'), inj: inj('40mg/2ml') },
    brands: [b('No-Spa', 'Sanofi', ['tab', 'inj']), b('Drotin', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Loperamide',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('2mg') },
    brands: [b('Imodium', 'Searle'), b('Lopamide', 'Wilshire')],
  },
  {
    generic: 'Aluminium Hydroxide + Magnesium Hydroxide',
    category: CAT.gastro,
    presentations: { susp: susp(null), tab: tab(null) },
    brands: [
      b('Mucaine', 'Pfizer', ['susp']),
      b('Gelusil', 'Pfizer', ['susp', 'tab']),
      b('Maalox', 'Sanofi', ['susp']),
    ],
  },
  {
    generic: 'Sodium Alginate + Sodium Bicarbonate',
    category: CAT.gastro,
    presentations: { susp: susp(null), tab: tab(null) },
    brands: [b('Gaviscon', 'Reckitt Benckiser', ['susp', 'tab'])],
  },
  {
    generic: 'Simethicone',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { drops: drops('40mg/ml'), tab: tab('40mg') },
    brands: [b('Disflatyl', 'Barrett Hodgson', ['drops']), b('Flatmusil', 'Wilshire', ['drops'])],
  },
  {
    generic: 'Sucralfate',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { susp: susp('1g/5ml'), tab: tab('1g') },
    brands: [b('Ulsanic', 'Wilshire', ['susp', 'tab']), b('Sucral', 'Hilton', ['susp'])],
  },
  {
    generic: 'Lactulose',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { syr: syr('3.35g/5ml') },
    brands: [b('Duphalac', 'Abbott'), b('Lilac', 'Wilshire')],
  },
  {
    generic: 'Bisacodyl',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('5mg'), supp: supp('10mg') },
    brands: [b('Dulcolax', 'Sanofi', ['tab', 'supp'])],
  },
  {
    generic: 'Ispaghula Husk',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { sachet: sachet(null) },
    brands: [b('Mucilax', 'Wilshire'), b('Fibogel', 'Reckitt Benckiser')],
  },
  {
    generic: 'Mesalazine',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('400mg', '500mg') },
    brands: [b('Mezavant', 'Wilshire'), b('Salofalk', 'Barrett Hodgson')],
  },
  {
    generic: 'Ondansetron',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('4mg', '8mg'), inj: inj('4mg/2ml', '8mg/4ml'), syr: syr('4mg/5ml') },
    brands: [
      b('Zofran', 'Novartis', ['tab', 'inj']),
      b('Onset', 'Getz Pharma', ['tab', 'inj', 'syr']),
      b('Emset', 'Wilshire', ['tab', 'inj']),
    ],
  },
  {
    generic: 'Dimenhydrinate',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('50mg'), inj: inj('50mg/ml') },
    brands: [b('Gravinate', 'Searle', ['tab', 'inj']), b('Travamine', 'Wilshire', ['tab'])],
  },

  /* ---------------------------------------------------------------------- */
  /* 4. HYPERTENSION & CARDIOVASCULAR                                        */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Amlodipine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [
      b('Norvasc', 'Pfizer'),
      b('Amlod', 'Wilshire'),
      b('Amlopin', 'Hilton'),
      b('Amvas', 'Getz Pharma'),
      b('Amlokind', 'Wilshire'),
      b('Exforge', 'Novartis'),
    ],
  },
  {
    generic: 'Amlodipine + Valsartan',
    category: CAT.cardio,
    presentations: { tab: tab('5mg+80mg', '5mg+160mg', '10mg+160mg') },
    brands: [b('Exforge', 'Novartis'), b('Amval', 'Getz Pharma')],
  },
  {
    generic: 'Lisinopril',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg', '20mg') },
    brands: [b('Zestril', 'AstraZeneca'), b('Lisinotec', 'Wilshire')],
  },
  {
    generic: 'Enalapril',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg', '20mg') },
    brands: [b('Renitec', 'MSD'), b('Enapril', 'Wilshire')],
  },
  {
    generic: 'Captopril',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg') },
    brands: [b('Capoten', 'Barrett Hodgson'), b('Captopt', 'Wilshire')],
  },
  {
    generic: 'Perindopril',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('2mg', '4mg', '5mg', '10mg') },
    brands: [b('Coversyl', 'Servier'), b('Perigard', 'Getz Pharma')],
  },
  {
    generic: 'Ramipril',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('1.25mg', '2.5mg', '5mg', '10mg') },
    brands: [b('Tritace', 'Sanofi'), b('Ramace', 'Wilshire')],
  },
  {
    generic: 'Losartan',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg', '100mg') },
    brands: [
      b('Cozaar', 'MSD'),
      b('Losar', 'Getz Pharma'),
      b('Angizaar', 'Wilshire'),
      b('Losartas', 'Hilton'),
    ],
  },
  {
    generic: 'Valsartan',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('40mg', '80mg', '160mg', '320mg') },
    brands: [b('Diovan', 'Novartis'), b('Valsav', 'Getz Pharma'), b('Valz', 'Wilshire')],
  },
  {
    generic: 'Telmisartan',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('20mg', '40mg', '80mg') },
    brands: [
      b('Micardis', 'Boehringer Ingelheim'),
      b('Telsan', 'Getz Pharma'),
      b('Telmicard', 'Wilshire'),
    ],
  },
  {
    generic: 'Candesartan',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('8mg', '16mg', '32mg') },
    brands: [b('Atacand', 'AstraZeneca'), b('Candelong', 'Wilshire')],
  },
  {
    generic: 'Irbesartan',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('150mg', '300mg') },
    brands: [b('Aprovel', 'Sanofi'), b('Irbe', 'Wilshire')],
  },
  {
    generic: 'Olmesartan',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('20mg', '40mg') },
    brands: [b('Olmec', 'Getz Pharma'), b('Benicar', 'Wilshire')],
  },
  {
    generic: 'Valsartan + Hydrochlorothiazide',
    category: CAT.cardio,
    presentations: { tab: tab('80mg+12.5mg', '160mg+12.5mg', '160mg+25mg') },
    brands: [b('Co-Diovan', 'Novartis'), b('Co-Valz', 'Wilshire')],
  },
  {
    generic: 'Losartan + Hydrochlorothiazide',
    category: CAT.cardio,
    presentations: { tab: tab('50mg+12.5mg', '100mg+25mg') },
    brands: [b('Hyzaar', 'MSD'), b('Co-Losar', 'Getz Pharma')],
  },
  {
    generic: 'Bisoprolol',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('2.5mg', '5mg', '10mg') },
    brands: [b('Concor', 'Merck'), b('Bisoral', 'Wilshire'), b('Bisocor', 'Hilton')],
  },
  {
    generic: 'Atenolol',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg', '100mg') },
    brands: [b('Tenormin', 'Atco'), b('Blokium', 'Wilshire')],
  },
  {
    generic: 'Metoprolol',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg', '100mg') },
    brands: [b('Betaloc', 'AstraZeneca'), b('Neobloc', 'Wilshire')],
  },
  {
    generic: 'Carvedilol',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('3.125mg', '6.25mg', '12.5mg', '25mg') },
    brands: [b('Dilatrend', 'Roche'), b('Carveda', 'Wilshire')],
  },
  {
    generic: 'Nebivolol',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('2.5mg', '5mg') },
    brands: [b('Nebilet', 'Berlin'), b('Nebistar', 'Wilshire')],
  },
  {
    generic: 'Propranolol',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '40mg') },
    brands: [b('Inderal', 'Atco'), b('Angilol', 'Wilshire')],
  },
  {
    generic: 'Nifedipine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '20mg') },
    brands: [b('Adalat', 'Bayer'), b('Nifecard', 'Wilshire')],
  },
  {
    generic: 'Diltiazem',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('30mg', '60mg', '90mg') },
    brands: [b('Herbesser', 'Sami'), b('Dilzem', 'Barrett Hodgson')],
  },
  {
    generic: 'Verapamil',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('40mg', '80mg') },
    brands: [b('Isoptin', 'Abbott'), b('Calan', 'Wilshire')],
  },
  {
    generic: 'Doxazosin',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('1mg', '2mg', '4mg') },
    brands: [b('Cardura', 'Pfizer'), b('Doxacard', 'Wilshire')],
  },
  {
    generic: 'Hydrochlorothiazide',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('12.5mg', '25mg') },
    brands: [b('Esidrex', 'Novartis')],
  },
  {
    generic: 'Furosemide',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('20mg', '40mg'), inj: inj('20mg/2ml') },
    brands: [b('Lasix', 'Sanofi', ['tab', 'inj']), b('Diuris', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Spironolactone',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '100mg') },
    brands: [b('Aldactone', 'Pfizer'), b('Spiromide', 'Wilshire')],
  },
  {
    generic: 'Indapamide',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('1.5mg', '2.5mg') },
    brands: [b('Natrilix', 'Servier'), b('Indap', 'Wilshire')],
  },
  {
    generic: 'Atorvastatin',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '20mg', '40mg', '80mg') },
    brands: [
      b('Lipitor', 'Pfizer'),
      b('Lipiget', 'Getz Pharma'),
      b('Atorel', 'Wilshire'),
      b('Storvas', 'Sami'),
      b('Xarator', 'Pfizer'),
    ],
  },
  {
    generic: 'Rosuvastatin',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg', '20mg', '40mg') },
    brands: [
      b('Crestor', 'AstraZeneca'),
      b('Rovista', 'Getz Pharma'),
      b('Rosuget', 'Getz Pharma'),
      b('Rozy', 'Wilshire'),
    ],
  },
  {
    generic: 'Simvastatin',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '20mg', '40mg') },
    brands: [b('Zocor', 'MSD'), b('Simvast', 'Wilshire')],
  },
  {
    generic: 'Fenofibrate',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { cap: cap('160mg', '200mg') },
    brands: [b('Lipanthyl', 'Abbott'), b('Fenolip', 'Wilshire')],
  },
  {
    generic: 'Clopidogrel',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('75mg') },
    brands: [
      b('Plavix', 'Sanofi'),
      b('Clopid', 'Getz Pharma'),
      b('Pilite', 'Wilshire'),
      b('Areplex', 'Hilton'),
    ],
  },
  {
    generic: 'Isosorbide Mononitrate',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('20mg', '40mg', '60mg') },
    brands: [b('Imdur', 'AstraZeneca'), b('Monotrate', 'Wilshire')],
  },
  {
    generic: 'Isosorbide Dinitrate',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Isordil', 'Wilshire'), b('Angised', 'Hilton')],
  },
  {
    generic: 'Glyceryl Trinitrate',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { spray: spray(null) },
    brands: [b('Nitrocine', 'Wilshire'), b('Angispray', 'Hilton')],
  },
  {
    generic: 'Digoxin',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('0.25mg') },
    brands: [b('Lanoxin', 'Aspen')],
  },
  {
    generic: 'Warfarin',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('1mg', '3mg', '5mg') },
    brands: [b('Warf', 'Wilshire'), b('Coumadin', 'Barrett Hodgson')],
  },
  {
    generic: 'Rivaroxaban',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '15mg', '20mg') },
    brands: [b('Xarelto', 'Bayer'), b('Rivarox', 'Getz Pharma')],
  },
  {
    generic: 'Nicorandil',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Ikorel', 'Sanofi'), b('Nikoran', 'Wilshire')],
  },
  {
    generic: 'Trimetazidine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('35mg') },
    brands: [b('Vastarel', 'Servier'), b('Metazid', 'Wilshire')],
  },
  {
    generic: 'Ivabradine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '7.5mg') },
    brands: [b('Procoralan', 'Servier'), b('Ivabab', 'Wilshire')],
  },


  /* ---------------------------------------------------------------------- */
  /* 5. DIABETES                                                             */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Metformin',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('500mg', '850mg', '1000mg') },
    brands: [
      b('Glucophage', 'Merck'),
      b('Glucophage XR', 'Merck'),
      b('Neodipar', 'Sanofi'),
      b('Getformin', 'Getz Pharma'),
      b('Metfor', 'Wilshire'),
      b('Diformin', 'Hilton'),
    ],
  },
  {
    generic: 'Glimepiride',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('1mg', '2mg', '3mg', '4mg') },
    brands: [
      b('Amaryl', 'Sanofi'),
      b('Getryl', 'Getz Pharma'),
      b('Glime', 'Wilshire'),
      b('Reclide', 'Hilton'),
    ],
  },
  {
    generic: 'Gliclazide',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('30mg', '60mg', '80mg') },
    brands: [b('Diamicron', 'Servier'), b('Diamicron MR', 'Servier'), b('Glyzid', 'Wilshire')],
  },
  {
    generic: 'Glibenclamide',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('5mg') },
    brands: [b('Daonil', 'Sanofi'), b('Euglucon', 'Wilshire')],
  },
  {
    generic: 'Sitagliptin',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg', '100mg') },
    brands: [b('Januvia', 'MSD'), b('Sitaget', 'Getz Pharma'), b('Sitaglip', 'Wilshire')],
  },
  {
    generic: 'Sitagliptin + Metformin',
    category: CAT.diabetes,
    presentations: { tab: tab('50mg+500mg', '50mg+1000mg') },
    brands: [b('Janumet', 'MSD'), b('Sitamet', 'Getz Pharma')],
  },
  {
    generic: 'Vildagliptin',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('50mg') },
    brands: [b('Galvus', 'Novartis'), b('Vilda', 'Getz Pharma')],
  },
  {
    generic: 'Vildagliptin + Metformin',
    category: CAT.diabetes,
    presentations: { tab: tab('50mg+500mg', '50mg+850mg', '50mg+1000mg') },
    brands: [b('Galvus Met', 'Novartis'), b('Vildamet', 'Getz Pharma')],
  },
  {
    generic: 'Linagliptin',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('5mg') },
    brands: [b('Trajenta', 'Boehringer Ingelheim'), b('Lina', 'Getz Pharma')],
  },
  {
    generic: 'Empagliflozin',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '25mg') },
    brands: [b('Jardiance', 'Boehringer Ingelheim'), b('Empaget', 'Getz Pharma')],
  },
  {
    generic: 'Dapagliflozin',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Forxiga', 'AstraZeneca'), b('Dapaget', 'Getz Pharma')],
  },
  {
    generic: 'Pioglitazone',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('15mg', '30mg') },
    brands: [b('Actos', 'Barrett Hodgson'), b('Piozer', 'Wilshire')],
  },
  {
    generic: 'Insulin (Isophane) HM',
    category: CAT.diabetes,
    presentations: { inj: inj('100IU/ml') },
    brands: [b('Humulin N', 'Eli Lilly'), b('Insuget N', 'Getz Pharma')],
  },
  {
    generic: 'Insulin (Regular) HM',
    category: CAT.diabetes,
    presentations: { inj: inj('100IU/ml') },
    brands: [b('Humulin R', 'Eli Lilly')],
  },
  {
    generic: 'Insulin (Biphasic 30/70) HM',
    category: CAT.diabetes,
    presentations: { inj: inj('100IU/ml') },
    brands: [b('Mixtard 30 HM', 'Novo Nordisk'), b('Humulin 30/70', 'Eli Lilly')],
  },
  {
    generic: 'Insulin Glargine',
    category: CAT.diabetes,
    presentations: { inj: inj('100IU/ml') },
    brands: [b('Lantus', 'Sanofi'), b('Basaglar', 'Eli Lilly')],
  },
  {
    generic: 'Insulin Aspart',
    category: CAT.diabetes,
    presentations: { inj: inj('100IU/ml') },
    brands: [b('NovoRapid', 'Novo Nordisk')],
  },

  /* ---------------------------------------------------------------------- */
  /* 6. ALLERGY & ANTIHISTAMINES                                            */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Cetirizine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('10mg'), syr: syr('5mg/5ml'), drops: drops('10mg/ml') },
    brands: [
      b('Zyrtec', 'GSK', ['tab', 'syr']),
      b('Rigix', 'Getz Pharma', ['tab', 'syr']),
      b('Cetin', 'Wilshire', ['tab', 'syr']),
      b('Alfin', 'Hilton', ['tab']),
      b('T-Day', 'Sami', ['tab', 'syr']),
    ],
  },
  {
    generic: 'Levocetirizine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('5mg'), syr: syr('2.5mg/5ml') },
    brands: [
      b('Xyzal', 'GSK', ['tab', 'syr']),
      b('Softin', 'Hilton', ['tab', 'syr']),
      b('Levoz', 'Wilshire', ['tab']),
    ],
  },
  {
    generic: 'Fexofenadine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('60mg', '120mg', '180mg'), susp: susp('30mg/5ml') },
    brands: [
      b('Telfast', 'Sanofi', ['tab', 'susp']),
      b('Fexet', 'Getz Pharma', ['tab', 'susp']),
      b('Fexo', 'Wilshire', ['tab']),
    ],
  },
  {
    generic: 'Loratadine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('10mg'), syr: syr('5mg/5ml') },
    brands: [b('Clarityne', 'Bayer', ['tab', 'syr']), b('Lorat', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Desloratadine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('5mg'), syr: syr('2.5mg/5ml') },
    brands: [b('Aerius', 'Barrett Hodgson', ['tab', 'syr']), b('Deslor', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Chlorpheniramine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('4mg'), syr: syr('2mg/5ml'), inj: inj('10mg/ml') },
    brands: [b('Piriton', 'GSK', ['tab', 'syr']), b('Avil', 'Sanofi', ['tab', 'inj'])],
  },
  {
    generic: 'Pheniramine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { inj: inj('22.75mg/ml'), tab: tab('22.5mg') },
    brands: [b('Avil', 'Sanofi', ['inj'])],
  },
  {
    generic: 'Hydroxyzine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '25mg'), syr: syr('10mg/5ml') },
    brands: [b('Atarax', 'Barrett Hodgson', ['tab', 'syr'])],
  },
  {
    generic: 'Ketotifen',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('1mg'), syr: syr('1mg/5ml') },
    brands: [b('Zaditen', 'Novartis', ['tab', 'syr']), b('Tofen', 'Wilshire', ['syr'])],
  },
  {
    generic: 'Bilastine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('20mg') },
    brands: [b('Bilaz', 'Getz Pharma'), b('Blexten', 'Wilshire')],
  },

  /* ---------------------------------------------------------------------- */
  /* 7. ASTHMA & COPD / RESPIRATORY                                          */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Salbutamol',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: {
      inhaler: inhaler('100mcg'),
      tab: tab('2mg', '4mg'),
      syr: syr('2mg/5ml'),
      inj: inj('0.5mg/ml'),
    },
    brands: [
      b('Ventolin', 'GSK', ['inhaler', 'tab', 'syr', 'inj']),
      b('Salbo', 'Wilshire', ['tab', 'syr']),
      b('Azmasol', 'Sami', ['inhaler']),
    ],
  },
  {
    generic: 'Salmeterol + Fluticasone',
    category: CAT.respiratory,
    presentations: { inhaler: inhaler('25mcg+125mcg', '25mcg+250mcg', '50mcg+250mcg') },
    brands: [b('Seretide', 'GSK'), b('Combais', 'Getz Pharma')],
  },
  {
    generic: 'Formoterol + Budesonide',
    category: CAT.respiratory,
    presentations: { inhaler: inhaler('6mcg+200mcg', '6mcg+100mcg') },
    brands: [b('Symbicort', 'AstraZeneca'), b('Budeform', 'Getz Pharma')],
  },
  {
    generic: 'Budesonide',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { inhaler: inhaler('200mcg'), spray: spray('64mcg') },
    brands: [b('Pulmicort', 'AstraZeneca', ['inhaler']), b('Budecort', 'Getz Pharma', ['inhaler'])],
  },
  {
    generic: 'Beclomethasone',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { inhaler: inhaler('50mcg', '250mcg') },
    brands: [b('Becotide', 'GSK'), b('Beclate', 'Wilshire')],
  },
  {
    generic: 'Ipratropium',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { inhaler: inhaler('20mcg') },
    brands: [b('Atrovent', 'Boehringer Ingelheim')],
  },
  {
    generic: 'Tiotropium',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { inhaler: inhaler('18mcg') },
    brands: [b('Spiriva', 'Boehringer Ingelheim')],
  },
  {
    generic: 'Montelukast',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { tab: tab('4mg', '5mg', '10mg') },
    brands: [
      b('Singulair', 'MSD'),
      b('Montiget', 'Getz Pharma'),
      b('Myteka', 'Sami'),
      b('Montelo', 'Wilshire'),
    ],
  },
  {
    generic: 'Theophylline',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { tab: tab('200mg', '300mg') },
    brands: [b('Neophyllin', 'Wilshire'), b('Theograd', 'Hilton')],
  },
  {
    generic: 'Aminophylline',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { inj: inj('250mg/10ml') },
    brands: [b('Aminophylline', 'Wilshire')],
  },
  {
    generic: 'Doxofylline',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { tab: tab('400mg'), syr: syr('100mg/5ml') },
    brands: [b('Ansimar', 'Wilshire', ['tab']), b('Doxofil', 'Hilton', ['tab', 'syr'])],
  },
  {
    generic: 'Ambroxol',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { syr: syr('15mg/5ml', '30mg/5ml'), tab: tab('30mg') },
    brands: [b('Mucolythin', 'Wilshire', ['syr']), b('Mucosolvan', 'Sami', ['syr', 'tab'])],
  },
  {
    generic: 'Bromhexine',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { syr: syr('4mg/5ml'), tab: tab('8mg') },
    brands: [b('Bisolvon', 'Sanofi', ['syr', 'tab'])],
  },
  {
    generic: 'Acetylcysteine',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { sachet: sachet('200mg', '600mg') },
    brands: [b('Mucomyst', 'Wilshire'), b('ACC', 'Sami')],
  },
  {
    generic: 'Carbocisteine',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { syr: syr('250mg/5ml'), cap: cap('375mg') },
    brands: [b('Mucodyne', 'Wilshire', ['syr', 'cap'])],
  },
  {
    generic: 'Dextromethorphan',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { syr: syr('10mg/5ml') },
    brands: [b('Tussils', 'Wilshire'), b('Corex-D', 'Pfizer')],
  },
  {
    generic: 'Guaifenesin',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { syr: syr('100mg/5ml') },
    brands: [b('Benylin', 'Sanofi'), b('Coferb', 'Herbion')],
  },
  {
    generic: 'Pseudoephedrine + Triprolidine',
    category: CAT.respiratory,
    presentations: { syr: syr(null), tab: tab(null) },
    brands: [b('Actifed', 'GSK', ['syr', 'tab'])],
  },


  /* ---------------------------------------------------------------------- */
  /* 8. CNS, NEUROLOGY & PSYCHIATRY                                          */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Diazepam',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('2mg', '5mg', '10mg'), inj: inj('10mg/2ml') },
    brands: [b('Valium', 'Roche', ['tab', 'inj']), b('Diapam', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Bromazepam',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('1.5mg', '3mg', '6mg') },
    brands: [b('Lexotanil', 'Roche'), b('Broz', 'Wilshire')],
  },
  {
    generic: 'Alprazolam',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('0.25mg', '0.5mg', '1mg') },
    brands: [b('Xanax', 'Pfizer'), b('Alp', 'Wilshire'), b('Alprax', 'Hilton')],
  },
  {
    generic: 'Clonazepam',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('0.5mg', '1mg', '2mg') },
    brands: [b('Rivotril', 'Roche'), b('Epitril', 'Wilshire')],
  },
  {
    generic: 'Lorazepam',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('1mg', '2mg') },
    brands: [b('Ativan', 'Pfizer')],
  },
  {
    generic: 'Zolpidem',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Stilnox', 'Sanofi'), b('Zolt', 'Wilshire')],
  },
  {
    generic: 'Escitalopram',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg', '20mg') },
    brands: [b('Cipralex', 'Barrett Hodgson'), b('Escit', 'Wilshire'), b('Lexapro', 'Hilton')],
  },
  {
    generic: 'Sertraline',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '100mg') },
    brands: [b('Zoloft', 'Pfizer'), b('Serlift', 'Wilshire'), b('Sertima', 'Hilton')],
  },
  {
    generic: 'Fluoxetine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { cap: cap('20mg') },
    brands: [b('Prozac', 'Eli Lilly'), b('Flux', 'Wilshire')],
  },
  {
    generic: 'Paroxetine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('20mg') },
    brands: [b('Seroxat', 'GSK'), b('Paxil', 'Wilshire')],
  },
  {
    generic: 'Citalopram',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('20mg') },
    brands: [b('Cipram', 'Wilshire')],
  },
  {
    generic: 'Duloxetine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { cap: cap('30mg', '60mg') },
    brands: [b('Cymbalta', 'Eli Lilly'), b('Dulane', 'Wilshire')],
  },
  {
    generic: 'Venlafaxine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { cap: cap('37.5mg', '75mg', '150mg') },
    brands: [b('Efexor', 'Pfizer'), b('Venla', 'Wilshire')],
  },
  {
    generic: 'Amitriptyline',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '25mg') },
    brands: [b('Tryptanol', 'Barrett Hodgson'), b('Amitrip', 'Wilshire')],
  },
  {
    generic: 'Mirtazapine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('15mg', '30mg') },
    brands: [b('Remeron', 'Barrett Hodgson'), b('Mirtaz', 'Wilshire')],
  },
  {
    generic: 'Olanzapine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Zyprexa', 'Eli Lilly'), b('Olanz', 'Wilshire')],
  },
  {
    generic: 'Risperidone',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('1mg', '2mg', '4mg') },
    brands: [b('Risperdal', 'Barrett Hodgson'), b('Rispond', 'Wilshire')],
  },
  {
    generic: 'Quetiapine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '100mg', '200mg', '300mg') },
    brands: [b('Seroquel', 'AstraZeneca'), b('Quel', 'Wilshire')],
  },
  {
    generic: 'Aripiprazole',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg', '15mg') },
    brands: [b('Abilify', 'Barrett Hodgson'), b('Arpi', 'Wilshire')],
  },
  {
    generic: 'Haloperidol',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('1.5mg', '5mg'), inj: inj('5mg/ml') },
    brands: [b('Serenace', 'Searle', ['tab', 'inj'])],
  },
  {
    generic: 'Sulpiride',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('200mg'), cap: cap('50mg') },
    brands: [b('Dogmatil', 'Sanofi', ['tab', 'cap'])],
  },
  {
    generic: 'Sodium Valproate',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('200mg', '500mg'), syr: syr('200mg/5ml') },
    brands: [b('Epival', 'Abbott', ['tab']), b('Valprol', 'Wilshire', ['tab', 'syr'])],
  },
  {
    generic: 'Carbamazepine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('200mg', '400mg'), syr: syr('100mg/5ml') },
    brands: [b('Tegral', 'Novartis', ['tab']), b('Tegretol', 'Novartis', ['tab', 'syr'])],
  },
  {
    generic: 'Levetiracetam',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('250mg', '500mg', '1000mg'), syr: syr('100mg/ml') },
    brands: [b('Keppra', 'Barrett Hodgson', ['tab']), b('Levera', 'Getz Pharma', ['tab', 'syr'])],
  },
  {
    generic: 'Lamotrigine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg', '100mg') },
    brands: [b('Lamictal', 'GSK'), b('Lamize', 'Wilshire')],
  },
  {
    generic: 'Phenytoin',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { cap: cap('100mg'), tab: tab('50mg') },
    brands: [b('Epidin', 'Wilshire'), b('Dilantin', 'Pfizer')],
  },
  {
    generic: 'Gabapentin',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { cap: cap('100mg', '300mg', '400mg') },
    brands: [b('Neurontin', 'Pfizer'), b('Gaba', 'Wilshire')],
  },
  {
    generic: 'Pregabalin',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { cap: cap('25mg', '50mg', '75mg', '100mg', '150mg', '300mg') },
    brands: [
      b('Lyrica', 'Pfizer'),
      b('Zeegap', 'Getz Pharma'),
      b('Gablin', 'Wilshire'),
      b('Pregab', 'Hilton'),
    ],
  },
  {
    generic: 'Levodopa + Carbidopa',
    category: CAT.cns,
    presentations: { tab: tab('250mg+25mg', '100mg+25mg') },
    brands: [b('Sinemet', 'MSD'), b('Levocar', 'Wilshire')],
  },
  {
    generic: 'Betahistine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('8mg', '16mg', '24mg') },
    brands: [b('Betaserc', 'Abbott'), b('Vertin', 'Wilshire'), b('Serc', 'Abbott')],
  },
  {
    generic: 'Flunarizine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Sibelium', 'Barrett Hodgson'), b('Fluna', 'Wilshire')],
  },
  {
    generic: 'Citicoline',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('500mg'), inj: inj('500mg/4ml'), syr: syr('100mg/ml') },
    brands: [b('Somazina', 'Ferozsons', ['tab', 'inj']), b('Citi', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Piracetam',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('400mg', '800mg', '1200mg'), syr: syr('500mg/5ml') },
    brands: [b('Nootropil', 'Searle', ['tab', 'syr'])],
  },
  {
    generic: 'Donepezil',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Aricept', 'Barrett Hodgson'), b('Donep', 'Wilshire')],
  },

  /* ---------------------------------------------------------------------- */
  /* 9. VITAMINS, MINERALS & SUPPLEMENTS                                     */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Multivitamin',
    category: CAT.vitamins,
    presentations: { tab: tab(null), syr: syr(null) },
    brands: [
      b('Surbex Z', 'Abbott', ['tab']),
      b('Surbex-T', 'Abbott', ['tab']),
      b('Polybion', 'Merck', ['syr', 'tab']),
      b('Becozym', 'Sami', ['tab']),
      b('Neurobion', 'Merck', ['tab']),
      b('Nutrivit', 'Wilshire', ['syr']),
    ],
  },
  {
    generic: 'Vitamin B Complex',
    category: CAT.vitamins,
    presentations: { tab: tab(null), syr: syr(null), inj: inj(null) },
    brands: [
      b('Neurobion', 'Merck', ['tab', 'inj']),
      b('Tri-B', 'Wilshire', ['tab']),
      b('Vibicom', 'Hilton', ['syr']),
    ],
  },
  {
    generic: 'Vitamin B1 + B6 + B12',
    category: CAT.vitamins,
    presentations: { tab: tab(null), inj: inj(null) },
    brands: [b('Neurobion', 'Merck', ['tab', 'inj']), b('Neurorubine', 'Sami', ['tab', 'inj'])],
  },
  {
    generic: 'Ascorbic Acid',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { tab: tab('500mg', '1000mg') },
    brands: [b('Redoxon', 'Bayer'), b('Ceecon', 'Wilshire'), b('C-Vit', 'Hilton')],
  },
  {
    generic: 'Calcium + Vitamin D3',
    category: CAT.vitamins,
    presentations: { tab: tab('500mg+200IU', '600mg+400IU') },
    brands: [
      b('Cac-1000 Plus', 'Wyeth'),
      b('Calcium Sandoz', 'Sandoz'),
      b('Qalsan D', 'Getz Pharma'),
      b('Ostocal-D', 'Wilshire'),
      b('Caltrate', 'Pfizer'),
    ],
  },
  {
    generic: 'Cholecalciferol',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { inj: inj('200000IU/ml'), sachet: sachet('200000IU'), tab: tab('50000IU') },
    brands: [
      b('Indrop D', 'Highnoon', ['sachet']),
      b('Sunny D', 'CCL', ['sachet', 'inj']),
      b('Vidylin-M', 'Abbott', ['inj']),
    ],
  },
  {
    generic: 'Ferrous Sulfate',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { tab: tab('200mg'), syr: syr(null) },
    brands: [b('Fefol', 'GSK', ['tab']), b('Feriset', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Iron Polymaltose + Folic Acid',
    category: CAT.vitamins,
    presentations: { tab: tab(null), syr: syr(null), inj: inj(null) },
    brands: [
      b('Sangobion', 'Merck', ['cap']),
      b('Ferrogen', 'Wilshire', ['syr']),
      b('Venofer', 'Sami', ['inj']),
    ],
  },
  {
    generic: 'Folic Acid',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { tab: tab('5mg') },
    brands: [b('Folic Acid', 'Wilshire')],
  },
  {
    generic: 'Zinc Sulfate',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { syr: syr('20mg/5ml'), tab: tab('20mg') },
    brands: [b('Zincat', 'Wilshire', ['syr']), b('Zinc', 'Hilton', ['syr'])],
  },
  {
    generic: 'Omega-3 Fatty Acids',
    category: CAT.vitamins,
    presentations: { cap: cap(null) },
    brands: [b('Seven Seas', 'Merck'), b('Omega Plus', 'Wilshire'), b('Fish Oil', 'Hilton')],
  },
  {
    generic: 'Coenzyme Q10',
    category: CAT.vitamins,
    presentations: { cap: cap('100mg') },
    brands: [b('CoQ10', 'Wilshire'), b('Qufit', 'Hilton')],
  },
  {
    generic: 'Methylcobalamin',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { tab: tab('500mcg'), inj: inj('1000mcg/ml') },
    brands: [b('Methycal', 'Wilshire', ['tab', 'inj']), b('Nervz', 'Hilton', ['tab'])],
  },
  {
    generic: 'Alpha Lipoic Acid',
    category: CAT.vitamins,
    presentations: { tab: tab('300mg', '600mg') },
    brands: [b('Thioctacid', 'Sami'), b('Neurotol', 'Wilshire')],
  },


  /* ---------------------------------------------------------------------- */
  /* 10. DERMATOLOGY                                                         */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Betamethasone',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('0.1%'), oint: oint('0.1%'), lotion: lotion('0.1%') },
    brands: [
      b('Betnovate', 'GSK', ['cream', 'oint', 'lotion']),
      b('Betnovate-N', 'GSK', ['cream']),
      b('Beta', 'Wilshire', ['cream']),
    ],
  },
  {
    generic: 'Clobetasol',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('0.05%'), oint: oint('0.05%') },
    brands: [b('Dermovate', 'GSK', ['cream', 'oint']), b('Clobederm', 'Wilshire', ['cream'])],
  },
  {
    generic: 'Hydrocortisone',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('1%'), oint: oint('1%') },
    brands: [b('Cortaid', 'Wilshire', ['cream']), b('Dermacort', 'Hilton', ['cream'])],
  },
  {
    generic: 'Mometasone',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('0.1%'), lotion: lotion('0.1%') },
    brands: [b('Elocon', 'MSD', ['cream', 'lotion']), b('Momet', 'Wilshire', ['cream'])],
  },
  {
    generic: 'Clotrimazole',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('1%'), lotion: lotion('1%') },
    brands: [b('Canesten', 'Bayer', ['cream']), b('Candid', 'Wilshire', ['cream', 'lotion'])],
  },
  {
    generic: 'Miconazole',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('2%') },
    brands: [b('Daktarin', 'Barrett Hodgson'), b('Mico', 'Wilshire')],
  },
  {
    generic: 'Ketoconazole',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('2%'), lotion: lotion('2%'), tab: tab('200mg') },
    brands: [
      b('Nizoral', 'Barrett Hodgson', ['cream', 'lotion']),
      b('Ketomed', 'Wilshire', ['cream']),
    ],
  },
  {
    generic: 'Terbinafine',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('1%'), tab: tab('250mg') },
    brands: [b('Lamisil', 'Novartis', ['cream', 'tab']), b('Terbin', 'Wilshire', ['cream'])],
  },
  {
    generic: 'Betamethasone + Clotrimazole + Gentamicin',
    category: CAT.derma,
    presentations: { cream: cream(null) },
    brands: [b('Betaderm-GM', 'Wilshire'), b('Triderm', 'Hilton')],
  },
  {
    generic: 'Polymyxin B + Bacitracin',
    category: CAT.derma,
    presentations: { oint: oint(null) },
    brands: [b('Polyfax', 'GSK'), b('Polybiotic', 'Wilshire')],
  },
  {
    generic: 'Silver Sulfadiazine',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('1%') },
    brands: [b('Flamazine', 'Wilshire'), b('Silverex', 'Hilton')],
  },
  {
    generic: 'Adapalene',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { gel: gel('0.1%') },
    brands: [b('Differin', 'Barrett Hodgson'), b('Adaferin', 'Wilshire')],
  },
  {
    generic: 'Benzoyl Peroxide',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { gel: gel('2.5%', '5%') },
    brands: [b('Benzac', 'Galderma'), b('Acnil', 'Wilshire')],
  },
  {
    generic: 'Clindamycin (Topical)',
    category: CAT.derma,
    presentations: { gel: gel('1%'), lotion: lotion('1%') },
    brands: [b('Clindatop', 'Wilshire', ['gel']), b('Clinda', 'Hilton', ['gel', 'lotion'])],
  },
  {
    generic: 'Isotretinoin',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cap: cap('10mg', '20mg') },
    brands: [b('Roaccutane', 'Roche'), b('Isotane', 'Wilshire')],
  },
  {
    generic: 'Permethrin',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { lotion: lotion('5%') },
    brands: [b('Lotrix', 'Wilshire'), b('Scabex', 'Hilton')],
  },
  {
    generic: 'Calamine',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { lotion: lotion(null) },
    brands: [b('Calamine Lotion', 'Wilshire')],
  },
  {
    generic: 'Tacrolimus (Topical)',
    category: CAT.derma,
    presentations: { oint: oint('0.03%', '0.1%') },
    brands: [b('Protopic', 'Astellas'), b('Tacroz', 'Wilshire')],
  },
  {
    generic: 'Fusidic Acid + Betamethasone',
    category: CAT.derma,
    presentations: { cream: cream(null) },
    brands: [b('Fucicort', 'LEO Pharma'), b('Fucibet', 'Wilshire')],
  },

  /* ---------------------------------------------------------------------- */
  /* 11. EYE & EAR                                                           */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Chloramphenicol (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.5%'), oint: oint('1%') },
    brands: [b('Chloromycetin', 'Barrett Hodgson', ['drops', 'oint']), b('Optichlor', 'Wilshire', ['drops'])],
  },
  {
    generic: 'Ciprofloxacin (Eye/Ear)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.3%') },
    brands: [b('Ciloxan', 'Novartis'), b('Ciprocin', 'Wilshire'), b('Ciproxin Eye', 'Bayer')],
  },
  {
    generic: 'Moxifloxacin (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.5%') },
    brands: [b('Vigamox', 'Novartis'), b('Moxicin', 'Wilshire')],
  },
  {
    generic: 'Gatifloxacin (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.3%') },
    brands: [b('Zymar', 'Allergan'), b('Gatilox', 'Wilshire')],
  },
  {
    generic: 'Tobramycin (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.3%') },
    brands: [b('Tobrex', 'Novartis'), b('Tobra', 'Wilshire')],
  },
  {
    generic: 'Tobramycin + Dexamethasone (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops(null) },
    brands: [b('Tobradex', 'Novartis'), b('Tobrasone', 'Wilshire')],
  },
  {
    generic: 'Prednisolone (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('1%') },
    brands: [b('Pred Forte', 'Allergan'), b('Predni', 'Wilshire')],
  },
  {
    generic: 'Olopatadine (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.1%') },
    brands: [b('Patanol', 'Novartis'), b('Olopat', 'Wilshire')],
  },
  {
    generic: 'Carboxymethylcellulose (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.5%') },
    brands: [b('Refresh Tears', 'Allergan'), b('Tears Plus', 'Wilshire'), b('Optive', 'Allergan')],
  },
  {
    generic: 'Timolol (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.5%') },
    brands: [b('Timoptic', 'Barrett Hodgson'), b('Glucomol', 'Wilshire')],
  },
  {
    generic: 'Latanoprost (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.005%') },
    brands: [b('Xalatan', 'Pfizer'), b('Latacom', 'Wilshire')],
  },
  {
    generic: 'Xylometazoline',
    category: CAT.eyeear,
    includeGeneric: true,
    presentations: { drops: drops('0.05%', '0.1%'), spray: spray('0.1%') },
    brands: [
      b('Otrivin', 'GSK', ['drops', 'spray']),
      b('Nasivion', 'Merck', ['drops']),
      b('Xylo', 'Wilshire', ['drops']),
    ],
  },
  {
    generic: 'Ofloxacin (Ear)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.3%') },
    brands: [b('Otowaxol', 'Wilshire'), b('Oflox Ear', 'Hilton')],
  },

  /* ---------------------------------------------------------------------- */
  /* 12. ANTIFUNGALS, ANTHELMINTICS & ANTIVIRALS (systemic)                  */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Fluconazole',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('50mg', '150mg', '200mg'), susp: susp('50mg/5ml') },
    brands: [
      b('Diflucan', 'Pfizer', ['cap']),
      b('Flucon', 'Wilshire', ['cap']),
      b('Fungone', 'Hilton', ['cap']),
      b('Canzol', 'Genix Pharma', ['cap']),
    ],
  },
  {
    generic: 'Itraconazole',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('100mg') },
    brands: [b('Sporanox', 'Barrett Hodgson'), b('Itracon', 'Wilshire')],
  },
  {
    generic: 'Griseofulvin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('125mg', '250mg', '500mg') },
    brands: [b('Grisovin', 'GSK'), b('Grisof', 'Wilshire')],
  },
  {
    generic: 'Nystatin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { susp: susp('100000IU/ml') },
    brands: [b('Mycostatin', 'Barrett Hodgson'), b('Nystin', 'Wilshire')],
  },
  {
    generic: 'Albendazole',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('200mg', '400mg'), susp: susp('200mg/5ml') },
    brands: [b('Zentel', 'GSK', ['tab', 'susp']), b('Albezol', 'Wilshire', ['tab', 'susp'])],
  },
  {
    generic: 'Mebendazole',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('100mg', '500mg'), susp: susp('100mg/5ml') },
    brands: [b('Vermox', 'Barrett Hodgson', ['tab', 'susp']), b('Wormin', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Pyrantel Pamoate',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { susp: susp('250mg/5ml'), tab: tab('250mg') },
    brands: [b('Combantrin', 'Pfizer', ['susp']), b('Pyrantin', 'Wilshire', ['susp'])],
  },
  {
    generic: 'Acyclovir',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('200mg', '400mg', '800mg'), cream: cream('5%') },
    brands: [
      b('Zovirax', 'GSK', ['tab', 'cream']),
      b('Acyvir', 'Wilshire', ['tab', 'cream']),
      b('Herpevir', 'Hilton', ['tab']),
    ],
  },
  {
    generic: 'Valacyclovir',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('500mg', '1000mg') },
    brands: [b('Valtrex', 'GSK'), b('Valvir', 'Wilshire')],
  },
  {
    generic: 'Oseltamivir',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('30mg', '45mg', '75mg') },
    brands: [b('Tamiflu', 'Roche'), b('Fluvir', 'Wilshire')],
  },
  {
    generic: 'Hydroxychloroquine',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('200mg', '400mg') },
    brands: [b('Plaquenil', 'Sanofi'), b('HCQ', 'Wilshire')],
  },
  {
    generic: 'Artemether + Lumefantrine',
    category: CAT.antibiotics,
    presentations: { tab: tab('20mg+120mg', '80mg+480mg') },
    brands: [b('Coartem', 'Novartis'), b('Artem', 'Wilshire')],
  },


  /* ---------------------------------------------------------------------- */
  /* 13. WOMEN'S HEALTH & GYNAECOLOGY                                        */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Dydrogesterone',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('10mg') },
    brands: [b('Duphaston', 'Abbott'), b('Dydro', 'Wilshire')],
  },
  {
    generic: 'Norethisterone',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('5mg') },
    brands: [b('Primolut N', 'Bayer'), b('Regestrone', 'Wilshire')],
  },
  {
    generic: 'Medroxyprogesterone',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('10mg'), inj: inj('150mg/ml') },
    brands: [b('Provera', 'Pfizer', ['tab']), b('Depo-Provera', 'Pfizer', ['inj'])],
  },
  {
    generic: 'Progesterone',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { cap: cap('100mg', '200mg'), inj: inj('50mg/ml') },
    brands: [b('Utrogestan', 'Barrett Hodgson', ['cap']), b('Gestone', 'Wilshire', ['inj'])],
  },
  {
    generic: 'Clomifene',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('50mg') },
    brands: [b('Clomid', 'Sanofi'), b('Fertab', 'Wilshire')],
  },
  {
    generic: 'Tranexamic Acid',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('500mg'), inj: inj('500mg/5ml') },
    brands: [b('Transamin', 'Sami', ['tab', 'inj']), b('Trenaxa', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Clotrimazole (Vaginal)',
    category: CAT.womens,
    presentations: { tab: tab('100mg', '500mg') },
    brands: [b('Canesten VT', 'Bayer'), b('Candi V', 'Wilshire')],
  },
  {
    generic: 'Ethinylestradiol + Levonorgestrel',
    category: CAT.womens,
    presentations: { tab: tab(null) },
    brands: [b('Nordette', 'Pfizer'), b('Famila', 'DKT')],
  },
  {
    generic: 'Levonorgestrel',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('0.75mg', '1.5mg') },
    brands: [b('Emkit', 'DKT'), b('Nidzo', 'Wilshire')],
  },
  {
    generic: 'Sildenafil',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg', '100mg') },
    brands: [b('Viagra', 'Pfizer'), b('Sildec', 'Wilshire'), b('Erecto', 'Hilton')],
  },
  {
    generic: 'Tadalafil',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg', '20mg') },
    brands: [b('Cialis', 'Eli Lilly'), b('Tadec', 'Wilshire')],
  },

  /* ---------------------------------------------------------------------- */
  /* 14. UROLOGY & NEPHROLOGY                                                */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Tamsulosin',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { cap: cap('0.4mg') },
    brands: [b('Flomax', 'Barrett Hodgson'), b('Uromax', 'Wilshire'), b('Tamsol', 'Hilton')],
  },
  {
    generic: 'Finasteride',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('1mg', '5mg') },
    brands: [b('Proscar', 'MSD'), b('Finast', 'Wilshire')],
  },
  {
    generic: 'Dutasteride',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { cap: cap('0.5mg') },
    brands: [b('Avodart', 'GSK'), b('Dutas', 'Wilshire')],
  },
  {
    generic: 'Solifenacin',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Vesicare', 'Astellas'), b('Soli', 'Wilshire')],
  },
  {
    generic: 'Oxybutynin',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('5mg') },
    brands: [b('Ditropan', 'Barrett Hodgson')],
  },
  {
    generic: 'Potassium Citrate',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { syr: syr(null), sachet: sachet(null) },
    brands: [b('Uralyt-U', 'Wilshire', ['sachet']), b('K-Citra', 'Hilton', ['syr'])],
  },
  {
    generic: 'Allopurinol',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('100mg', '300mg') },
    brands: [b('Zyloric', 'Aspen'), b('Allopur', 'Wilshire')],
  },
  {
    generic: 'Febuxostat',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('40mg', '80mg') },
    brands: [b('Feburic', 'Getz Pharma'), b('Uric', 'Wilshire')],
  },
  {
    generic: 'Colchicine',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('0.5mg') },
    brands: [b('Colcin', 'Wilshire'), b('Goutnil', 'Hilton')],
  },

  /* ---------------------------------------------------------------------- */
  /* 15. HORMONES & THYROID                                                  */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Levothyroxine',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: {
      tab: tab('25mcg', '50mcg', '75mcg', '88mcg', '100mcg', '112mcg', '125mcg', '150mcg', '200mcg'),
    },
    brands: [b('Thyroxine', 'GSK'), b('Euthyrox', 'Merck'), b('Eltroxin', 'GSK')],
  },
  {
    generic: 'Carbimazole',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Neo-Mercazole', 'Wilshire'), b('Carbizol', 'Hilton')],
  },
  {
    generic: 'Prednisolone',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('5mg'), syr: syr('15mg/5ml') },
    brands: [b('Deltacortril', 'Pfizer', ['tab']), b('Predfoam', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Methylprednisolone',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('4mg', '16mg'), inj: inj('40mg', '125mg', '500mg') },
    brands: [b('Medrol', 'Pfizer', ['tab']), b('Solu-Medrol', 'Pfizer', ['inj'])],
  },
  {
    generic: 'Dexamethasone',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('0.5mg', '4mg'), inj: inj('4mg/ml') },
    brands: [b('Decadron', 'Wilshire', ['tab', 'inj']), b('Dexa', 'Hilton', ['inj'])],
  },
  {
    generic: 'Hydrocortisone (Systemic)',
    category: CAT.hormones,
    presentations: { inj: inj('100mg', '250mg') },
    brands: [b('Solu-Cortef', 'Pfizer')],
  },
  {
    generic: 'Deflazacort',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('6mg', '30mg') },
    brands: [b('Calcort', 'Sanofi'), b('Deflaz', 'Wilshire')],
  },

  /* ---------------------------------------------------------------------- */
  /* 16. PEDIATRICS (paediatric-specific presentations)                      */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Oral Rehydration Salts',
    category: CAT.pediatrics,
    presentations: { sachet: sachet(null) },
    brands: [b('ORS', 'Wilshire'), b('Nimkol', 'Herbion'), b('Peditral', 'Barrett Hodgson')],
  },
  {
    generic: 'Zinc + ORS',
    category: CAT.pediatrics,
    presentations: { sachet: sachet(null) },
    brands: [b('Zincat ORS', 'Wilshire')],
  },
  {
    generic: 'Saccharomyces Boulardii',
    category: CAT.pediatrics,
    includeGeneric: true,
    presentations: { sachet: sachet('250mg'), cap: cap('250mg') },
    brands: [b('Enterogermina', 'Sanofi', ['sachet']), b('Bioflor', 'Wilshire', ['sachet', 'cap'])],
  },
  {
    generic: 'Simethicone (Infant)',
    category: CAT.pediatrics,
    presentations: { drops: drops('40mg/ml') },
    brands: [b('Colic Drops', 'Wilshire'), b('Infacol', 'Hilton')],
  },
  {
    generic: 'Cyproheptadine',
    category: CAT.pediatrics,
    includeGeneric: true,
    presentations: { syr: syr('2mg/5ml'), tab: tab('4mg') },
    brands: [b('Periactin', 'Barrett Hodgson', ['syr', 'tab']), b('Ciplactin', 'Wilshire', ['syr'])],
  },

  /* ---------------------------------------------------------------------- */
  /* 17. MORE COMMON MOLECULES (deepening the everyday shelf)                */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Ezetimibe',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('10mg') },
    brands: [b('Ezetrol', 'MSD'), b('Eze', 'Wilshire')],
  },
  {
    generic: 'Atorvastatin + Ezetimibe',
    category: CAT.cardio,
    presentations: { tab: tab('10mg+10mg', '20mg+10mg') },
    brands: [b('Atozet', 'MSD'), b('Ezelip', 'Getz Pharma')],
  },
  {
    generic: 'Ticagrelor',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('90mg') },
    brands: [b('Brilinta', 'AstraZeneca'), b('Tigrel', 'Getz Pharma')],
  },
  {
    generic: 'Pentoxifylline',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('400mg') },
    brands: [b('Trental', 'Sanofi'), b('Pentox', 'Wilshire')],
  },
  {
    generic: 'Cilostazol',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '100mg') },
    brands: [b('Pletaal', 'Barrett Hodgson'), b('Cilo', 'Wilshire')],
  },
  {
    generic: 'Methyldopa',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('250mg') },
    brands: [b('Aldomet', 'Wilshire'), b('Dopamet', 'Hilton')],
  },
  {
    generic: 'Acarbose',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '100mg') },
    brands: [b('Glucobay', 'Bayer'), b('Acar', 'Wilshire')],
  },
  {
    generic: 'Repaglinide',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('0.5mg', '1mg', '2mg') },
    brands: [b('NovoNorm', 'Novo Nordisk'), b('Repa', 'Wilshire')],
  },
  {
    generic: 'Teneligliptin',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('20mg') },
    brands: [b('Tenelia', 'Getz Pharma'), b('Tenli', 'Wilshire')],
  },
  {
    generic: 'Betamethasone (Systemic)',
    category: CAT.hormones,
    presentations: { inj: inj('4mg/ml') },
    brands: [b('Betnesol', 'GSK'), b('Betaject', 'Wilshire')],
  },
  {
    generic: 'Domperidone + Paracetamol',
    category: CAT.pain,
    presentations: { tab: tab(null) },
    brands: [b('Motifar', 'Wilshire')],
  },
  {
    generic: 'Rebamipide',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('100mg') },
    brands: [b('Mucosta', 'Sami'), b('Rebagen', 'Wilshire')],
  },
  {
    generic: 'Trimebutine',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('100mg', '200mg') },
    brands: [b('Debridat', 'Wilshire'), b('Trime', 'Hilton')],
  },
  {
    generic: 'Cinnarizine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '75mg') },
    brands: [b('Stugeron', 'Barrett Hodgson'), b('Cinna', 'Wilshire')],
  },
  {
    generic: 'Baclofen',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '25mg') },
    brands: [b('Lioresal', 'Novartis'), b('Baclo', 'Wilshire')],
  },
  {
    generic: 'Orphenadrine',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { inj: inj('30mg/ml') },
    brands: [b('Norflex', 'Wilshire')],
  },
  {
    generic: 'Diacerein',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { cap: cap('50mg') },
    brands: [b('Artrodar', 'Sami'), b('Diacer', 'Wilshire')],
  },
  {
    generic: 'Glucosamine + Chondroitin',
    category: CAT.pain,
    presentations: { tab: tab(null) },
    brands: [b('Cartigen', 'Wilshire'), b('Osteocare', 'Hilton')],
  },
  {
    generic: 'Rupatadine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('10mg') },
    brands: [b('Rupafin', 'Getz Pharma'), b('Rupa', 'Wilshire')],
  },
  {
    generic: 'Fexofenadine + Pseudoephedrine',
    category: CAT.allergy,
    presentations: { tab: tab('60mg+120mg') },
    brands: [b('Telfast-D', 'Sanofi'), b('Fexo-Plus', 'Getz Pharma')],
  },
  {
    generic: 'Mometasone (Nasal)',
    category: CAT.allergy,
    presentations: { spray: spray('50mcg') },
    brands: [b('Nasonex', 'MSD'), b('Momeflo', 'Wilshire')],
  },
  {
    generic: 'Fluticasone (Nasal)',
    category: CAT.allergy,
    presentations: { spray: spray('50mcg') },
    brands: [b('Flixonase', 'GSK'), b('Flutinaz', 'Wilshire')],
  },


  /* ---------------------------------------------------------------------- */
  /* 18. WAVE 2 — broader therapeutic coverage                              */
  /* ---------------------------------------------------------------------- */

  /* Cardiovascular (additional) */
  {
    generic: 'Prazosin',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('1mg', '2mg', '5mg') },
    brands: [b('Minipress', 'Pfizer'), b('Prazo', 'Wilshire')],
  },
  {
    generic: 'Terazosin',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('2mg', '5mg') },
    brands: [b('Hytrin', 'Abbott'), b('Teraz', 'Wilshire')],
  },
  {
    generic: 'Clonidine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('100mcg', '150mcg') },
    brands: [b('Catapres', 'Boehringer Ingelheim')],
  },
  {
    generic: 'Amiodarone',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('100mg', '200mg'), inj: inj('150mg/3ml') },
    brands: [b('Cordarone', 'Sanofi', ['tab', 'inj']), b('Amiogard', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Gemfibrozil',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('600mg'), cap: cap('300mg') },
    brands: [b('Lopid', 'Pfizer', ['tab']), b('Gemfi', 'Wilshire', ['cap'])],
  },
  {
    generic: 'Apixaban',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('2.5mg', '5mg') },
    brands: [b('Eliquis', 'Pfizer'), b('Apixa', 'Getz Pharma')],
  },
  {
    generic: 'Dabigatran',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { cap: cap('75mg', '110mg', '150mg') },
    brands: [b('Pradaxa', 'Boehringer Ingelheim')],
  },
  {
    generic: 'Telmisartan + Amlodipine',
    category: CAT.cardio,
    presentations: { tab: tab('40mg+5mg', '80mg+5mg') },
    brands: [b('Twynsta', 'Boehringer Ingelheim'), b('Telma-AM', 'Getz Pharma')],
  },
  {
    generic: 'Olmesartan + Amlodipine',
    category: CAT.cardio,
    presentations: { tab: tab('20mg+5mg', '40mg+5mg') },
    brands: [b('Sevikar', 'Barrett Hodgson'), b('Olmec-AM', 'Getz Pharma')],
  },
  {
    generic: 'Bisoprolol + Hydrochlorothiazide',
    category: CAT.cardio,
    presentations: { tab: tab('5mg+6.25mg', '10mg+6.25mg') },
    brands: [b('Concor Plus', 'Merck')],
  },

  /* Gastro / hepatobiliary (additional) */
  {
    generic: 'Dicyclomine',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('10mg'), inj: inj('10mg/ml') },
    brands: [b('Bentyl', 'Wilshire', ['tab']), b('Colicaid', 'Hilton', ['tab'])],
  },
  {
    generic: 'Racecadotril',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { cap: cap('100mg'), sachet: sachet('10mg', '30mg') },
    brands: [b('Hidrasec', 'Wilshire', ['cap', 'sachet'])],
  },
  {
    generic: 'Rifaximin',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('200mg', '550mg') },
    brands: [b('Rifagut', 'Sami'), b('Ximin', 'Wilshire')],
  },
  {
    generic: 'Ursodeoxycholic Acid',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('250mg', '300mg'), cap: cap('300mg') },
    brands: [b('Urso', 'Wilshire', ['cap']), b('Udiliv', 'Hilton', ['tab'])],
  },
  {
    generic: 'Pancreatin',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { cap: cap('10000IU', '25000IU') },
    brands: [b('Creon', 'Abbott'), b('Pancrin', 'Wilshire')],
  },
  {
    generic: 'Silymarin',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('140mg'), cap: cap('140mg') },
    brands: [b('Legalon', 'Wilshire', ['cap']), b('Silybon', 'Hilton', ['tab'])],
  },
  {
    generic: 'L-Ornithine L-Aspartate',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { sachet: sachet('3g'), inj: inj('5g/10ml') },
    brands: [b('Hepa-Merz', 'Merck', ['sachet', 'inj'])],
  },
  {
    generic: 'Esomeprazole + Domperidone',
    category: CAT.gastro,
    presentations: { cap: cap('20mg+30mg', '40mg+30mg') },
    brands: [b('Nexum-D', 'Getz Pharma'), b('Esso-D', 'Hilton')],
  },
  {
    generic: 'Omeprazole + Domperidone',
    category: CAT.gastro,
    presentations: { cap: cap('20mg+10mg') },
    brands: [b('Risek Insta', 'Getz Pharma'), b('Omedom', 'Wilshire')],
  },

  /* Respiratory / ENT (additional) */
  {
    generic: 'Levosalbutamol',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { syr: syr('1mg/5ml'), tab: tab('1mg') },
    brands: [b('Levolin', 'Wilshire', ['syr']), b('Levosal', 'Hilton', ['syr'])],
  },
  {
    generic: 'Montelukast + Levocetirizine',
    category: CAT.respiratory,
    presentations: { tab: tab('10mg+5mg'), syr: syr('4mg+2.5mg/5ml') },
    brands: [b('Montiget-L', 'Getz Pharma', ['tab', 'syr']), b('Myteka-L', 'Sami', ['tab'])],
  },
  {
    generic: 'Terbutaline',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { syr: syr('1.5mg/5ml'), tab: tab('2.5mg') },
    brands: [b('Bricanyl', 'AstraZeneca', ['syr', 'tab'])],
  },
  {
    generic: 'Ipratropium + Salbutamol',
    category: CAT.respiratory,
    presentations: { inhaler: inhaler(null) },
    brands: [b('Combivent', 'Boehringer Ingelheim'), b('Duolin', 'Wilshire')],
  },

  /* CNS (additional) */
  {
    generic: 'Topiramate',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg', '100mg') },
    brands: [b('Topamax', 'Barrett Hodgson'), b('Topira', 'Wilshire')],
  },
  {
    generic: 'Oxcarbazepine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('150mg', '300mg', '600mg'), syr: syr('300mg/5ml') },
    brands: [b('Trileptal', 'Novartis', ['tab', 'syr']), b('Oxcarb', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Memantine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '20mg') },
    brands: [b('Ebixa', 'Barrett Hodgson'), b('Meman', 'Wilshire')],
  },
  {
    generic: 'Pramipexole',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('0.125mg', '0.25mg', '1mg') },
    brands: [b('Mirapex', 'Barrett Hodgson'), b('Prami', 'Wilshire')],
  },
  {
    generic: 'Trihexyphenidyl',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('2mg', '5mg') },
    brands: [b('Artane', 'Wilshire'), b('Pacitane', 'Hilton')],
  },
  {
    generic: 'Buspirone',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Buspar', 'Wilshire')],
  },
  {
    generic: 'Modafinil',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('100mg', '200mg') },
    brands: [b('Provigil', 'Wilshire'), b('Modafil', 'Hilton')],
  },
  {
    generic: 'Phenobarbital',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('30mg', '60mg') },
    brands: [b('Luminal', 'Wilshire')],
  },
  {
    generic: 'Clobazam',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Frisium', 'Sanofi'), b('Clobam', 'Wilshire')],
  },

  /* Dermatology (additional) */
  {
    generic: 'Tretinoin',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('0.025%', '0.05%'), gel: gel('0.025%') },
    brands: [b('Retin-A', 'Barrett Hodgson', ['cream']), b('Aberel', 'Wilshire', ['cream'])],
  },
  {
    generic: 'Azelaic Acid',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('20%'), gel: gel('15%') },
    brands: [b('Skinoren', 'Bayer', ['cream'])],
  },
  {
    generic: 'Hydroquinone',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('2%', '4%') },
    brands: [b('Melalite', 'Wilshire'), b('Eldopaque', 'Hilton')],
  },
  {
    generic: 'Minoxidil',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { lotion: lotion('2%', '5%'), spray: spray('5%') },
    brands: [b('Rogaine', 'Wilshire', ['lotion']), b('Mintop', 'Hilton', ['lotion', 'spray'])],
  },
  {
    generic: 'Luliconazole',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('1%') },
    brands: [b('Lulit', 'Wilshire'), b('Lulican', 'Hilton')],
  },
  {
    generic: 'Sertaconazole',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('2%') },
    brands: [b('Onabet', 'Wilshire'), b('Zalain', 'Hilton')],
  },
  {
    generic: 'Framycetin',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('1%'), oint: oint('1%') },
    brands: [b('Soframycin', 'Sanofi', ['cream', 'oint'])],
  },
  {
    generic: 'Urea (Topical)',
    category: CAT.derma,
    presentations: { cream: cream('10%', '20%') },
    brands: [b('Uremol', 'Wilshire'), b('Kerato', 'Hilton')],
  },

  /* Eye (additional) */
  {
    generic: 'Brimonidine (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.2%') },
    brands: [b('Alphagan', 'Allergan'), b('Brimo', 'Wilshire')],
  },
  {
    generic: 'Dorzolamide + Timolol (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops(null) },
    brands: [b('Cosopt', 'Barrett Hodgson'), b('Dortim', 'Wilshire')],
  },
  {
    generic: 'Nepafenac (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.1%') },
    brands: [b('Nevanac', 'Novartis')],
  },
  {
    generic: 'Sodium Cromoglicate (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('2%') },
    brands: [b('Cromo', 'Wilshire'), b('Opticrom', 'Hilton')],
  },
  {
    generic: 'Bimatoprost (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.03%') },
    brands: [b('Lumigan', 'Allergan')],
  },

  /* Women's / obstetric (additional) */
  {
    generic: 'Misoprostol',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('200mcg') },
    brands: [b('Cytotec', 'Pfizer'), b('Misotab', 'Wilshire')],
  },
  {
    generic: 'Methylergometrine',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('0.125mg'), inj: inj('0.2mg/ml') },
    brands: [b('Methergine', 'Novartis', ['tab', 'inj'])],
  },
  {
    generic: 'Estradiol Valerate',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('1mg', '2mg') },
    brands: [b('Progynova', 'Bayer')],
  },
  {
    generic: 'Tibolone',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('2.5mg') },
    brands: [b('Livial', 'Barrett Hodgson'), b('Tibofem', 'Wilshire')],
  },
  {
    generic: 'Dienogest',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('2mg') },
    brands: [b('Visanne', 'Bayer')],
  },

  /* Antibacterials / anti-infectives (additional) */
  {
    generic: 'Nitazoxanide',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('500mg'), susp: susp('100mg/5ml') },
    brands: [b('Nizonide', 'Wilshire', ['tab', 'susp']), b('Nitax', 'Hilton', ['tab'])],
  },
  {
    generic: 'Fosfomycin',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { sachet: sachet('3g') },
    brands: [b('Monurol', 'Wilshire'), b('Fosfo', 'Hilton')],
  },
  {
    generic: 'Cefdinir',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('300mg'), susp: susp('125mg/5ml') },
    brands: [b('Cefdi', 'Getz Pharma', ['cap', 'susp']), b('Adinir', 'Wilshire', ['cap'])],
  },
  {
    generic: 'Dicloxacillin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('250mg', '500mg') },
    brands: [b('Diclocil', 'Barrett Hodgson'), b('Diclomax', 'Wilshire')],
  },
  {
    generic: 'Benzathine Penicillin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('1200000IU', '2400000IU') },
    brands: [b('Penidure', 'Wilshire'), b('Retarpen', 'Sandoz')],
  },
  {
    generic: 'Chloramphenicol',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('250mg') },
    brands: [b('Chloromycetin', 'Barrett Hodgson')],
  },

  /* Anti-TB */
  {
    generic: 'Rifampicin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('150mg', '300mg') },
    brands: [b('Rifadin', 'Sanofi'), b('Rimactane', 'Sandoz')],
  },
  {
    generic: 'Isoniazid',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('100mg', '300mg') },
    brands: [b('Isozid', 'Wilshire')],
  },
  {
    generic: 'Ethambutol',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('400mg') },
    brands: [b('Myambutol', 'Wilshire')],
  },
  {
    generic: 'Pyrazinamide',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('500mg') },
    brands: [b('Pyzina', 'Wilshire')],
  },
  {
    generic: 'Rifampicin + Isoniazid + Pyrazinamide + Ethambutol',
    category: CAT.antibiotics,
    presentations: { tab: tab(null) },
    brands: [b('Myrin-P', 'Wilshire'), b('Rifater', 'Sanofi')],
  },

  /* Antimalarials */
  {
    generic: 'Chloroquine',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('250mg'), syr: syr('50mg/5ml') },
    brands: [b('Nivaquine', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Sulfadoxine + Pyrimethamine',
    category: CAT.antibiotics,
    presentations: { tab: tab('500mg+25mg') },
    brands: [b('Fansidar', 'Roche')],
  },

  /* Muscle relaxants / bone */
  {
    generic: 'Methocarbamol',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('500mg', '750mg') },
    brands: [b('Robinax', 'Wilshire'), b('Carbamol', 'Hilton')],
  },
  {
    generic: 'Eperisone',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('50mg') },
    brands: [b('Myonal', 'Sami'), b('Eperis', 'Wilshire')],
  },
  {
    generic: 'Alendronic Acid',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('70mg') },
    brands: [b('Fosamax', 'MSD'), b('Alenta', 'Wilshire')],
  },
  {
    generic: 'Risedronate',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('35mg') },
    brands: [b('Actonel', 'Sanofi')],
  },

  /* Supplements (additional) */
  {
    generic: 'Biotin',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Biotin Forte', 'Wilshire'), b('Hairfin', 'Hilton')],
  },
  {
    generic: 'Vitamin E',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { cap: cap('200IU', '400IU') },
    brands: [b('Evion', 'Merck'), b('E-Cap', 'Wilshire')],
  },
  {
    generic: 'Ginkgo Biloba',
    category: CAT.vitamins,
    presentations: { tab: tab('40mg', '120mg') },
    brands: [b('Tebonin', 'Wilshire'), b('Ginko', 'Hilton')],
  },
  {
    generic: 'Silymarin + Vitamin B Complex',
    category: CAT.vitamins,
    presentations: { tab: tab(null) },
    brands: [b('Essentiale', 'Sanofi'), b('Livomax', 'Wilshire')],
  },
  {
    generic: 'Magnesium + Vitamin B6',
    category: CAT.vitamins,
    presentations: { tab: tab(null) },
    brands: [b('Magne-B6', 'Sanofi'), b('Magvit', 'Wilshire')],
  },
  {
    generic: 'L-Carnitine',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { syr: syr('500mg/5ml'), tab: tab('500mg') },
    brands: [b('Carnil', 'Wilshire', ['syr'])],
  },
  {
    generic: 'Glutathione',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { inj: inj('600mg'), tab: tab('500mg') },
    brands: [b('Gluta', 'Wilshire', ['inj', 'tab'])],
  },


  /* ---------------------------------------------------------------------- */
  /* 19. WAVE 3 — further everyday molecules                                */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Levofloxacin (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.5%') },
    brands: [b('Oftaquix', 'Wilshire'), b('Levoeye', 'Hilton')],
  },
  {
    generic: 'Prednisolone + Neomycin (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops(null) },
    brands: [b('Predmet-N', 'Wilshire')],
  },
  {
    generic: 'Naphazoline + Pheniramine (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops(null) },
    brands: [b('Naphcon-A', 'Novartis'), b('Visine', 'Wilshire')],
  },
  {
    generic: 'Betahistine + Ginkgo',
    category: CAT.cns,
    presentations: { tab: tab(null) },
    brands: [b('Vertigo', 'Wilshire')],
  },
  {
    generic: 'Flupentixol + Melitracen',
    category: CAT.cns,
    presentations: { tab: tab(null) },
    brands: [b('Deanxit', 'Lundbeck'), b('Franxit', 'Wilshire')],
  },
  {
    generic: 'Amisulpride',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '200mg', '400mg') },
    brands: [b('Solian', 'Sanofi'), b('Amisul', 'Wilshire')],
  },
  {
    generic: 'Lithium Carbonate',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('300mg', '400mg') },
    brands: [b('Priadel', 'Wilshire')],
  },
  {
    generic: 'Chlordiazepoxide + Clidinium',
    category: CAT.gastro,
    presentations: { tab: tab(null) },
    brands: [b('Librax', 'Searle'), b('Clidax', 'Wilshire')],
  },
  {
    generic: 'Alverine + Simethicone',
    category: CAT.gastro,
    presentations: { cap: cap(null) },
    brands: [b('Meteospasmyl', 'Wilshire')],
  },
  {
    generic: 'Levosulpiride',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '75mg') },
    brands: [b('Sulpitac', 'Wilshire'), b('Levosul', 'Hilton')],
  },
  {
    generic: 'Prucalopride',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('1mg', '2mg') },
    brands: [b('Resolor', 'Wilshire')],
  },
  {
    generic: 'Cholecalciferol + Calcium Carbonate',
    category: CAT.vitamins,
    presentations: { tab: tab(null), sachet: sachet(null) },
    brands: [b('Osnate-D', 'Sami', ['tab']), b('Calvid', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Calcitriol',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { cap: cap('0.25mcg', '0.5mcg') },
    brands: [b('Rocaltrol', 'Roche'), b('Calcit', 'Wilshire')],
  },
  {
    generic: 'Sevelamer',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('400mg', '800mg') },
    brands: [b('Renvela', 'Sanofi'), b('Sevmer', 'Wilshire')],
  },
  {
    generic: 'Erythropoietin',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { inj: inj('2000IU', '4000IU') },
    brands: [b('Eprex', 'Wilshire'), b('Recormon', 'Roche')],
  },
  {
    generic: 'Darbepoetin Alfa',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { inj: inj('40mcg') },
    brands: [b('Aranesp', 'Wilshire')],
  },
  {
    generic: 'Enoxaparin',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { inj: inj('40mg', '60mg', '80mg') },
    brands: [b('Clexane', 'Sanofi'), b('Enoxa', 'Wilshire')],
  },
  {
    generic: 'Heparin',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { inj: inj('5000IU/ml', '25000IU/5ml') },
    brands: [b('Heparin', 'Wilshire')],
  },
  {
    generic: 'Tranexamic Acid + Ethamsylate',
    category: CAT.womens,
    presentations: { tab: tab(null) },
    brands: [b('Styptovit', 'Wilshire')],
  },
  {
    generic: 'Ethamsylate',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('250mg', '500mg'), inj: inj('250mg/2ml') },
    brands: [b('Dicynone', 'Sanofi', ['tab', 'inj'])],
  },
  {
    generic: 'Cabergoline',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('0.5mg') },
    brands: [b('Dostinex', 'Pfizer'), b('Caber', 'Wilshire')],
  },
  {
    generic: 'Bromocriptine',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('2.5mg') },
    brands: [b('Parlodel', 'Wilshire')],
  },
  {
    generic: 'Desmopressin',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('0.1mg', '0.2mg'), spray: spray(null) },
    brands: [b('Minirin', 'Ferring', ['tab', 'spray'])],
  },
  {
    generic: 'Fludrocortisone',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('0.1mg') },
    brands: [b('Florinef', 'Wilshire')],
  },
  {
    generic: 'Triamcinolone',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { inj: inj('40mg/ml'), oint: oint('0.1%') },
    brands: [b('Kenacort', 'Barrett Hodgson', ['inj']), b('Kenacomb', 'Barrett Hodgson', ['oint'])],
  },
  {
    generic: 'Mecobalamin + Pregabalin',
    category: CAT.cns,
    presentations: { cap: cap('750mcg+75mg') },
    brands: [b('Zeegap Plus', 'Getz Pharma'), b('Gablin-M', 'Wilshire')],
  },
  {
    generic: 'Paracetamol + Chlorpheniramine + Phenylephrine',
    category: CAT.respiratory,
    presentations: { tab: tab(null), syr: syr(null) },
    brands: [
      b('Arinac', 'Abbott', ['tab']),
      b('Arinac Forte', 'Abbott', ['tab']),
      b('Coldrex', 'Wilshire', ['tab']),
    ],
  },
  {
    generic: 'Ibuprofen + Pseudoephedrine',
    category: CAT.respiratory,
    presentations: { tab: tab(null) },
    brands: [b('Arinac', 'Abbott'), b('Flu-Out', 'Wilshire')],
  },
  {
    generic: 'Loratadine + Pseudoephedrine',
    category: CAT.respiratory,
    presentations: { tab: tab(null) },
    brands: [b('Clarinase', 'Bayer'), b('Lorat-D', 'Wilshire')],
  },
  {
    generic: 'Diphenhydramine + Ammonium Chloride',
    category: CAT.respiratory,
    presentations: { syr: syr(null) },
    brands: [b('Hydryllin', 'Sanofi'), b('Coferb-DX', 'Herbion')],
  },
  {
    generic: 'Menthol + Eucalyptus (Chest Rub)',
    category: CAT.respiratory,
    presentations: { oint: oint(null) },
    brands: [b('Vicks VapoRub', 'Procter & Gamble'), b('Zam-Buk', 'Wilshire')],
  },
  {
    generic: 'Domperidone + Omeprazole',
    category: CAT.gastro,
    presentations: { cap: cap(null) },
    brands: [b('Risek Extra', 'Getz Pharma')],
  },
  {
    generic: 'Diclofenac + Paracetamol',
    category: CAT.pain,
    presentations: { tab: tab('50mg+500mg') },
    brands: [b('Dyclomol', 'Wilshire'), b('Cataflam Plus', 'Novartis')],
  },
  {
    generic: 'Diclofenac + Serratiopeptidase',
    category: CAT.pain,
    presentations: { tab: tab(null) },
    brands: [b('Dicloran-SP', 'Sami'), b('Serato', 'Wilshire')],
  },
  {
    generic: 'Serratiopeptidase',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Danzen', 'Wilshire')],
  },
  {
    generic: 'Betamethasone + Dexchlorpheniramine',
    category: CAT.allergy,
    presentations: { syr: syr(null), tab: tab(null) },
    brands: [b('Celestamine', 'Barrett Hodgson', ['syr', 'tab'])],
  },
  {
    generic: 'Domperidone (Drops)',
    category: CAT.pediatrics,
    presentations: { drops: drops('5mg/ml') },
    brands: [b('Motilium Drops', 'Barrett Hodgson')],
  },
  {
    generic: 'Iron + Folic Acid + Zinc',
    category: CAT.vitamins,
    presentations: { syr: syr(null), tab: tab(null) },
    brands: [b('Ferofol', 'Wilshire', ['syr']), b('Hemofer', 'Hilton', ['syr'])],
  },
  {
    generic: 'Lysine + Multivitamin',
    category: CAT.pediatrics,
    presentations: { syr: syr(null) },
    brands: [b('Ceelin Plus', 'Wilshire'), b('Appeton', 'Hilton')],
  },


  /* ---------------------------------------------------------------------- */
  /* 20. WAVE 4 — Hep C / antivirals, oncology-support, endocrine & more     */
  /* ---------------------------------------------------------------------- */

  /* Hepatitis C & antivirals — a very large segment in Pakistan */
  {
    generic: 'Sofosbuvir',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('400mg') },
    brands: [b('Sovaldi', 'Gilead'), b('Sofos', 'Ferozsons'), b('Hepcinat', 'Wilshire')],
  },
  {
    generic: 'Sofosbuvir + Velpatasvir',
    category: CAT.gastro,
    presentations: { tab: tab('400mg+100mg') },
    brands: [b('Epclusa', 'Gilead'), b('Velpanat', 'Ferozsons'), b('Sofolan-V', 'Wilshire')],
  },
  {
    generic: 'Sofosbuvir + Daclatasvir',
    category: CAT.gastro,
    presentations: { tab: tab('400mg+60mg') },
    brands: [b('Sovodak', 'Ferozsons'), b('Dacsof', 'Wilshire')],
  },
  {
    generic: 'Daclatasvir',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('30mg', '60mg') },
    brands: [b('Daklinza', 'Bristol Myers Squibb'), b('Daclahep', 'Wilshire')],
  },
  {
    generic: 'Ribavirin',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('200mg', '400mg'), cap: cap('200mg') },
    brands: [b('Ribavin', 'Ferozsons', ['tab']), b('Copegus', 'Roche', ['tab'])],
  },
  {
    generic: 'Entecavir',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('0.5mg', '1mg') },
    brands: [b('Baraclude', 'Bristol Myers Squibb'), b('Entavir', 'Wilshire')],
  },
  {
    generic: 'Tenofovir Disoproxil',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('300mg') },
    brands: [b('Viread', 'Gilead'), b('Tenof', 'Wilshire')],
  },

  /* Oncology-support & haematology */
  {
    generic: 'Tamoxifen',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '20mg') },
    brands: [b('Nolvadex', 'AstraZeneca'), b('Tamodex', 'Wilshire')],
  },
  {
    generic: 'Letrozole',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('2.5mg') },
    brands: [b('Femara', 'Novartis'), b('Letroz', 'Wilshire')],
  },
  {
    generic: 'Anastrozole',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('1mg') },
    brands: [b('Arimidex', 'AstraZeneca'), b('Anastro', 'Wilshire')],
  },
  {
    generic: 'Bicalutamide',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('50mg') },
    brands: [b('Casodex', 'AstraZeneca'), b('Bical', 'Wilshire')],
  },
  {
    generic: 'Imatinib',
    category: CAT.otc,
    includeGeneric: true,
    presentations: { tab: tab('100mg', '400mg') },
    brands: [b('Glivec', 'Novartis'), b('Imanib', 'Wilshire')],
  },
  {
    generic: 'Filgrastim',
    category: CAT.otc,
    includeGeneric: true,
    presentations: { inj: inj('300mcg') },
    brands: [b('Neupogen', 'Roche'), b('Grafeel', 'Wilshire')],
  },
  {
    generic: 'Ferric Carboxymaltose',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { inj: inj('500mg/10ml') },
    brands: [b('Ferinject', 'Wilshire'), b('Orofer FCM', 'Hilton')],
  },
  {
    generic: 'Phytomenadione',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { inj: inj('10mg/ml', '1mg/0.5ml') },
    brands: [b('Konakion', 'Roche'), b('Vitamin K', 'Wilshire')],
  },

  /* Cardio (further) */
  {
    generic: 'Sacubitril + Valsartan',
    category: CAT.cardio,
    presentations: { tab: tab('24mg+26mg', '49mg+51mg', '97mg+103mg') },
    brands: [b('Entresto', 'Novartis'), b('Sacuval', 'Getz Pharma')],
  },
  {
    generic: 'Ranolazine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('500mg') },
    brands: [b('Ranexa', 'Wilshire')],
  },
  {
    generic: 'Torsemide',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg', '20mg') },
    brands: [b('Torem', 'Wilshire'), b('Dytor', 'Hilton')],
  },
  {
    generic: 'Bumetanide',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('1mg') },
    brands: [b('Burinex', 'Wilshire')],
  },
  {
    generic: 'Hydralazine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg') },
    brands: [b('Apresoline', 'Wilshire')],
  },
  {
    generic: 'Labetalol',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('100mg', '200mg'), inj: inj('100mg/20ml') },
    brands: [b('Trandate', 'Wilshire', ['tab', 'inj'])],
  },
  {
    generic: 'Nadolol',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('40mg', '80mg') },
    brands: [b('Corgard', 'Wilshire')],
  },
  {
    generic: 'Eplerenone',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg') },
    brands: [b('Inspra', 'Pfizer'), b('Eplen', 'Wilshire')],
  },

  /* Diabetes (further) */
  {
    generic: 'Metformin + Glimepiride',
    category: CAT.diabetes,
    presentations: { tab: tab('500mg+1mg', '500mg+2mg') },
    brands: [b('Getryl-M', 'Getz Pharma'), b('Amaryl-M', 'Sanofi')],
  },
  {
    generic: 'Glipizide',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Glucotrol', 'Pfizer'), b('Glipiz', 'Wilshire')],
  },
  {
    generic: 'Canagliflozin',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('100mg', '300mg') },
    brands: [b('Invokana', 'Barrett Hodgson'), b('Canaget', 'Getz Pharma')],
  },
  {
    generic: 'Dapagliflozin + Metformin',
    category: CAT.diabetes,
    presentations: { tab: tab('5mg+500mg', '5mg+1000mg') },
    brands: [b('Xigduo', 'AstraZeneca'), b('Dapamet', 'Getz Pharma')],
  },
  {
    generic: 'Empagliflozin + Metformin',
    category: CAT.diabetes,
    presentations: { tab: tab('5mg+500mg', '12.5mg+500mg') },
    brands: [b('Jardiance Met', 'Boehringer Ingelheim'), b('Empamet', 'Getz Pharma')],
  },
  {
    generic: 'Liraglutide',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { inj: inj('6mg/ml') },
    brands: [b('Victoza', 'Novo Nordisk'), b('Saxenda', 'Novo Nordisk')],
  },

  /* CNS (further) */
  {
    generic: 'Bupropion',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('150mg') },
    brands: [b('Wellbutrin', 'GSK'), b('Bupron', 'Wilshire')],
  },
  {
    generic: 'Trazodone',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '100mg') },
    brands: [b('Desyrel', 'Wilshire'), b('Trazo', 'Hilton')],
  },
  {
    generic: 'Clomipramine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '75mg') },
    brands: [b('Anafranil', 'Novartis')],
  },
  {
    generic: 'Imipramine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('25mg') },
    brands: [b('Tofranil', 'Wilshire')],
  },
  {
    generic: 'Fluvoxamine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '100mg') },
    brands: [b('Faverin', 'Abbott'), b('Fluvox', 'Wilshire')],
  },
  {
    generic: 'Rivastigmine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { cap: cap('1.5mg', '3mg', '6mg') },
    brands: [b('Exelon', 'Novartis'), b('Rivas', 'Wilshire')],
  },
  {
    generic: 'Lurasidone',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('40mg', '80mg') },
    brands: [b('Latuda', 'Wilshire')],
  },
  {
    generic: 'Paliperidone',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('3mg', '6mg') },
    brands: [b('Invega', 'Barrett Hodgson')],
  },

  /* Dermatology (further) */
  {
    generic: 'Calcipotriol',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { oint: oint('0.005%') },
    brands: [b('Daivonex', 'LEO Pharma'), b('Calcip', 'Wilshire')],
  },
  {
    generic: 'Calcipotriol + Betamethasone',
    category: CAT.derma,
    presentations: { oint: oint(null), gel: gel(null) },
    brands: [b('Daivobet', 'LEO Pharma', ['oint']), b('Xamiol', 'LEO Pharma', ['gel'])],
  },
  {
    generic: 'Ivermectin',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { tab: tab('6mg', '12mg'), cream: cream('1%') },
    brands: [b('Ivenox', 'Wilshire', ['tab']), b('Soolantra', 'Galderma', ['cream'])],
  },
  {
    generic: 'Crotamiton',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('10%'), lotion: lotion('10%') },
    brands: [b('Eurax', 'Wilshire', ['cream', 'lotion'])],
  },
  {
    generic: 'Ciclopirox',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('1%'), lotion: lotion('8%') },
    brands: [b('Batrafen', 'Sanofi', ['cream'])],
  },
  {
    generic: 'Coal Tar',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { lotion: lotion(null), oint: oint(null) },
    brands: [b('Polytar', 'GSK', ['lotion'])],
  },
  {
    generic: 'Salicylic Acid',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { oint: oint('3%', '6%'), gel: gel('2%') },
    brands: [b('Salicylix', 'Wilshire', ['oint'])],
  },

  /* Eye (further) */
  {
    generic: 'Travoprost (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.004%') },
    brands: [b('Travatan', 'Novartis'), b('Travo', 'Wilshire')],
  },
  {
    generic: 'Ketorolac (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.5%') },
    brands: [b('Acular', 'Allergan'), b('Ketoeye', 'Wilshire')],
  },
  {
    generic: 'Azelastine (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.05%') },
    brands: [b('Optilast', 'Wilshire')],
  },
  {
    generic: 'Atropine (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('1%') },
    brands: [b('Atropine', 'Wilshire')],
  },
  {
    generic: 'Tropicamide (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('1%') },
    brands: [b('Mydriacyl', 'Novartis'), b('Tropime', 'Wilshire')],
  },

  /* Gastro (further) */
  {
    generic: 'Cinitapride',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('1mg', '3mg') },
    brands: [b('Cintapro', 'Wilshire'), b('Cinita', 'Hilton')],
  },
  {
    generic: 'Polyethylene Glycol',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { sachet: sachet(null) },
    brands: [b('Movicol', 'Wilshire'), b('Peglax', 'Hilton')],
  },
  {
    generic: 'Senna',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('7.5mg'), syr: syr(null) },
    brands: [b('Senokot', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Bismuth Subsalicylate',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { susp: susp(null), tab: tab(null) },
    brands: [b('Pepto-Bismol', 'Procter & Gamble', ['susp'])],
  },

  /* Endocrine (further) */
  {
    generic: 'Propylthiouracil',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('50mg') },
    brands: [b('PTU', 'Wilshire')],
  },
  {
    generic: 'Testosterone',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { inj: inj('250mg/ml') },
    brands: [b('Sustanon', 'Barrett Hodgson'), b('Testoviron', 'Bayer')],
  },
  {
    generic: 'Teriparatide',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { inj: inj('250mcg/ml') },
    brands: [b('Forteo', 'Eli Lilly')],
  },
  {
    generic: 'Cinacalcet',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('30mg', '60mg') },
    brands: [b('Sensipar', 'Wilshire'), b('Cinacal', 'Hilton')],
  },


  /* ---------------------------------------------------------------------- */
  /* 21. WAVE 5 — migraine, more anti-infectives, urology, supplements       */
  /* ---------------------------------------------------------------------- */

  /* Migraine & headache */
  {
    generic: 'Sumatriptan',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg', '100mg') },
    brands: [b('Imigran', 'GSK'), b('Suminat', 'Wilshire'), b('Migratan', 'Hilton')],
  },
  {
    generic: 'Rizatriptan',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Maxalt', 'MSD'), b('Rizact', 'Wilshire')],
  },
  {
    generic: 'Ergotamine + Caffeine',
    category: CAT.cns,
    presentations: { tab: tab('1mg+100mg') },
    brands: [b('Cafergot', 'Novartis'), b('Migril', 'Wilshire')],
  },
  {
    generic: 'Propranolol + Flunarizine',
    category: CAT.cns,
    presentations: { tab: tab(null) },
    brands: [b('Sibelium Plus', 'Barrett Hodgson')],
  },

  /* Anti-infectives (further) */
  {
    generic: 'Norfloxacin',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('400mg') },
    brands: [b('Noroxin', 'MSD'), b('Norflox', 'Wilshire')],
  },
  {
    generic: 'Ornidazole',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('500mg'), susp: susp('125mg/5ml') },
    brands: [b('Dazolic', 'Wilshire', ['tab']), b('Orni', 'Hilton', ['tab'])],
  },
  {
    generic: 'Ofloxacin + Ornidazole',
    category: CAT.antibiotics,
    presentations: { tab: tab('200mg+500mg'), susp: susp(null) },
    brands: [b('Oflocin-OZ', 'Wilshire', ['tab']), b('O2', 'Hilton', ['tab'])],
  },
  {
    generic: 'Ciprofloxacin + Tinidazole',
    category: CAT.antibiotics,
    presentations: { tab: tab('500mg+600mg') },
    brands: [b('Ciprozen-TZ', 'Wilshire')],
  },
  {
    generic: 'Cefprozil',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('250mg', '500mg'), susp: susp('250mg/5ml') },
    brands: [b('Cefzil', 'Barrett Hodgson', ['tab', 'susp'])],
  },
  {
    generic: 'Ceftibuten',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { cap: cap('400mg'), susp: susp('180mg/5ml') },
    brands: [b('Cedax', 'Wilshire', ['cap', 'susp'])],
  },
  {
    generic: 'Gemifloxacin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('320mg') },
    brands: [b('Factive', 'Getz Pharma'), b('Gemi', 'Wilshire')],
  },
  {
    generic: 'Cefoperazone',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('1g', '2g') },
    brands: [b('Cefobid', 'Pfizer'), b('Cefzone', 'Wilshire')],
  },
  {
    generic: 'Colistin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('1000000IU', '2000000IU') },
    brands: [b('Colistin', 'Wilshire')],
  },
  {
    generic: 'Imipenem + Cilastatin',
    category: CAT.antibiotics,
    presentations: { inj: inj('500mg+500mg') },
    brands: [b('Tienam', 'MSD'), b('Imicil', 'Getz Pharma')],
  },
  {
    generic: 'Spiramycin',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('1500000IU', '3000000IU') },
    brands: [b('Rovamycine', 'Sanofi')],
  },

  /* Urology / genito-urinary (further) */
  {
    generic: 'Vardenafil',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '20mg') },
    brands: [b('Levitra', 'Bayer'), b('Varden', 'Wilshire')],
  },
  {
    generic: 'Avanafil',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '100mg') },
    brands: [b('Avana', 'Wilshire')],
  },
  {
    generic: 'Alfuzosin',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('10mg') },
    brands: [b('Xatral', 'Sanofi'), b('Alfu', 'Wilshire')],
  },
  {
    generic: 'Silodosin',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { cap: cap('4mg', '8mg') },
    brands: [b('Urief', 'Wilshire'), b('Silo', 'Hilton')],
  },
  {
    generic: 'Mirabegron',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg') },
    brands: [b('Betmiga', 'Astellas'), b('Mira', 'Wilshire')],
  },
  {
    generic: 'Tolterodine',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('1mg', '2mg') },
    brands: [b('Detrusitol', 'Pfizer'), b('Tolter', 'Wilshire')],
  },
  {
    generic: 'Tamsulosin + Dutasteride',
    category: CAT.urology,
    presentations: { cap: cap('0.4mg+0.5mg') },
    brands: [b('Duodart', 'GSK'), b('Uromax-D', 'Wilshire')],
  },

  /* Diabetes (further) */
  {
    generic: 'Voglibose',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('0.2mg', '0.3mg') },
    brands: [b('Volix', 'Wilshire'), b('Vogli', 'Hilton')],
  },
  {
    generic: 'Saxagliptin',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('2.5mg', '5mg') },
    brands: [b('Onglyza', 'AstraZeneca'), b('Saxa', 'Getz Pharma')],
  },
  {
    generic: 'Insulin Degludec',
    category: CAT.diabetes,
    presentations: { inj: inj('100IU/ml') },
    brands: [b('Tresiba', 'Novo Nordisk')],
  },
  {
    generic: 'Insulin Lispro',
    category: CAT.diabetes,
    presentations: { inj: inj('100IU/ml') },
    brands: [b('Humalog', 'Eli Lilly')],
  },

  /* Anti-emetics (further) */
  {
    generic: 'Granisetron',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('1mg'), inj: inj('1mg/ml') },
    brands: [b('Kytril', 'Roche', ['tab', 'inj']), b('Graniset', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Aprepitant',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { cap: cap('80mg', '125mg') },
    brands: [b('Emend', 'MSD'), b('Aprep', 'Wilshire')],
  },

  /* Dermatology (further) */
  {
    generic: 'Econazole',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('1%') },
    brands: [b('Ecostatin', 'Barrett Hodgson'), b('Econa', 'Wilshire')],
  },
  {
    generic: 'Metronidazole (Topical)',
    category: CAT.derma,
    presentations: { gel: gel('0.75%', '1%') },
    brands: [b('Rozex', 'Galderma'), b('Metrogel', 'Wilshire')],
  },
  {
    generic: 'Clindamycin + Nicotinamide',
    category: CAT.derma,
    presentations: { gel: gel(null) },
    brands: [b('Clindanic', 'Wilshire'), b('Nicoclin', 'Hilton')],
  },
  {
    generic: 'Adapalene + Benzoyl Peroxide',
    category: CAT.derma,
    presentations: { gel: gel(null) },
    brands: [b('Epiduo', 'Galderma'), b('Adaben', 'Wilshire')],
  },
  {
    generic: 'Ammonium Lactate',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { lotion: lotion('12%') },
    brands: [b('Lac-Hydrin', 'Wilshire')],
  },

  /* Supplements / probiotics (further) */
  {
    generic: 'Lactobacillus (Probiotic)',
    category: CAT.gastro,
    presentations: { sachet: sachet(null), cap: cap(null) },
    brands: [b('Protexin', 'Wilshire', ['sachet', 'cap']), b('Enflor', 'Hilton', ['sachet'])],
  },
  {
    generic: 'Melatonin',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('3mg', '5mg', '10mg') },
    brands: [b('Melatit', 'Wilshire'), b('Sleepwell', 'Hilton')],
  },
  {
    generic: 'Vitamin A',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { cap: cap('50000IU', '200000IU') },
    brands: [b('A-Vit', 'Wilshire')],
  },
  {
    generic: 'Collagen Peptides',
    category: CAT.vitamins,
    presentations: { sachet: sachet(null), tab: tab(null) },
    brands: [b('Colnec', 'Wilshire'), b('Collagen', 'Hilton')],
  },
  {
    generic: 'Evening Primrose Oil',
    category: CAT.vitamins,
    presentations: { cap: cap('500mg', '1000mg') },
    brands: [b('Epo', 'Wilshire'), b('Primrose', 'Hilton')],
  },
  {
    generic: 'Spirulina',
    category: CAT.vitamins,
    presentations: { tab: tab('500mg') },
    brands: [b('Spirulina', 'Wilshire')],
  },
  {
    generic: 'Zinc + Vitamin C',
    category: CAT.vitamins,
    presentations: { tab: tab(null), sachet: sachet(null) },
    brands: [b('Zincol-C', 'Wilshire', ['tab']), b('Immune-C', 'Hilton', ['sachet'])],
  },
  {
    generic: 'Multimineral + Multivitamin',
    category: CAT.vitamins,
    presentations: { tab: tab(null) },
    brands: [b('Centrum', 'Pfizer'), b('Theragran', 'Wilshire'), b('Vitamax', 'Hilton')],
  },

  /* Endocrine / bone (further) */
  {
    generic: 'Zoledronic Acid',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { inj: inj('4mg/5ml', '5mg/100ml') },
    brands: [b('Aclasta', 'Novartis'), b('Zometa', 'Novartis')],
  },
  {
    generic: 'Ibandronic Acid',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('150mg') },
    brands: [b('Bonviva', 'Roche'), b('Iband', 'Wilshire')],
  },
  {
    generic: 'Strontium Ranelate',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { sachet: sachet('2g') },
    brands: [b('Protelos', 'Servier')],
  },
  {
    generic: 'Raloxifene',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('60mg') },
    brands: [b('Evista', 'Eli Lilly')],
  },
  {
    generic: 'Liothyronine',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { tab: tab('25mcg') },
    brands: [b('Tertroxin', 'Wilshire')],
  },


  /* ---------------------------------------------------------------------- */
  /* 22. WAVE 6 — calcium-channel blockers, more CNS, derma, eye & antiparasitic */
  /* ---------------------------------------------------------------------- */

  /* Calcium-channel blockers & antihypertensive combos */
  {
    generic: 'Felodipine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Plendil', 'AstraZeneca'), b('Felo', 'Wilshire')],
  },
  {
    generic: 'Lercanidipine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '20mg') },
    brands: [b('Zanidip', 'Barrett Hodgson'), b('Lerca', 'Wilshire')],
  },
  {
    generic: 'Cilnidipine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg') },
    brands: [b('Cilacar', 'Wilshire'), b('Cilna', 'Hilton')],
  },
  {
    generic: 'Nimodipine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('30mg') },
    brands: [b('Nimotop', 'Bayer')],
  },
  {
    generic: 'Sotalol',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('40mg', '80mg') },
    brands: [b('Betapace', 'Wilshire')],
  },
  {
    generic: 'Moxonidine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('0.2mg', '0.4mg') },
    brands: [b('Physiotens', 'Abbott'), b('Moxon', 'Wilshire')],
  },
  {
    generic: 'Perindopril + Indapamide',
    category: CAT.cardio,
    presentations: { tab: tab('4mg+1.25mg', '8mg+2.5mg') },
    brands: [b('Coversyl Plus', 'Servier'), b('Bipreterax', 'Servier')],
  },
  {
    generic: 'Perindopril + Amlodipine',
    category: CAT.cardio,
    presentations: { tab: tab('4mg+5mg', '8mg+10mg') },
    brands: [b('Coveram', 'Servier')],
  },
  {
    generic: 'Amlodipine + Atorvastatin',
    category: CAT.cardio,
    presentations: { tab: tab('5mg+10mg', '10mg+10mg') },
    brands: [b('Caduet', 'Pfizer'), b('Amlotor', 'Wilshire')],
  },
  {
    generic: 'Telmisartan + Hydrochlorothiazide',
    category: CAT.cardio,
    presentations: { tab: tab('40mg+12.5mg', '80mg+12.5mg') },
    brands: [b('Micardis Plus', 'Boehringer Ingelheim'), b('Telsan Plus', 'Getz Pharma')],
  },

  /* CNS (further) */
  {
    generic: 'Lacosamide',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '100mg', '150mg', '200mg') },
    brands: [b('Vimpat', 'Barrett Hodgson'), b('Lacosam', 'Wilshire')],
  },
  {
    generic: 'Amantadine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('100mg') },
    brands: [b('Amantrel', 'Wilshire')],
  },
  {
    generic: 'Ropinirole',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('0.25mg', '1mg', '2mg') },
    brands: [b('Requip', 'GSK'), b('Ropin', 'Wilshire')],
  },
  {
    generic: 'Nortriptyline',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '25mg') },
    brands: [b('Nortrip', 'Wilshire')],
  },
  {
    generic: 'Chlorpromazine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '100mg'), inj: inj('25mg/ml') },
    brands: [b('Largactil', 'Wilshire', ['tab', 'inj'])],
  },
  {
    generic: 'Clozapine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '100mg') },
    brands: [b('Clozaril', 'Wilshire'), b('Cloz', 'Hilton')],
  },
  {
    generic: 'Divalproex',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('250mg', '500mg') },
    brands: [b('Depakote', 'Abbott'), b('Divaa', 'Wilshire')],
  },
  {
    generic: 'Vortioxetine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg', '10mg', '20mg') },
    brands: [b('Brintellix', 'Lundbeck'), b('Vortio', 'Wilshire')],
  },
  {
    generic: 'Agomelatine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('25mg') },
    brands: [b('Valdoxan', 'Servier'), b('Agomel', 'Wilshire')],
  },

  /* Dermatology (further) */
  {
    generic: 'Oxiconazole',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('1%') },
    brands: [b('Oxistat', 'Wilshire')],
  },
  {
    generic: 'Amorolfine',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { lotion: lotion('5%') },
    brands: [b('Loceryl', 'Galderma'), b('Amorol', 'Wilshire')],
  },
  {
    generic: 'Fluocinolone',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('0.025%'), oint: oint('0.025%') },
    brands: [b('Synalar', 'Wilshire', ['cream', 'oint'])],
  },
  {
    generic: 'Halobetasol',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('0.05%') },
    brands: [b('Halox', 'Wilshire')],
  },
  {
    generic: 'Betamethasone + Salicylic Acid',
    category: CAT.derma,
    presentations: { oint: oint(null), lotion: lotion(null) },
    brands: [b('Diprosalic', 'MSD', ['oint', 'lotion'])],
  },
  {
    generic: 'Zinc Oxide',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream(null), oint: oint(null) },
    brands: [b('Sudocrem', 'Wilshire', ['cream'])],
  },
  {
    generic: 'Erythromycin + Benzoyl Peroxide',
    category: CAT.derma,
    presentations: { gel: gel(null) },
    brands: [b('Benzamycin', 'Wilshire')],
  },
  {
    generic: 'Dapsone (Topical)',
    category: CAT.derma,
    presentations: { gel: gel('5%', '7.5%') },
    brands: [b('Aczone', 'Wilshire')],
  },

  /* Eye (further) */
  {
    generic: 'Fluorometholone (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.1%') },
    brands: [b('FML', 'Allergan'), b('Flarex', 'Novartis')],
  },
  {
    generic: 'Loteprednol (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.5%') },
    brands: [b('Lotemax', 'Wilshire')],
  },
  {
    generic: 'Cyclosporine (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.05%') },
    brands: [b('Restasis', 'Allergan'), b('Cyclomune', 'Wilshire')],
  },
  {
    generic: 'Acyclovir (Eye)',
    category: CAT.eyeear,
    presentations: { oint: oint('3%') },
    brands: [b('Zovirax Eye', 'GSK')],
  },
  {
    generic: 'Diclofenac (Eye)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('0.1%') },
    brands: [b('Voltaren Ophtha', 'Novartis'), b('Diclo Eye', 'Wilshire')],
  },

  /* Antiparasitics & antimalarials (further) */
  {
    generic: 'Praziquantel',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('600mg') },
    brands: [b('Biltricide', 'Bayer')],
  },
  {
    generic: 'Levamisole',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '150mg') },
    brands: [b('Ketrax', 'Wilshire')],
  },
  {
    generic: 'Artesunate',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('60mg', '120mg') },
    brands: [b('Artesun', 'Wilshire')],
  },
  {
    generic: 'Quinine',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('300mg'), inj: inj('600mg/2ml') },
    brands: [b('Quinine', 'Wilshire')],
  },
  {
    generic: 'Trimethoprim',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('100mg', '200mg') },
    brands: [b('Trimpex', 'Wilshire')],
  },

  /* Diabetes (further) */
  {
    generic: 'Alogliptin',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('12.5mg', '25mg') },
    brands: [b('Nesina', 'Wilshire')],
  },
  {
    generic: 'Miglitol',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('25mg', '50mg') },
    brands: [b('Glyset', 'Wilshire')],
  },
  {
    generic: 'Insulin Glulisine',
    category: CAT.diabetes,
    presentations: { inj: inj('100IU/ml') },
    brands: [b('Apidra', 'Sanofi')],
  },

  /* Vitamins / minerals (further) */
  {
    generic: 'Vitamin D2 (Ergocalciferol)',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { cap: cap('50000IU') },
    brands: [b('Ergocal', 'Wilshire')],
  },
  {
    generic: 'Magnesium Oxide',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { tab: tab('250mg', '400mg') },
    brands: [b('Mag-Ox', 'Wilshire')],
  },
  {
    generic: 'Selenium + Zinc',
    category: CAT.vitamins,
    presentations: { tab: tab(null) },
    brands: [b('Selzinc', 'Wilshire')],
  },
  {
    generic: 'Lutein + Zeaxanthin',
    category: CAT.vitamins,
    presentations: { tab: tab(null), cap: cap(null) },
    brands: [b('Ocuvite', 'Bausch & Lomb', ['tab']), b('Lutein', 'Wilshire', ['cap'])],
  },
  {
    generic: 'L-Arginine',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { sachet: sachet('3g'), tab: tab('1000mg') },
    brands: [b('Arginmax', 'Wilshire', ['sachet'])],
  },
  {
    generic: 'Betaine',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { tab: tab(null) },
    brands: [b('Betaine', 'Wilshire')],
  },

  /* Women's / hormones (further) */
  {
    generic: 'Danazol',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { cap: cap('100mg', '200mg') },
    brands: [b('Danol', 'Wilshire')],
  },
  {
    generic: 'Conjugated Estrogens',
    category: CAT.womens,
    includeGeneric: true,
    presentations: { tab: tab('0.625mg') },
    brands: [b('Premarin', 'Pfizer')],
  },
  {
    generic: 'Estriol (Vaginal)',
    category: CAT.womens,
    presentations: { cream: cream(null) },
    brands: [b('Ovestin', 'Barrett Hodgson')],
  },
  {
    generic: 'Clotrimazole + Metronidazole (Vaginal)',
    category: CAT.womens,
    presentations: { tab: tab(null) },
    brands: [b('Canesten Combi', 'Bayer'), b('Gynotran', 'Wilshire')],
  },
  {
    generic: 'Leuprolide',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { inj: inj('3.75mg', '11.25mg') },
    brands: [b('Lupron', 'Barrett Hodgson'), b('Leuprol', 'Wilshire')],
  },
  {
    generic: 'Octreotide',
    category: CAT.hormones,
    includeGeneric: true,
    presentations: { inj: inj('50mcg/ml', '100mcg/ml') },
    brands: [b('Sandostatin', 'Novartis')],
  },


  /* ---------------------------------------------------------------------- */
  /* 23. WAVE 7 — cough/cold combinations, ENT, and everyday brands          */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Sodium Chloride (Nasal)',
    category: CAT.eyeear,
    presentations: { drops: drops('0.65%'), spray: spray('0.65%') },
    brands: [b('Sinose', 'Wilshire', ['drops', 'spray']), b('Nasal Saline', 'Hilton', ['drops'])],
  },
  {
    generic: 'Oxymetazoline',
    category: CAT.eyeear,
    includeGeneric: true,
    presentations: { drops: drops('0.05%'), spray: spray('0.05%') },
    brands: [b('Afrin', 'Bayer', ['spray']), b('Oxymet', 'Wilshire', ['drops'])],
  },
  {
    generic: 'Fluticasone Furoate (Nasal)',
    category: CAT.allergy,
    presentations: { spray: spray('27.5mcg') },
    brands: [b('Avamys', 'GSK'), b('Flutic', 'Wilshire')],
  },
  {
    generic: 'Azelastine (Nasal)',
    category: CAT.allergy,
    presentations: { spray: spray('0.1%') },
    brands: [b('Rhinolast', 'Wilshire')],
  },
  {
    generic: 'Betahistine (further)',
    category: CAT.cns,
    presentations: { tab: tab('12mg') },
    brands: [b('Merislon', 'Sami')],
  },
  {
    generic: 'Acebrophylline',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { cap: cap('100mg'), syr: syr('50mg/5ml') },
    brands: [b('Ambrolix-A', 'Wilshire', ['cap']), b('Acebro', 'Hilton', ['cap', 'syr'])],
  },
  {
    generic: 'Levodropropizine',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { syr: syr('30mg/5ml') },
    brands: [b('Levotus', 'Wilshire'), b('Levopront', 'Hilton')],
  },
  {
    generic: 'Butamirate',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { syr: syr('7.5mg/5ml'), drops: drops('5mg/ml') },
    brands: [b('Sinecod', 'Wilshire', ['syr', 'drops'])],
  },
  {
    generic: 'Zafirlukast',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '20mg') },
    brands: [b('Accolate', 'Wilshire')],
  },
  {
    generic: 'Roflumilast',
    category: CAT.respiratory,
    includeGeneric: true,
    presentations: { tab: tab('500mcg') },
    brands: [b('Daxas', 'AstraZeneca'), b('Roflo', 'Wilshire')],
  },
  {
    generic: 'Mosapride',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('5mg') },
    brands: [b('Mosaprid', 'Wilshire'), b('Mosar', 'Hilton')],
  },
  {
    generic: 'Dexlansoprazole',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { cap: cap('30mg', '60mg') },
    brands: [b('Dexilant', 'Wilshire')],
  },
  {
    generic: 'Ademetionine',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('400mg'), inj: inj('500mg') },
    brands: [b('Transmetil', 'Wilshire', ['tab', 'inj'])],
  },
  {
    generic: 'Otilonium Bromide',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('40mg') },
    brands: [b('Spasmomen', 'Wilshire')],
  },
  {
    generic: 'Chlorzoxazone',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('250mg', '500mg') },
    brands: [b('Myoflex', 'Wilshire'), b('Zoxan', 'Hilton')],
  },
  {
    generic: 'Aceclofenac',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('100mg'), susp: susp('100mg/5ml') },
    brands: [b('Aceclo', 'Wilshire', ['tab']), b('Zerodol', 'Hilton', ['tab'])],
  },
  {
    generic: 'Aceclofenac + Paracetamol',
    category: CAT.pain,
    presentations: { tab: tab('100mg+325mg') },
    brands: [b('Aceclo Plus', 'Wilshire'), b('Zerodol-P', 'Hilton')],
  },
  {
    generic: 'Flurbiprofen',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('100mg'), spray: spray(null) },
    brands: [b('Froben', 'Abbott', ['tab']), b('Strefen', 'Reckitt Benckiser', ['spray'])],
  },
  {
    generic: 'Dexketoprofen',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('25mg'), inj: inj('50mg/2ml') },
    brands: [b('Enantyum', 'Wilshire', ['tab', 'inj'])],
  },
  {
    generic: 'Lornoxicam',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('4mg', '8mg') },
    brands: [b('Xefo', 'Wilshire'), b('Lorno', 'Hilton')],
  },
  {
    generic: 'Etodolac',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('400mg', '600mg') },
    brands: [b('Etova', 'Wilshire')],
  },
  {
    generic: 'Ketoprofen (Topical)',
    category: CAT.pain,
    presentations: { gel: gel('2.5%') },
    brands: [b('Fastum Gel', 'Sami'), b('Ketogel', 'Wilshire')],
  },
  {
    generic: 'Diclofenac (Topical)',
    category: CAT.pain,
    presentations: { gel: gel('1%', '2%'), spray: spray(null) },
    brands: [b('Voltral Gel', 'Novartis', ['gel']), b('Dicloran Gel', 'Sami', ['gel'])],
  },
  {
    generic: 'Piroxicam (Topical)',
    category: CAT.pain,
    presentations: { gel: gel('0.5%') },
    brands: [b('Feldene Gel', 'Pfizer')],
  },
  {
    generic: 'Methyl Salicylate + Menthol',
    category: CAT.pain,
    presentations: { cream: cream(null), gel: gel(null) },
    brands: [b('Relaxo', 'Wilshire', ['cream']), b('Movein', 'Hilton', ['gel'])],
  },
  {
    generic: 'Cholecalciferol + Alendronic Acid',
    category: CAT.hormones,
    presentations: { tab: tab('70mg+2800IU') },
    brands: [b('Fosamax Plus', 'MSD')],
  },
  {
    generic: 'Sildenafil (PAH)',
    category: CAT.cardio,
    presentations: { tab: tab('20mg') },
    brands: [b('Revatio', 'Pfizer')],
  },
  {
    generic: 'Bosentan',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('62.5mg', '125mg') },
    brands: [b('Tracleer', 'Wilshire')],
  },
  {
    generic: 'Chlorthalidone',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('12.5mg', '25mg') },
    brands: [b('Hygroton', 'Wilshire')],
  },


  /* ---------------------------------------------------------------------- */
  /* 24. WAVE 8 — further real molecules across areas                        */
  /* ---------------------------------------------------------------------- */

  /* Antihistamines / cold / vertigo */
  {
    generic: 'Promethazine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '25mg'), syr: syr('5mg/5ml') },
    brands: [b('Phenergan', 'Sanofi', ['tab', 'syr']), b('Prometh', 'Wilshire', ['syr'])],
  },
  {
    generic: 'Meclizine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('12.5mg', '25mg') },
    brands: [b('Ancolan', 'Barrett Hodgson'), b('Meclick', 'Wilshire')],
  },
  {
    generic: 'Prochlorperazine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg'), inj: inj('12.5mg/ml') },
    brands: [b('Stemetil', 'Sami', ['tab', 'inj'])],
  },
  {
    generic: 'Doxylamine + Pyridoxine',
    category: CAT.womens,
    presentations: { tab: tab('10mg+10mg') },
    brands: [b('Debendox', 'Wilshire'), b('Navidoxine', 'Sami')],
  },
  {
    generic: 'Diphenhydramine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { syr: syr('12.5mg/5ml'), cap: cap('25mg') },
    brands: [b('Benadryl', 'Johnson & Johnson', ['syr'])],
  },

  /* Sedatives / hypnotics */
  {
    generic: 'Zopiclone',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('7.5mg') },
    brands: [b('Imovane', 'Sanofi'), b('Zopic', 'Wilshire')],
  },
  {
    generic: 'Etizolam',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('0.25mg', '0.5mg', '1mg') },
    brands: [b('Etilaam', 'Wilshire'), b('Etizex', 'Hilton')],
  },
  {
    generic: 'Nitrazepam',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('5mg') },
    brands: [b('Mogadon', 'Wilshire')],
  },
  {
    generic: 'Midazolam',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { inj: inj('5mg/ml', '15mg/3ml') },
    brands: [b('Dormicum', 'Roche')],
  },

  /* ADHD / neuro */
  {
    generic: 'Methylphenidate',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '18mg', '36mg') },
    brands: [b('Ritalin', 'Novartis'), b('Concerta', 'Barrett Hodgson')],
  },
  {
    generic: 'Atomoxetine',
    category: CAT.cns,
    includeGeneric: true,
    presentations: { cap: cap('10mg', '18mg', '25mg', '40mg') },
    brands: [b('Strattera', 'Eli Lilly'), b('Atomox', 'Wilshire')],
  },

  /* Cardio (further) */
  {
    generic: 'Azilsartan',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('40mg', '80mg') },
    brands: [b('Edarbi', 'Wilshire'), b('Azilva', 'Hilton')],
  },
  {
    generic: 'Aliskiren',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('150mg', '300mg') },
    brands: [b('Rasilez', 'Novartis')],
  },
  {
    generic: 'Nicardipine',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { tab: tab('20mg') },
    brands: [b('Cardene', 'Wilshire')],
  },

  /* Antidiabetic (further) */
  {
    generic: 'Gliquidone',
    category: CAT.diabetes,
    includeGeneric: true,
    presentations: { tab: tab('30mg') },
    brands: [b('Glurenorm', 'Barrett Hodgson')],
  },

  /* Systemic antifungals (further) */
  {
    generic: 'Voriconazole',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '200mg') },
    brands: [b('Vfend', 'Pfizer'), b('Voricon', 'Wilshire')],
  },
  {
    generic: 'Amphotericin B',
    category: CAT.antibiotics,
    includeGeneric: true,
    presentations: { inj: inj('50mg') },
    brands: [b('Fungizone', 'Barrett Hodgson')],
  },

  /* Topical anti-infectives (further) */
  {
    generic: 'Nadifloxacin',
    category: CAT.derma,
    includeGeneric: true,
    presentations: { cream: cream('1%') },
    brands: [b('Nadoxin', 'Wilshire')],
  },
  {
    generic: 'Neomycin + Bacitracin (Topical)',
    category: CAT.derma,
    presentations: { oint: oint(null), powder: { form: 'Powder', baseUnit: 'bottle', strengths: [null] } },
    brands: [b('Neosporin', 'Wilshire', ['oint'])],
  },
  {
    generic: 'Gentamicin (Topical)',
    category: CAT.derma,
    presentations: { cream: cream('0.1%') },
    brands: [b('Genta', 'Wilshire'), b('Gentacin', 'Hilton')],
  },

  /* ENT drops (further) */
  {
    generic: 'Ciprofloxacin + Dexamethasone (Ear)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops(null) },
    brands: [b('Ciplox-D', 'Wilshire'), b('Ciprodex', 'Novartis')],
  },
  {
    generic: 'Ofloxacin + Dexamethasone (Ear)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops(null) },
    brands: [b('Oflox-D', 'Wilshire')],
  },
  {
    generic: 'Sodium Bicarbonate (Ear)',
    category: CAT.eyeear,
    presentations: { drops: eyeDrops('5%') },
    brands: [b('Waxsol', 'Wilshire'), b('Earex', 'Hilton')],
  },

  /* B-vitamins (single) */
  {
    generic: 'Thiamine',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { tab: tab('100mg'), inj: inj('100mg/ml') },
    brands: [b('Benerva', 'Wilshire', ['tab'])],
  },
  {
    generic: 'Pyridoxine',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { tab: tab('40mg', '50mg') },
    brands: [b('Pyridox', 'Wilshire')],
  },
  {
    generic: 'Cyanocobalamin',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { tab: tab('50mcg'), inj: inj('1000mcg/ml') },
    brands: [b('Neurobion B12', 'Merck', ['inj'])],
  },
  {
    generic: 'Nicotinamide',
    category: CAT.vitamins,
    includeGeneric: true,
    presentations: { tab: tab('50mg', '100mg') },
    brands: [b('Nicotinamide', 'Wilshire')],
  },

  /* Enzymes & misc */
  {
    generic: 'Trypsin + Chymotrypsin',
    category: CAT.pain,
    presentations: { tab: tab(null) },
    brands: [b('Chymoral Forte', 'Sami'), b('Chymotase', 'Wilshire')],
  },
  {
    generic: 'Bromelain',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('90mg') },
    brands: [b('Bromelain', 'Wilshire')],
  },
  {
    generic: 'Hyaluronic Acid (Joint)',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { inj: inj('20mg/2ml') },
    brands: [b('Hyalgan', 'Sami'), b('Ostenil', 'Wilshire')],
  },


  /* ---------------------------------------------------------------------- */
  /* 25. WAVE 9 — rheumatology, venous, weight, and further real molecules   */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Diosmin + Hesperidin',
    category: CAT.cardio,
    presentations: { tab: tab('500mg', '1000mg') },
    brands: [b('Daflon', 'Servier'), b('Venorex', 'Wilshire'), b('Diosmin', 'Hilton')],
  },
  {
    generic: 'Calcium Dobesilate',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { cap: cap('500mg') },
    brands: [b('Doxium', 'Wilshire'), b('Dobest', 'Hilton')],
  },
  {
    generic: 'Sulfasalazine',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { tab: tab('500mg') },
    brands: [b('Salazopyrin', 'Pfizer'), b('Sulfazine', 'Wilshire')],
  },
  {
    generic: 'Methotrexate',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('2.5mg', '10mg'), inj: inj('50mg/2ml') },
    brands: [b('Emthexate', 'Wilshire', ['inj']), b('Methotrexate', 'Pfizer', ['tab'])],
  },
  {
    generic: 'Leflunomide',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '20mg') },
    brands: [b('Arava', 'Sanofi'), b('Lefno', 'Wilshire')],
  },
  {
    generic: 'Azathioprine',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('50mg') },
    brands: [b('Imuran', 'Aspen'), b('Azoran', 'Wilshire')],
  },
  {
    generic: 'Mycophenolate Mofetil',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { tab: tab('500mg'), cap: cap('250mg') },
    brands: [b('Cellcept', 'Roche'), b('Myfenax', 'Wilshire')],
  },
  {
    generic: 'Cyclosporine',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { cap: cap('25mg', '50mg', '100mg') },
    brands: [b('Sandimmun Neoral', 'Novartis'), b('Consupren', 'Wilshire')],
  },
  {
    generic: 'Tacrolimus',
    category: CAT.urology,
    includeGeneric: true,
    presentations: { cap: cap('0.5mg', '1mg', '5mg') },
    brands: [b('Prograf', 'Astellas'), b('Tacro', 'Wilshire')],
  },
  {
    generic: 'Orlistat',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { cap: cap('60mg', '120mg') },
    brands: [b('Xenical', 'Roche'), b('Orlifit', 'Wilshire')],
  },
  {
    generic: 'Colestyramine',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { sachet: sachet('4g') },
    brands: [b('Questran', 'Wilshire')],
  },
  {
    generic: 'Ebastine',
    category: CAT.allergy,
    includeGeneric: true,
    presentations: { tab: tab('10mg', '20mg') },
    brands: [b('Ebast', 'Wilshire'), b('Kestine', 'Hilton')],
  },
  {
    generic: 'Ketorolac + Paracetamol',
    category: CAT.pain,
    presentations: { tab: tab('10mg+325mg') },
    brands: [b('Toradol Plus', 'Roche'), b('Ketopar', 'Wilshire')],
  },
  {
    generic: 'Nefopam',
    category: CAT.pain,
    includeGeneric: true,
    presentations: { tab: tab('30mg'), inj: inj('20mg/ml') },
    brands: [b('Acupan', 'Wilshire')],
  },
  {
    generic: 'Budesonide (GI)',
    category: CAT.gastro,
    presentations: { cap: cap('3mg') },
    brands: [b('Entocort', 'AstraZeneca'), b('Budez', 'Wilshire')],
  },
  {
    generic: 'Balsalazide',
    category: CAT.gastro,
    includeGeneric: true,
    presentations: { cap: cap('750mg') },
    brands: [b('Colazal', 'Wilshire')],
  },
  {
    generic: 'Troxerutin',
    category: CAT.cardio,
    includeGeneric: true,
    presentations: { cap: cap('300mg') },
    brands: [b('Troxevasin', 'Wilshire')],
  },
  {
    generic: 'Betahistine + Cinnarizine',
    category: CAT.cns,
    presentations: { tab: tab(null) },
    brands: [b('Vertin Plus', 'Wilshire')],
  },
  {
    generic: 'Pantoprazole + Levosulpiride',
    category: CAT.gastro,
    presentations: { cap: cap('40mg+75mg') },
    brands: [b('Sozol-L', 'Sami'), b('Zopent-L', 'Getz Pharma')],
  },
  {
    generic: 'Esomeprazole + Levosulpiride',
    category: CAT.gastro,
    presentations: { cap: cap('40mg+75mg') },
    brands: [b('Nexum-L', 'Getz Pharma')],
  },
  {
    generic: 'Rabeprazole + Domperidone',
    category: CAT.gastro,
    presentations: { cap: cap('20mg+30mg') },
    brands: [b('Pariet-D', 'Barrett Hodgson'), b('Rabifin-D', 'Hilton')],
  },
  {
    generic: 'Metformin + Sitagliptin + Glimepiride',
    category: CAT.diabetes,
    presentations: { tab: tab(null) },
    brands: [b('Trimet', 'Getz Pharma')],
  },
  {
    generic: 'Rosuvastatin + Ezetimibe',
    category: CAT.cardio,
    presentations: { tab: tab('10mg+10mg', '20mg+10mg') },
    brands: [b('Rovista-EZ', 'Getz Pharma'), b('Rozet', 'Wilshire')],
  },
  {
    generic: 'Rosuvastatin + Aspirin + Clopidogrel',
    category: CAT.cardio,
    presentations: { cap: cap(null) },
    brands: [b('Rovicard', 'Getz Pharma')],
  },
  {
    generic: 'Amlodipine + Atenolol',
    category: CAT.cardio,
    presentations: { tab: tab('5mg+50mg') },
    brands: [b('Amlopin-AT', 'Wilshire'), b('Tenoloc-AM', 'Hilton')],
  },
  {
    generic: 'Amlodipine + Bisoprolol',
    category: CAT.cardio,
    presentations: { tab: tab('5mg+5mg', '5mg+10mg') },
    brands: [b('Concor AM', 'Merck')],
  },
  {
    generic: 'Losartan + Amlodipine',
    category: CAT.cardio,
    presentations: { tab: tab('50mg+5mg') },
    brands: [b('Losar-AM', 'Getz Pharma')],
  },
  {
    generic: 'Montelukast + Fexofenadine',
    category: CAT.allergy,
    presentations: { tab: tab('10mg+120mg') },
    brands: [b('Montiget-Fx', 'Getz Pharma'), b('Fexet-M', 'Getz Pharma')],
  },
  {
    generic: 'Cetirizine + Pseudoephedrine',
    category: CAT.respiratory,
    presentations: { tab: tab(null) },
    brands: [b('Rigix-D', 'Getz Pharma'), b('Cetin-D', 'Wilshire')],
  },
  {
    generic: 'Paracetamol + Phenylephrine + Chlorpheniramine + Caffeine',
    category: CAT.respiratory,
    presentations: { tab: tab(null) },
    brands: [b('Panadol CF', 'GSK'), b('Coldrex Plus', 'Wilshire')],
  },
  {
    generic: 'Dextromethorphan + Chlorpheniramine + Phenylephrine',
    category: CAT.respiratory,
    presentations: { syr: syr(null) },
    brands: [b('Tussanil', 'Wilshire'), b('Coughend', 'Hilton')],
  },


  /* ---------------------------------------------------------------------- */
  /* 26. Additional verified brands (cross-checked against Pakistani sources) */
  /* ---------------------------------------------------------------------- */
  {
    generic: 'Cefixime',
    category: CAT.antibiotics,
    presentations: {
      cap: cap('200mg', '400mg'),
      susp: susp('100mg/5ml'),
    },
    brands: [b('EvoFix', 'PharmEvo', ['cap', 'susp']), b('Cefixstar', 'Bosch', ['cap'])],
  },
  {
    generic: 'Azithromycin',
    category: CAT.antibiotics,
    presentations: { tab: tab('250mg', '500mg'), susp: susp('200mg/5ml') },
    brands: [b('Zezot', 'Bosch', ['tab', 'susp'])],
  },
  {
    generic: 'Ciprofloxacin',
    category: CAT.antibiotics,
    presentations: { tab: tab('250mg', '500mg') },
    brands: [b('Cipro-Eff', 'Efroze', ['tab'])],
  },

];

/* ========================================================================== */
/* FRONT-OF-STORE, CONSUMABLES & DEVICES                                       */
/* ========================================================================== */

const item = (
  name: string,
  category: string,
  baseUnit: string,
  extra: Partial<StarterItem> = {},
): StarterItem => ({ name, category, baseUnit, ...extra });

const ITEMS: StarterItem[] = [
  /* ---- Antiseptics, first aid & wound care ------------------------------ */
  item('Dettol Antiseptic Liquid', CAT.otc, 'bottle', { manufacturer: 'Reckitt Benckiser' }),
  item('Pyodine Solution', CAT.otc, 'bottle', {
    manufacturer: 'Brookes',
    formula: 'Povidone Iodine',
  }),
  item('Pyodine Scrub', CAT.otc, 'bottle', { manufacturer: 'Brookes', formula: 'Povidone Iodine' }),
  item('Savlon Antiseptic Liquid', CAT.otc, 'bottle', { manufacturer: 'ICI' }),
  item('Hydrogen Peroxide Solution', CAT.otc, 'bottle', { manufacturer: 'Generic' }),
  item('Surgical Spirit', CAT.otc, 'bottle', { manufacturer: 'Generic' }),
  item('Rubbing Alcohol (Isopropyl)', CAT.otc, 'bottle', { manufacturer: 'Generic' }),
  item('Cotton Wool Roll', CAT.supplies, 'roll', { manufacturer: 'Generic' }),
  item('Cotton Buds', CAT.supplies, 'pack', { manufacturer: 'Generic' }),
  item('Gauze Bandage', CAT.supplies, 'roll', { manufacturer: 'Generic' }),
  item('Gauze Swabs', CAT.supplies, 'pack', { manufacturer: 'Generic' }),
  item('Crepe Bandage', CAT.supplies, 'roll', { manufacturer: 'Generic' }),
  item('Cotton Bandage', CAT.supplies, 'roll', { manufacturer: 'Generic' }),
  item('Elastic Bandage', CAT.supplies, 'roll', { manufacturer: 'Generic' }),
  item('Adhesive Tape (Micropore)', CAT.supplies, 'roll', { manufacturer: 'Generic' }),
  item('Band-Aid Plasters', CAT.otc, 'pack', { manufacturer: 'Johnson & Johnson' }),
  item('Wound Dressing Pad', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Burnol Cream', CAT.otc, 'tube', { manufacturer: 'Reckitt Benckiser' }),
  item('Elastoplast', CAT.otc, 'pack', { manufacturer: 'Beiersdorf' }),
  item('Tincture Benzoin', CAT.otc, 'bottle', { manufacturer: 'Generic' }),

  /* ---- Pain-relief topicals, balms & rubs ------------------------------- */
  item('Deep Heat Rub', CAT.otc, 'tube', { manufacturer: 'Mentholatum' }),
  item('Iodex Balm', CAT.otc, 'tube', { manufacturer: 'GSK' }),
  item('Tiger Balm', CAT.otc, 'tube', { manufacturer: 'Haw Par' }),
  item('Move Freely Pain Patch', CAT.otc, 'pack', { manufacturer: 'Generic' }),
  item('Volini Spray', CAT.otc, 'bottle', { manufacturer: 'Sami' }),

  /* ---- Oral & throat care ---------------------------------------------- */
  item('Strepsils Lozenges', CAT.otc, 'pack', { manufacturer: 'Reckitt Benckiser' }),
  item('Cofol Lozenges', CAT.otc, 'pack', { manufacturer: 'Herbion' }),
  item('Betadine Gargle', CAT.otc, 'bottle', { manufacturer: 'Brookes' }),
  item('Oral-B Toothbrush', CAT.otc, 'piece', { manufacturer: 'Procter & Gamble' }),
  item('Colgate Toothpaste', CAT.otc, 'tube', { manufacturer: 'Colgate-Palmolive' }),
  item('Sensodyne Toothpaste', CAT.otc, 'tube', { manufacturer: 'GSK' }),
  item('Listerine Mouthwash', CAT.otc, 'bottle', { manufacturer: 'Johnson & Johnson' }),
  item('Orajel Teething Gel', CAT.otc, 'tube', { manufacturer: 'Church & Dwight' }),

  /* ---- Digestive & OTC remedies ---------------------------------------- */
  item('ENO Fruit Salt Sachet', CAT.otc, 'sachet', { manufacturer: 'GSK' }),
  item('ENO Fruit Salt Bottle', CAT.otc, 'bottle', { manufacturer: 'GSK' }),
  item('Glucose-D Powder', CAT.otc, 'pack', { manufacturer: 'Rafhan' }),
  item('Glucolin Powder', CAT.otc, 'pack', { manufacturer: 'GSK' }),
  item('Honey (Pure)', CAT.otc, 'bottle', { manufacturer: 'Marhaba' }),
  item('Joshanda Sachet', CAT.otc, 'sachet', { manufacturer: 'Qarshi' }),
  item('Johar Joshanda', CAT.otc, 'sachet', { manufacturer: 'Qarshi' }),
  item('Jam-e-Shirin', CAT.otc, 'bottle', { manufacturer: 'Qarshi' }),
  item('Sharbat Bazoori', CAT.otc, 'bottle', { manufacturer: 'Qarshi' }),
  item('Entox-P Syrup', CAT.otc, 'bottle', { manufacturer: 'Herbion' }),
  item('Carmina Drops', CAT.pediatrics, 'bottle', { manufacturer: 'Herbion' }),

  /* ---- Baby care & nutrition ------------------------------------------- */
  item('Pampers Diapers Small', CAT.otc, 'pack', { manufacturer: 'Procter & Gamble' }),
  item('Pampers Diapers Medium', CAT.otc, 'pack', { manufacturer: 'Procter & Gamble' }),
  item('Pampers Diapers Large', CAT.otc, 'pack', { manufacturer: 'Procter & Gamble' }),
  item('Canbebe Diapers Medium', CAT.otc, 'pack', { manufacturer: 'Hayat Kimya' }),
  item('Molfix Diapers Large', CAT.otc, 'pack', { manufacturer: 'Hayat Kimya' }),
  item('Johnson Baby Soap', CAT.otc, 'piece', { manufacturer: 'Johnson & Johnson' }),
  item('Johnson Baby Oil', CAT.otc, 'bottle', { manufacturer: 'Johnson & Johnson' }),
  item('Johnson Baby Lotion', CAT.otc, 'bottle', { manufacturer: 'Johnson & Johnson' }),
  item('Johnson Baby Powder', CAT.otc, 'bottle', { manufacturer: 'Johnson & Johnson' }),
  item('Johnson Baby Shampoo', CAT.otc, 'bottle', { manufacturer: 'Johnson & Johnson' }),
  item('Cerelac Wheat', CAT.otc, 'pack', { manufacturer: 'Nestle' }),
  item('Cerelac Rice', CAT.otc, 'pack', { manufacturer: 'Nestle' }),
  item('Nan Pro 1', CAT.otc, 'pack', { manufacturer: 'Nestle' }),
  item('Nan Pro 2', CAT.otc, 'pack', { manufacturer: 'Nestle' }),
  item('Lactogen 1', CAT.otc, 'pack', { manufacturer: 'Nestle' }),
  item('Lactogen 2', CAT.otc, 'pack', { manufacturer: 'Nestle' }),
  item('S-26 Gold', CAT.otc, 'pack', { manufacturer: 'Nestle' }),
  item('Feeding Bottle', CAT.otc, 'piece', { manufacturer: 'Generic' }),
  item('Feeder Nipple', CAT.otc, 'piece', { manufacturer: 'Generic' }),
  item('Baby Soother', CAT.otc, 'piece', { manufacturer: 'Generic' }),

  /* ---- Personal care & hygiene ----------------------------------------- */
  item('Always Sanitary Pads', CAT.otc, 'pack', { manufacturer: 'Procter & Gamble' }),
  item('Butterfly Sanitary Pads', CAT.otc, 'pack', { manufacturer: 'Santex' }),
  item('Adult Diapers Large', CAT.otc, 'pack', { manufacturer: 'Generic' }),
  item('Head & Shoulders Shampoo', CAT.otc, 'bottle', { manufacturer: 'Procter & Gamble' }),
  item('Selsun Shampoo', CAT.derma, 'bottle', {
    manufacturer: 'Abbott',
    formula: 'Selenium Sulfide',
  }),
  item('Nix Anti-Lice Lotion', CAT.derma, 'bottle', { manufacturer: 'Generic', formula: 'Permethrin' }),
  item('Dettol Soap', CAT.otc, 'piece', { manufacturer: 'Reckitt Benckiser' }),
  item('Safeguard Soap', CAT.otc, 'piece', { manufacturer: 'Procter & Gamble' }),
  item('Hand Sanitizer Gel', CAT.otc, 'bottle', { manufacturer: 'Generic' }),
  item('Vaseline Petroleum Jelly', CAT.otc, 'bottle', { manufacturer: 'Unilever' }),
  item('Nivea Cream', CAT.otc, 'tube', { manufacturer: 'Beiersdorf' }),
  item('Lip Balm', CAT.otc, 'piece', { manufacturer: 'Generic' }),
  item('Sunblock SPF 50', CAT.derma, 'tube', { manufacturer: 'Generic' }),
  item('Glycerin', CAT.otc, 'bottle', { manufacturer: 'Generic' }),

  /* ---- Consumables (injection & procedure) ----------------------------- */
  item('Disposable Syringe 1ml', CAT.supplies, 'piece', { manufacturer: 'BD', strength: '1ml' }),
  item('Disposable Syringe 3ml', CAT.supplies, 'piece', { manufacturer: 'BD', strength: '3ml' }),
  item('Disposable Syringe 5ml', CAT.supplies, 'piece', { manufacturer: 'BD', strength: '5ml' }),
  item('Disposable Syringe 10ml', CAT.supplies, 'piece', { manufacturer: 'BD', strength: '10ml' }),
  item('Insulin Syringe', CAT.supplies, 'piece', { manufacturer: 'BD' }),
  item('Butterfly Needle (Scalp Vein Set)', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('IV Cannula 18G', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('IV Cannula 20G', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('IV Cannula 22G', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('IV Infusion Set', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Drip Set (Macro)', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Examination Gloves (Latex)', CAT.supplies, 'box', { manufacturer: 'Generic' }),
  item('Surgical Gloves', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Surgical Face Mask', CAT.supplies, 'box', { manufacturer: 'Generic' }),
  item('N95 Respirator Mask', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Urine Bag', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Foley Catheter', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Nebulizer Mask (Adult)', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Nebulizer Mask (Child)', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Spacer Device (Inhaler)', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Tongue Depressor', CAT.supplies, 'pack', { manufacturer: 'Generic' }),

  /* ---- Devices & diagnostics ------------------------------------------- */
  item('Digital Thermometer', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Infrared Forehead Thermometer', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Mercury Thermometer', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Digital BP Monitor', CAT.supplies, 'piece', { manufacturer: 'Omron' }),
  item('Aneroid BP Apparatus', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Glucometer', CAT.supplies, 'piece', { manufacturer: 'Accu-Chek' }),
  item('Accu-Chek Active Test Strips', CAT.supplies, 'pack', { manufacturer: 'Roche' }),
  item('OneTouch Test Strips', CAT.supplies, 'pack', { manufacturer: 'LifeScan' }),
  item('Glucometer Lancets', CAT.supplies, 'pack', { manufacturer: 'Generic' }),
  item('Pulse Oximeter', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Nebulizer Machine', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Weighing Scale (Baby)', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Hot Water Bottle', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Ice Bag', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Pregnancy Test Strip', CAT.otc, 'piece', { manufacturer: 'Generic' }),
  item('Ovulation Test Kit', CAT.otc, 'piece', { manufacturer: 'Generic' }),

  /* ---- Family planning & sexual health --------------------------------- */
  item('Sathi Condoms', CAT.otc, 'pack', { manufacturer: 'DKT' }),
  item('Josh Condoms', CAT.otc, 'pack', { manufacturer: 'DKT' }),
  item('Durex Condoms', CAT.otc, 'pack', { manufacturer: 'Reckitt Benckiser' }),
  item('KY Jelly Lubricant', CAT.otc, 'tube', { manufacturer: 'Reckitt Benckiser' }),

  /* ---- Eye & contact lens care ----------------------------------------- */
  item('Contact Lens Solution', CAT.eyeear, 'bottle', { manufacturer: 'Generic' }),
  item('Eye Wash Cup', CAT.supplies, 'piece', { manufacturer: 'Generic' }),

  /* ---- Rehydration & electrolytes (branded liquids) -------------------- */
  item('Rehydron Sachet', CAT.pediatrics, 'sachet', { manufacturer: 'Orion' }),

  /* ---- Herbal & Unani (a real, large part of the Pakistani shelf) ------- */
  item('Safi Syrup', CAT.otc, 'bottle', { manufacturer: 'Hamdard' }),
  item('Joshina Syrup', CAT.otc, 'bottle', { manufacturer: 'Hamdard' }),
  item('Sualin Tablets', CAT.otc, 'strip', { manufacturer: 'Hamdard' }),
  item('Roghan Badam Shirin', CAT.otc, 'bottle', { manufacturer: 'Hamdard' }),
  item('Naunehal Gripe Water', CAT.pediatrics, 'bottle', { manufacturer: 'Hamdard' }),
  item('Cinkara Syrup', CAT.otc, 'bottle', { manufacturer: 'Hamdard' }),
  item('Sharbat Faulad', CAT.otc, 'bottle', { manufacturer: 'Hamdard' }),
  item('Carminative Mixture', CAT.otc, 'bottle', { manufacturer: 'Generic' }),
  item('Linkus Syrup', CAT.otc, 'bottle', { manufacturer: 'Herbion' }),
  item('Linkus Lozenges', CAT.otc, 'pack', { manufacturer: 'Herbion' }),
  item('Kof Lozenges', CAT.otc, 'pack', { manufacturer: 'Herbion' }),
  item('Woodward Gripe Water', CAT.pediatrics, 'bottle', { manufacturer: 'Church & Dwight' }),
  item('Sharbat Sandal', CAT.otc, 'bottle', { manufacturer: 'Qarshi' }),
  item('Lemo Fizz Sachet', CAT.otc, 'sachet', { manufacturer: 'Qarshi' }),

  /* ---- Oral nutrition & meal replacement (real PK brands) -------------- */
  item('Ensure Powder', CAT.otc, 'pack', { manufacturer: 'Abbott' }),
  item('Glucerna Powder', CAT.otc, 'pack', { manufacturer: 'Abbott' }),
  item('Pediasure Powder', CAT.pediatrics, 'pack', { manufacturer: 'Abbott' }),
  item('SMA Gold', CAT.otc, 'pack', { manufacturer: 'Nestle' }),
  item('Similac Formula', CAT.otc, 'pack', { manufacturer: 'Abbott' }),
  item('Aptamil Formula', CAT.otc, 'pack', { manufacturer: 'Danone' }),
  item('Nutren Optimum', CAT.otc, 'pack', { manufacturer: 'Nestle' }),
  item('Protein Powder', CAT.otc, 'pack', { manufacturer: 'Generic' }),

  /* ---- More personal & skin care --------------------------------------- */
  item('Close-Up Toothpaste', CAT.otc, 'tube', { manufacturer: 'Unilever' }),
  item('Medicam Toothpaste', CAT.otc, 'tube', { manufacturer: 'English' }),
  item('Lifebuoy Soap', CAT.otc, 'piece', { manufacturer: 'Unilever' }),
  item('Clear Shampoo', CAT.otc, 'bottle', { manufacturer: 'Unilever' }),
  item('Baby Wipes', CAT.otc, 'pack', { manufacturer: 'Generic' }),
  item('Wet Wipes', CAT.otc, 'pack', { manufacturer: 'Generic' }),
  item('Cetaphil Cleanser', CAT.derma, 'bottle', { manufacturer: 'Galderma' }),
  item('Cetaphil Moisturising Lotion', CAT.derma, 'bottle', { manufacturer: 'Galderma' }),
  item('QV Cream', CAT.derma, 'tube', { manufacturer: 'Ego' }),
  item('Aqueous Cream', CAT.derma, 'tube', { manufacturer: 'Generic' }),
  item('Glycerin Rose Water', CAT.otc, 'bottle', { manufacturer: 'Generic' }),
  item('Talcum Powder', CAT.otc, 'bottle', { manufacturer: 'Generic' }),

  /* ---- Baby (further) --------------------------------------------------- */
  item('Huggies Diapers Medium', CAT.otc, 'pack', { manufacturer: 'Kimberly-Clark' }),
  item('Huggies Diapers Large', CAT.otc, 'pack', { manufacturer: 'Kimberly-Clark' }),
  item('Canbebe Diapers Large', CAT.otc, 'pack', { manufacturer: 'Hayat Kimya' }),
  item('Molfix Diapers Medium', CAT.otc, 'pack', { manufacturer: 'Hayat Kimya' }),
  item('Cerelac 3 Fruits', CAT.otc, 'pack', { manufacturer: 'Nestle' }),
  item('Baby Diaper Rash Cream', CAT.otc, 'tube', { manufacturer: 'Generic' }),
  item('Baby Teether', CAT.otc, 'piece', { manufacturer: 'Generic' }),

  /* ---- Orthopaedic supports & mobility ---------------------------------- */
  item('Knee Support', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Ankle Support', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Wrist Support', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Elbow Support', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Lumbar Support Belt', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Abdominal Support Belt', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Cervical Collar', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Tennis Elbow Support', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Finger Splint', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Arm Sling', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Walking Stick', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Underarm Crutches', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Air Cushion Ring', CAT.supplies, 'piece', { manufacturer: 'Generic' }),

  /* ---- Consumables (further) ------------------------------------------- */
  item('Alcohol Swabs', CAT.supplies, 'box', { manufacturer: 'Generic' }),
  item('Spirit Swabs', CAT.supplies, 'pack', { manufacturer: 'Generic' }),
  item('Leukoplast Adhesive Tape', CAT.supplies, 'roll', { manufacturer: 'Beiersdorf' }),
  item('Elastocrepe Bandage', CAT.supplies, 'roll', { manufacturer: 'Generic' }),
  item('Three-Way Stopcock', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('IV Extension Line', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item("Ryle's Tube", CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Suction Catheter', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Oxygen Mask', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Nasal Oxygen Cannula', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Urine Container', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Stool Container', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Sample Bottle', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Disposable Bed Sheet', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Tourniquet', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Kidney Tray', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Surgical Blade', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Umbilical Cord Clamp', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Enema Set', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Bed Pan', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Colostomy Bag', CAT.supplies, 'piece', { manufacturer: 'Generic' }),

  /* ---- Devices & monitoring (further) ---------------------------------- */
  item('OneTouch Glucometer', CAT.supplies, 'piece', { manufacturer: 'LifeScan' }),
  item('On-Call Glucometer', CAT.supplies, 'piece', { manufacturer: 'Acon' }),
  item('On-Call Test Strips', CAT.supplies, 'pack', { manufacturer: 'Acon' }),
  item('Steam Inhaler', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Vaporizer', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Adult Weighing Scale', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Pill Organizer Box', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Medicine Measuring Cup', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Oral Dosing Syringe', CAT.supplies, 'piece', { manufacturer: 'Generic' }),
  item('Fetal Doppler', CAT.supplies, 'piece', { manufacturer: 'Generic' }),

  /* ---- Family planning & sexual health (further) ----------------------- */
  item('Rough Rider Condoms', CAT.otc, 'pack', { manufacturer: 'DKT' }),
  item('Personal Lubricant Gel', CAT.otc, 'tube', { manufacturer: 'Generic' }),

  /* ---- Insect & repellents --------------------------------------------- */
  item('Mospel Mosquito Repellent', CAT.otc, 'tube', { manufacturer: 'Brookes' }),
  item('Mosquito Repellent Lotion', CAT.otc, 'bottle', { manufacturer: 'Generic' }),
];

export const STARTER_SOURCE: StarterSource = {
  molecules: MOLECULES,
  items: ITEMS,
};

export { CAT };
