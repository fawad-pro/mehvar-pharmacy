/**
 * The client-side catalog index — ADR-4, ranked per Phase 10 §5.
 *
 *   "The counter loads the tenant's catalog into a client-side index. Every
 *    keystroke searches locally… I2's near-instant expectation cannot depend on
 *    network round-trips per keystroke."
 *
 * ## Why it is shaped this way
 *
 * A tenant catalog is 2,000–3,000 products (Phase 6 §3.2's curated head), and
 * the naive implementation — scan every product, fuzzy-match each one, on every
 * keystroke — is 3,000 edit-distance computations per character typed. That
 * passes a 53-product demo and misses I2 in a real shop.
 *
 * So the work per keystroke is bounded by construction, not by hope:
 *
 *   - **Prefix matching** binary-searches a sorted token array. ~14 comparisons
 *     against ~10,000 unique tokens, regardless of catalog size.
 *   - **Skeleton matching** is a hash lookup (see normalize.ts).
 *   - **Fuzzy matching** never touches the catalog. A trigram posting list
 *     nominates candidates, they are ranked by trigram overlap, and only the top
 *     few hundred ever see an edit-distance computation.
 *   - **Very short queries skip fuzzy entirely** — one or two characters cannot
 *     be meaningfully misspelled, and that is also where a prefix scan is widest.
 *   - **Barcodes bypass ranking** through a hash lookup (Phase 10 §5).
 *
 * Build is O(catalog); search is O(query) with a constant candidate ceiling.
 * `catalog-index.perf.test.ts` asserts both against 3,000 products, so a future
 * change back to a naive scan fails a test rather than a demo.
 */

import { barcodeKeys } from '@/domain/catalog/barcode';
import type { ProductUnit } from '@/domain/catalog/units';
import type { PackLevel } from '@/lib/quantity';

import {
  boundedDistance,
  distanceTolerance,
  normalize,
  skeleton,
  tokenize,
  trigrams,
} from './normalize';

/* ========================================================================== */
/* Wire shape                                                                  */
/* ========================================================================== */

/**
 * A product as the index holds it — a lean projection, not the table row.
 * Deliberate: this payload crosses the network on session start, so it carries
 * only what search and the result row (Phase 10 §5) need.
 */
export interface IndexedProduct {
  readonly id: string;
  readonly name: string;
  readonly strength: string | null;
  readonly form: string | null;
  readonly manufacturer: string | null;
  readonly formulaText: string | null;
  readonly baseUnitName: string;
  readonly packLevels: readonly PackLevel[];
  /** Paisa per base unit. Confirmed server-side at commit (ADR-4). */
  readonly pricePaisa: number;
  /**
   * [PCN-012] Each unit with its own price. Optional: an index cached before
   * PCN-012, or a quick item made at the counter, has none, and its units are
   * derived from the fields above (`unitsOf`).
   */
  readonly units?: readonly ProductUnit[];
  readonly mrpPaisa: number | null;
  readonly needsCompletion: boolean;
}

export interface IndexedBarcode {
  readonly barcode: string;
  readonly productId: string;
  readonly unitLevelName: string;
}

/**
 * Stock is carried separately from the catalog on purpose.
 *
 * Identity, prices and barcodes change when someone edits them, so they version
 * cleanly by `updated_at` and refresh incrementally. Stock changes with every
 * sale — it does not belong on the same clock. Keeping it a separate map means a
 * stock refresh never re-downloads the catalog, and a catalog edit never
 * pretends to refresh stock.
 *
 * The badge it feeds is advisory (Phase 10 §5 shows it "only when meaningful");
 * authority is the server transaction at commit (ADR-5).
 */
export type StockSnapshot = Readonly<Record<string, number>>;

/**
 * PCN-008: base units on hand in expired batches, and the earliest expiry among
 * them, per product. Like stock, advisory: it feeds the counter's warning, and
 * the server's allocation decides. Optional so a catalog cached before it
 * existed still loads.
 */
export type ExpiredSnapshot = Readonly<
  Record<string, { readonly qtyBase: number; readonly expiryDate: string }>
>;

export interface CatalogPayload {
  readonly products: readonly IndexedProduct[];
  readonly barcodes: readonly IndexedBarcode[];
  readonly stock: StockSnapshot;
  readonly expired?: ExpiredSnapshot;
  /** Watermark for the next incremental fetch. */
  readonly syncedAt: string;
}

/* ========================================================================== */
/* Ranking ladder — Phase 10 §5, in order                                      */
/* ========================================================================== */

export enum MatchTier {
  /** Scanned code. Bypasses ranking entirely. */
  Barcode = 0,
  /** Normalized name equals the query. */
  ExactName = 1,
  /** Name starts with the query. */
  NamePrefix = 2,
  /** A word inside the name starts with, or contains, the query. */
  WordBoundary = 3,
  /** Misspelling-tolerant: consonant skeleton or bounded edit distance. */
  Fuzzy = 4,
  /** Formula/salt or manufacturer — substitution support (Phase 1 §5). */
  Formula = 5,
  /**
   * Strength or dosage form. Below formula on purpose: on its own, a strength
   * ("40") or a form ("tab") is a filter, not what someone searches for. It
   * earns its keep in a multi-term query — "pan 40", "panadol syrup" — where it
   * narrows a name match to the exact presentation (Phase 10 §5's ranking is a
   * ladder, and these are its lowest rungs, reached only when a stronger tier
   * is not).
   */
  Strength = 6,
  Form = 7,
}

export type MatchedOn = 'name' | 'formula' | 'manufacturer' | 'barcode' | 'strength' | 'form';

export interface SearchHit {
  readonly product: IndexedProduct;
  readonly tier: MatchTier;
  readonly matchedOn: MatchedOn;
  /** Base units on hand, or null when stock is unknown to the index. */
  readonly stockBase: number | null;
  /** Set for barcode hits: the unit level the scanned code maps to. */
  readonly unitLevelName?: string;
}

/* ========================================================================== */
/* Internals                                                                   */
/* ========================================================================== */

interface Match {
  readonly tier: MatchTier;
  readonly matchedOn: MatchedOn;
  readonly rank: number;
}

interface Entry {
  readonly product: IndexedProduct;
  readonly name: string;
  readonly nameTokens: readonly string[];
  readonly nameSkeleton: string;
  readonly tokenSkeletons: readonly string[];
  readonly formulaTokens: readonly string[];
  readonly manufacturer: string;
  readonly manufacturerTokens: readonly string[];
  readonly strengthTokens: readonly string[];
  readonly formTokens: readonly string[];
  readonly nameLength: number;
}

/** Work ceilings. These are the difference between scaling and not. */
const MAX_FUZZY_CANDIDATES = 240;
const MAX_PREFIX_SCAN = 400;
const MAX_SKELETON_CANDIDATES = 120;
const MIN_FUZZY_QUERY_LENGTH = 3;
const DEFAULT_LIMIT = 10;

/**
 * A trigram appearing in more than this many products is a stopword: it
 * nominates a crowd and discriminates nothing.
 *
 * Absolute, deliberately — not a share of the catalog. A ceiling expressed as a
 * percentage grows with the thing it is supposed to cap, which makes the work
 * per keystroke scale with catalog size again. Getting this wrong is subtle and
 * the ratio test in catalog-index.perf.test.ts is what catches it.
 */
const MAX_POSTING_LENGTH = 400;

/** Total postings one query may walk, across all its trigrams. Also absolute. */
const POSTING_BUDGET = 1_200;

/**
 * Share of the query's trigrams a candidate must match to be measured.
 *
 * Recall lost here is recall the skeleton index already covers — "broofen" finds
 * Brufen by consonant skeleton, not by trigram overlap — which is why two
 * cheap gatherers beat one expensive one.
 */
const MIN_OVERLAP_SHARE = 0.5;

export class CatalogIndex {
  private readonly entries: Entry[] = [];
  private readonly byId = new Map<string, number>();

  /** Sorted `token index` strings — prefix ranges found by binary search. */
  private sortedTokens: string[] = [];
  private readonly skeletonIndex = new Map<string, number[]>();
  private readonly trigramIndex = new Map<string, number[]>();
  private readonly barcodeIndex = new Map<string, IndexedBarcode>();
  private stock: StockSnapshot = {};
  private expired: ExpiredSnapshot = {};

  private constructor() {}

  static build(payload: CatalogPayload): CatalogIndex {
    const index = new CatalogIndex();
    index.stock = payload.stock;
    index.expired = payload.expired ?? {};

    for (const product of payload.products) {
      index.addProduct(product);
    }
    for (const barcode of payload.barcodes) {
      // Filed under every key the code is known by (`barcodeKeys`): as saved,
      // and — for a GTIN — its GTIN-13/14 forms, so the box's 1D barcode and
      // the pack's 2D code find the same product. The first code to claim a
      // key keeps it.
      for (const key of barcodeKeys(barcode.barcode)) {
        if (!index.barcodeIndex.has(key)) {
          index.barcodeIndex.set(key, barcode);
        }
      }
    }
    index.finalize();
    return index;
  }

  /**
   * Every indexed product, for callers that need the whole catalogue rather
   * than a search over it.
   *
   * Duplicate checking is the reason this exists: deciding whether a product
   * being typed already exists means comparing identity keys against all of
   * them, which is not a text search and must not be answered by one. Doing it
   * here rather than with a server query keeps the check instant and keeps it
   * working offline — the same payload the counter already holds (ADR-4).
   */
  get products(): readonly IndexedProduct[] {
    return this.entries.map((entry) => entry.product);
  }

  get size(): number {
    return this.entries.length;
  }

  get barcodeCount(): number {
    return this.barcodeIndex.size;
  }

  private addProduct(product: IndexedProduct): void {
    const position = this.entries.length;
    const name = normalize(product.name);
    const nameTokens = name === '' ? [] : name.split(' ');
    const manufacturer = product.manufacturer ? normalize(product.manufacturer) : '';

    this.entries.push({
      product,
      name,
      nameTokens,
      nameSkeleton: skeleton(product.name),
      tokenSkeletons: nameTokens.map((token) => skeleton(token)),
      formulaTokens: product.formulaText ? tokenize(product.formulaText) : [],
      manufacturer,
      manufacturerTokens: manufacturer === '' ? [] : manufacturer.split(' '),
      // Strength and form are indexed so a term inside a multi-term query can
      // land on them — "40" onto 40mg, "syrup" onto the syrup. On their own they
      // are a filter, never the query (see MatchTier.Strength / MatchTier.Form).
      strengthTokens: product.strength ? tokenize(product.strength) : [],
      formTokens: product.form ? tokenize(product.form) : [],
      nameLength: name.length,
    });
    this.byId.set(product.id, position);

    // Token postings for prefix search: the name, the salt and the maker are all
    // things a salesman types (Phase 10 §5's result row shows all three).
    const entry = this.entries[position];
    if (!entry) return;

    for (const token of new Set([
      ...entry.nameTokens,
      ...entry.formulaTokens,
      ...entry.manufacturerTokens,
      ...entry.strengthTokens,
      ...entry.formTokens,
    ])) {
      this.sortedTokens.push(`${token} ${position}`);
    }

    push(this.skeletonIndex, entry.nameSkeleton, position);
    for (const tokenSkeleton of entry.tokenSkeletons) {
      push(this.skeletonIndex, tokenSkeleton, position);
    }

    // Trigrams over name + strength only. Including the salt here would make
    // every paracetamol a fuzzy candidate for every other one.
    const fuzzyText = `${product.name} ${product.strength ?? ''}`;
    for (const gram of new Set(trigrams(fuzzyText))) {
      push(this.trigramIndex, gram, position);
    }
  }

  private finalize(): void {
    this.sortedTokens.sort();
  }

  /** Rebuilds with a delta applied — ADR-4's "refreshes on catalog changes". */
  static rebuild(previous: CatalogPayload, delta: CatalogDelta): CatalogPayload {
    return applyDelta(previous, delta);
  }

  resolveBarcode(code: string): SearchHit | undefined {
    // Most specific key first: the code exactly as scanned, then its GTIN.
    const barcode = barcodeKeys(code)
      .map((key) => this.barcodeIndex.get(key))
      .find((candidate) => candidate !== undefined);
    if (!barcode) {
      return undefined;
    }
    const position = this.byId.get(barcode.productId);
    const entry = position === undefined ? undefined : this.entries[position];
    if (!entry) {
      return undefined;
    }
    return {
      product: entry.product,
      tier: MatchTier.Barcode,
      matchedOn: 'barcode',
      stockBase: this.stockOf(entry.product.id),
      unitLevelName: barcode.unitLevelName,
    };
  }

  stockOf(productId: string): number | null {
    return this.stock[productId] ?? null;
  }

  /** PCN-008: expired stock on hand for this product, or null when there is none. */
  expiredOf(productId: string): { qtyBase: number; expiryDate: string } | null {
    return this.expired[productId] ?? null;
  }

  search(rawQuery: string, limit: number = DEFAULT_LIMIT): SearchHit[] {
    // A scan is a keyboard (I1), and a barcode hit bypasses ranking (Phase 10
    // §5). Any single token long enough to be a code is tried as one: a hash
    // lookup costs nothing, and a code with letters in it (a GS1 pack's batch)
    // is still a code. Before, only all-digit input was tried, so a pack code
    // saved exactly as scanned could never be found.
    if (/^\S{6,}$/.test(rawQuery.trim())) {
      const hit = this.resolveBarcode(rawQuery);
      if (hit) {
        return [hit];
      }
    }

    const query = normalize(rawQuery);
    if (query === '') {
      return [];
    }

    // "pan 40", "panadol syrup", "risek 20" — a brand narrowed by its strength
    // or form. The quantity grammar (quantity-grammar.ts) already strips a
    // leading count, so a space that survives to here separates search words,
    // and each must match for the product to (AND, not OR): "pan 40" is
    // pantoprazole *at 40*, not everything called pan plus everything at 40.
    const terms = query.split(' ').filter((term) => term !== '');
    const scored = terms.length > 1 ? this.matchAllTerms(terms) : this.matchTerm(query);

    return this.rank(scored, limit);
  }

  /** Matches one term across every tier, returning its scored candidates. */
  private matchTerm(query: string): Map<number, Match> {
    const scored = new Map<number, Match>();

    const offer = (position: number, tier: MatchTier, matchedOn: MatchedOn, rank: number): void => {
      const existing = scored.get(position);
      if (existing === undefined || tier < existing.tier) {
        scored.set(position, { tier, matchedOn, rank });
      }
    };

    this.gatherPrefixMatches(query, offer);
    this.gatherSkeletonMatches(query, offer);
    if (query.length >= MIN_FUZZY_QUERY_LENGTH) {
      this.gatherFuzzyMatches(query, offer);
    }

    return scored;
  }

  /**
   * Intersects the candidates of every term — a product survives only if all of
   * them matched it somewhere.
   *
   * The surviving match keeps the strongest (lowest) tier any term reached on
   * it, so a name-and-strength hit still ranks as a name hit; ranks sum, so the
   * tightest overall match floats up. The strength/form term is why this exists:
   * on its own it is noise, but paired with a name it is the difference between
   * "pantoprazole" and "pantoprazole 40".
   */
  private matchAllTerms(terms: readonly string[]): Map<number, Match> {
    // Anchor on the longest term — the brand or salt — because it is the most
    // selective and the least likely to be truncated by a gatherer's work
    // ceiling. A short term like "40" or "5" nominates a crowd; verifying it
    // against the anchor's few candidates directly (no ceiling) is both cheaper
    // and correct, where intersecting its capped candidate list would silently
    // drop the very product the anchor found.
    const anchorIndex = longestIndex(terms);
    const anchorTerm = terms[anchorIndex];
    if (anchorTerm === undefined) return new Map();

    const anchor = this.matchTerm(anchorTerm);
    const others = terms.filter((_, index) => index !== anchorIndex);

    const combined = new Map<number, Match>();
    for (const [position, anchorMatch] of anchor) {
      const entry = this.entries[position];
      if (!entry) continue;

      let tier = anchorMatch.tier;
      let rank = anchorMatch.rank;
      let matchedOn = anchorMatch.matchedOn;
      let missing = false;

      for (const term of others) {
        const match = this.termMatchesEntry(term, entry);
        if (match === null) {
          missing = true;
          break;
        }
        rank += match.rank;
        if (match.tier < tier) {
          tier = match.tier;
          matchedOn = match.matchedOn;
        }
      }

      if (!missing) {
        combined.set(position, { tier, matchedOn, rank });
      }
    }
    return combined;
  }

  /**
   * Does one term match one product, and how well? The per-entry counterpart of
   * the gatherers, used to verify the non-anchor terms of a multi-term query
   * against a specific product without any candidate ceiling.
   */
  private termMatchesEntry(term: string, entry: Entry): Match | null {
    if (entry.name === term) return { tier: MatchTier.ExactName, matchedOn: 'name', rank: 0 };
    if (entry.name.startsWith(term)) {
      return {
        tier: MatchTier.NamePrefix,
        matchedOn: 'name',
        rank: entry.nameLength - term.length,
      };
    }
    const wordRank = prefixRank(entry.nameTokens, term);
    if (wordRank !== null)
      return { tier: MatchTier.WordBoundary, matchedOn: 'name', rank: wordRank };

    const formulaRank = prefixRank(entry.formulaTokens, term);
    if (formulaRank !== null) {
      return { tier: MatchTier.Formula, matchedOn: 'formula', rank: formulaRank };
    }
    const makerRank = prefixRank(entry.manufacturerTokens, term);
    if (makerRank !== null) {
      return { tier: MatchTier.Formula, matchedOn: 'manufacturer', rank: makerRank };
    }
    const strengthRank = prefixRank(entry.strengthTokens, term);
    if (strengthRank !== null) {
      return { tier: MatchTier.Strength, matchedOn: 'strength', rank: strengthRank };
    }
    const formRank = prefixRank(entry.formTokens, term);
    if (formRank !== null) return { tier: MatchTier.Form, matchedOn: 'form', rank: formRank };

    const key = skeleton(term);
    if (key !== '' && (entry.nameSkeleton === key || entry.tokenSkeletons.includes(key))) {
      return { tier: MatchTier.Fuzzy, matchedOn: 'name', rank: 0 };
    }

    const tolerance = distanceTolerance(term.length);
    if (tolerance > 0) {
      let best = boundedDistance(term, entry.name, tolerance);
      if (best > tolerance) {
        for (const token of entry.nameTokens) {
          const distance = boundedDistance(term, token, tolerance);
          if (distance < best) best = distance;
          if (best === 0) break;
        }
      }
      if (best <= tolerance) return { tier: MatchTier.Fuzzy, matchedOn: 'name', rank: best };
    }
    return null;
  }

  /** Orders scored candidates by the ranking ladder and returns the top page. */
  private rank(scored: Map<number, Match>, limit: number): SearchHit[] {
    return [...scored.entries()]
      .map(([position, match]) => ({ entry: this.entries[position], match }))
      .filter((row): row is { entry: Entry; match: NonNullable<typeof row.match> } =>
        Boolean(row.entry),
      )
      .sort((a, b) => {
        if (a.match.tier !== b.match.tier) return a.match.tier - b.match.tier;
        if (a.match.rank !== b.match.rank) return a.match.rank - b.match.rank;
        // Shorter names are more specific: "Panadol" before "Panadol Extra".
        if (a.entry.nameLength !== b.entry.nameLength) {
          return a.entry.nameLength - b.entry.nameLength;
        }
        return a.entry.name.localeCompare(b.entry.name);
      })
      .slice(0, limit)
      .map(({ entry, match }) => ({
        product: entry.product,
        tier: match.tier,
        matchedOn: match.matchedOn,
        stockBase: this.stockOf(entry.product.id),
      }));
  }

  /** Exact, name-prefix and word-boundary tiers, via one binary-searched range. */
  private gatherPrefixMatches(
    query: string,
    offer: (position: number, tier: MatchTier, matchedOn: MatchedOn, rank: number) => void,
  ): void {
    let scanned = 0;
    for (let i = lowerBound(this.sortedTokens, query); i < this.sortedTokens.length; i += 1) {
      const packed = this.sortedTokens[i];
      if (packed === undefined || !packed.startsWith(query)) {
        break;
      }
      // Widest for one-character queries, which is exactly when the ceiling
      // matters and when ranking beyond the first page is meaningless anyway.
      if ((scanned += 1) > MAX_PREFIX_SCAN) {
        break;
      }

      const separator = packed.indexOf(' ');
      const position = Number(packed.slice(separator + 1));
      const token = packed.slice(0, separator);
      const entry = this.entries[position];
      if (!entry) continue;

      if (entry.name === query) {
        offer(position, MatchTier.ExactName, 'name', 0);
      } else if (entry.name.startsWith(query)) {
        offer(position, MatchTier.NamePrefix, 'name', entry.nameLength - query.length);
      } else if (entry.nameTokens.includes(token)) {
        offer(position, MatchTier.WordBoundary, 'name', token.length - query.length);
      } else if (entry.formulaTokens.includes(token)) {
        offer(position, MatchTier.Formula, 'formula', token.length - query.length);
      } else if (entry.manufacturerTokens.includes(token)) {
        offer(position, MatchTier.Formula, 'manufacturer', token.length - query.length);
      } else if (entry.strengthTokens.includes(token)) {
        offer(position, MatchTier.Strength, 'strength', token.length - query.length);
      } else if (entry.formTokens.includes(token)) {
        offer(position, MatchTier.Form, 'form', token.length - query.length);
      }
    }
  }

  private gatherSkeletonMatches(
    query: string,
    offer: (position: number, tier: MatchTier, matchedOn: MatchedOn, rank: number) => void,
  ): void {
    const key = skeleton(query);
    if (key === '') {
      return;
    }
    const postings = this.skeletonIndex.get(key) ?? [];
    // Bounded like every other gatherer: a very common skeleton must not turn a
    // keystroke into a catalog walk.
    for (const position of postings.slice(0, MAX_SKELETON_CANDIDATES)) {
      offer(position, MatchTier.Fuzzy, 'name', 0);
    }
  }

  /**
   * Trigram-prefiltered fuzzy matching.
   *
   * The catalog is never scanned. Postings nominate candidates, overlap count
   * orders them, and only the strongest few hundred are measured — so the cost
   * of a keystroke is set by MAX_FUZZY_CANDIDATES, not by catalog size.
   */
  private gatherFuzzyMatches(
    query: string,
    offer: (position: number, tier: MatchTier, matchedOn: MatchedOn, rank: number) => void,
  ): void {
    const tolerance = distanceTolerance(query.length);
    if (tolerance === 0) {
      return;
    }

    const grams = [...new Set(trigrams(query))];
    if (grams.length === 0) {
      return;
    }

    // Rarest trigrams first, so the posting budget is spent where it
    // discriminates most, and stopword postings are skipped outright. Without
    // both, this loop walks a slice of the catalog and the whole design is
    // linear again.
    const postings = grams
      .map((gram) => this.trigramIndex.get(gram))
      .filter(
        (posting): posting is number[] =>
          posting !== undefined && posting.length <= MAX_POSTING_LENGTH,
      )
      .sort((a, b) => a.length - b.length);

    const overlap = new Map<number, number>();
    let visited = 0;
    for (const posting of postings) {
      if (visited >= POSTING_BUDGET) break;
      for (const position of posting) {
        overlap.set(position, (overlap.get(position) ?? 0) + 1);
      }
      visited += posting.length;
    }

    // Threshold rather than sort: a full sort of the overlap map is itself
    // catalog-sized work per keystroke.
    const required = Math.max(1, Math.ceil(grams.length * MIN_OVERLAP_SHARE));
    const candidates: number[] = [];
    for (const [position, shared] of overlap) {
      if (shared >= required) {
        candidates.push(position);
        if (candidates.length >= MAX_FUZZY_CANDIDATES) break;
      }
    }

    for (const position of candidates) {
      const entry = this.entries[position];
      if (!entry) continue;

      let best = tolerance + 1;
      const whole = boundedDistance(query, entry.name, tolerance);
      if (whole < best) best = whole;

      if (best > tolerance) {
        for (const token of entry.nameTokens) {
          const distance = boundedDistance(query, token, tolerance);
          if (distance < best) best = distance;
          if (best === 0) break;
        }
      }

      if (best <= tolerance) {
        offer(position, MatchTier.Fuzzy, 'name', best);
      }
    }
  }
}

/* ========================================================================== */
/* Delta application                                                           */
/* ========================================================================== */

export interface CatalogDelta {
  readonly products: readonly IndexedProduct[];
  /** Products that went inactive and must leave the index. */
  readonly removedProductIds: readonly string[];
  readonly barcodes: readonly IndexedBarcode[];
  readonly removedBarcodes: readonly string[];
  readonly stock: StockSnapshot;
  readonly expired?: ExpiredSnapshot;
  readonly syncedAt: string;
}

/**
 * Merges a delta into a cached payload.
 *
 * This is what keeps a 3,000-product catalog cheap to keep current: a corrected
 * price ships one row, not the whole catalog. Pure, so it is testable without
 * IndexedDB.
 */
export function applyDelta(previous: CatalogPayload, delta: CatalogDelta): CatalogPayload {
  const removed = new Set(delta.removedProductIds);
  const products = new Map<string, IndexedProduct>();

  for (const product of previous.products) {
    if (!removed.has(product.id)) {
      products.set(product.id, product);
    }
  }
  for (const product of delta.products) {
    if (removed.has(product.id)) continue;
    products.set(product.id, product);
  }

  const droppedBarcodes = new Set(delta.removedBarcodes.map(normalizeBarcode));
  const barcodes = new Map<string, IndexedBarcode>();
  for (const barcode of previous.barcodes) {
    const key = normalizeBarcode(barcode.barcode);
    if (!droppedBarcodes.has(key) && !removed.has(barcode.productId)) {
      barcodes.set(key, barcode);
    }
  }
  for (const barcode of delta.barcodes) {
    const key = normalizeBarcode(barcode.barcode);
    if (droppedBarcodes.has(key) || removed.has(barcode.productId)) continue;
    barcodes.set(key, barcode);
  }

  return {
    products: [...products.values()],
    barcodes: [...barcodes.values()],
    // Stock arrives whole on every refresh; it has no per-row clock to merge on.
    stock: delta.stock,
    expired: delta.expired ?? {},
    syncedAt: delta.syncedAt,
  };
}

/* ========================================================================== */

/** Index of the longest term — ties resolve to the first, which is stable. */
function longestIndex(terms: readonly string[]): number {
  let best = 0;
  for (let i = 1; i < terms.length; i += 1) {
    if ((terms[i]?.length ?? 0) > (terms[best]?.length ?? 0)) best = i;
  }
  return best;
}

/**
 * The rank of the best token in `tokens` that starts with `term`, or null when
 * none does. Rank is the excess length of the matched token, so a closer prefix
 * (a shorter surrounding token) ranks first — the same rule the gatherers use.
 */
function prefixRank(tokens: readonly string[], term: string): number | null {
  let best: number | null = null;
  for (const token of tokens) {
    if (token.startsWith(term)) {
      const rank = token.length - term.length;
      if (best === null || rank < best) best = rank;
    }
  }
  return best;
}

function push(index: Map<string, number[]>, key: string, position: number): void {
  const existing = index.get(key);
  if (existing) {
    existing.push(position);
  } else {
    index.set(key, [position]);
  }
}

/** First index whose value is >= `target`. */
function lowerBound(sorted: readonly string[], target: string): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((sorted[mid] ?? '') < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export function normalizeBarcode(code: string): string {
  return code.trim().replace(/\s+/g, '');
}
