# Phase 6 — Medicine Catalog & Master Data Strategy

Status: Draft for review
Informed by: Phases 1, 3, 5

The catalog is a strategic asset, not a lookup table: it is the thing that gets harder for competitors to match with every pharmacy onboarded, and the difference between a demo that starts selling in minutes and one that starts with data entry.

---

## 1. The problem, stated honestly

Competitors ship 25,000–30,000 preloaded items (MARS, Moneypex). DRAP's public database provides identity for registered drugs — brand, form, composition, registration number, manufacturer — but no pack structures, no retail prices, and no barcodes, and it is explicitly provisional. The three fields a counter actually needs to sell (pack structure, price, barcode) are exactly the fields no public source provides. Barcode coverage among Pakistani manufacturers is inconsistent; MRPs change by government notification. A "complete" preloaded catalog is therefore not downloadable — it must be assembled, and it decays without maintenance.

## 2. Architecture: two layers

**Global Catalog (Mehvar-owned).** Product identities: name, manufacturer, formula/salt, form, strength, known pack structures, known barcodes, reference MRP where known. Shared across all tenants, curated by Mehvar. Contains no tenant data, no prices-as-charged, no sales information — identity only.

**Tenant Catalog (pharmacy-owned).** The pharmacy's actual products: what they stock, their selling prices, their minimum levels, their quick-added items. A tenant product may *link* to a global entry (inheriting identity and future identity corrections) or stand alone (quick items, local products, general retail goods). Prices and stock are always tenant-only.

This split is what makes the network effect possible without ever sharing a pharmacy's commercial data — a line the trust posture (T3) does not permit crossing.

## 3. Cold start: the launch catalog

A pre-launch data project, time-boxed and honest about scope:

1. **Seed identity from DRAP** for breadth (~25k+ registered products): name, manufacturer, composition, form. Machine-imported, marked as unverified reference data.
2. **Curate the head of the market by hand:** the top ~1,500–3,000 fastest-moving SKUs (the Panadols, Augmentins, Brufens, common syrups, injections, and the general-retail staples) get verified pack structures, unit hierarchies, and current MRPs. This is the set that makes the demo sing; a typical counter's daily sales concentrate overwhelmingly here. Sources: distributor price lists, pack inspection, the reference pharmacy's shelves.
3. **Import tooling** for competitor exports and distributor lists (CSV): mapping assistant, duplicate detection against the global catalog, review-before-commit. This converts a competitor's install base into a migration path.
4. **Barcodes accumulate operationally** (see §4); launch does not depend on barcode coverage.

Launch gate: the curated head (2), not the full seed (1). The seed can grow post-launch without blocking anything.

## 4. The compounding loop

Every pharmacy operation enriches the asset:

- **Unknown barcode scanned** → five-second link to a product → barcode joins the tenant product; identity-level barcode is proposed upward to the global catalog.
- **Quick item completed** by an owner → candidate global entry if it matches no existing identity.
- **Purchase entry** captures current MRPs in the wild → aggregate MRP drift signals for curation (identity-level only, never tenant pricing).
- Founder-side curation reviews proposals; nothing enters the global catalog uncurated, because the catalog's value is that it can be trusted.

Global updates flow down as *suggestions* to linked tenant products (new barcode known, MRP notification, corrected composition) — accepted by the tenant, never forced. A pharmacy's catalog is never silently rewritten under it (P8 in data form).

## 5. Maintenance & ownership

- Curation is a founder responsibility in V1; time-boxed weekly, driven by the proposal queue.
- MRP notifications (DRAP price revisions) are tracked manually at first; tooling only when volume demands it (P6).
- Data quality states are explicit: *verified* (curated), *reference* (seeded, unreviewed), *tenant-only*. The counter never needs to care; the curation queue does.

## 6. Risks

1. **Curation bottleneck:** the head-of-market set slips and launch demos feel empty. Mitigation: hard scope (the ~2k list drawn from the reference pharmacy's actual shelf + one distributor's fast-mover list), started before implementation week.
2. **Seed pollution:** DRAP data contains duplicates/stale entries. Mitigation: reference-tier marking; never auto-link tenant products to unverified seeds.
3. **Contribution noise:** bad barcode links propagate. Mitigation: curated promotion only; provenance kept per contribution.

## 7. Exports to later phases

- Phase 7: unknown-barcode and quick-item flows; purchase-entry MRP capture.
- Phase 8 (ADR): global/tenant catalog linkage and update-propagation mechanics; search operates over the *tenant* catalog with global fallback for adds.
- Phase 12/13: launch-catalog data project scheduled as a pre-implementation track (it does not consume implementation-week time).
