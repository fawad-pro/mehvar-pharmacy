# Phase 4 — Principles & Product Identity

Status: Draft for review
Informed by: Phases 1–3

This document operationalizes the Charter's philosophy into rules that win arguments during design and implementation, then defines the product's identity: values, personality, design direction, and naming direction.

---

## 1. Product Principles

Each principle includes its test — the question that settles a dispute.

**P1. The counter outranks everything.** When two designs conflict, the one that makes the sale moment faster or calmer wins. *Test: does this change add even one second or one decision to a routine sale?*

**P2. Never block a sale.** Missing catalog entry, ambiguous price, network drop, unknown barcode — every blocking moment must have a designed fast path that keeps the customer moving and reconciles the record afterward. *Test: name the moment this feature could stop a sale; show its escape hatch.*

**P3. Faster than paper, or more trustworthy than paper — ideally both.** Paper is the incumbent. Every workflow must beat the register on speed, or beat it so decisively on trust that the trade is obvious to the salesman, not just the owner. *Test: walk the paper version of this task; time both.*

**P4. Numbers that can't lie.** No silent edits anywhere. Corrections are visible as corrections, adjustments carry reasons, and every balance answers "why is this number what it is?" on demand. *Test: can any user change any figure without leaving a visible trace? If yes, the design is wrong.*

**P5. One obvious way.** Every task has exactly one primary path, discoverable without training. Settings, modes, and configurability are treated as failures of decision-making until proven otherwise. *Test: did we add an option because users need it, or because we couldn't decide?*

**P6. Earn every feature.** Nothing enters V1 without a named daily task it accelerates. "Useful someday" goes to Future Considerations. *Test: which of the day-at-the-counter moments (Phase 1 §5) does this serve?*

**P7. The salesman is the bar.** A non-technical operator, comfortable in Roman Urdu, learns any workflow in minutes and runs it at rush hour. If training is required, the design failed. *Test: could a new hire run this on day one having watched it done twice?*

**P8. The shop opens tomorrow.** The pharmacy's ability to trade is never hostage to our operations. Updates, deployments, migrations, and recovery procedures are designed so the counter works every morning, unconditionally — changes land quietly, never mid-rush, and never require the pharmacy to do anything to keep selling. *Test: describe the worst thing that can happen on our side tonight; show why the counter still sells at 9am.*

## 2. Interaction Principles

**I1. Keyboard-first, shortcuts visible.** The entire sale — search, add, quantity, discount, payment, print — completes without the mouse. Shortcuts are printed on the interface itself, not hidden in help. The scanner is a keyboard: a scan anywhere sensible does the right thing.

**I2. Speed is a requirement, calibrated at implementation.** Search feels instant, returning useful results within the first few keystrokes and with minimal typing. A routine repeat cash sale completes in well under half a minute — the working target is around fifteen seconds. Screen transitions are imperceptible; receipt printing starts without a pause the customer notices. Exact numeric budgets are set and verified during implementation against real hardware; the expectation of near-instant response is not negotiable, the specific benchmark is.

**I3. Forgiving input.** Misspellings resolve (prescriptions are handwritten; salesmen transcribe). Quantities accept "2 strips" thinking, not database thinking. Sensible defaults everywhere; the common case pre-selected.

**I4. One primary action per screen.** Every screen answers "what do I do here?" with one visually dominant action. Secondary actions exist quietly.

**I5. Prevent errors; don't scold.** Design makes wrong states hard to reach. When intervention is needed, the message says what to do next, in plain words, without jargon or blame.

**I6. Glanceable numbers.** Prices, totals, balances, and stock levels are large, tabular, and unambiguous at arm's length in a bright shop. The owner's three numbers (today's sale, today's cash, what's running out) are never more than one action away.

**I7. Calm under density.** The sale screen carries real information density without visual noise: strong hierarchy, restrained color, semantic states only (expiry warnings, low stock, unsynced records) — color always means something.

## 3. Trust Principles

**T1. The owner sees everything; the system forgets nothing.** Every void, discount, adjustment, and price override is visible in the owner's daily view, attributed and timestamped.

**T2. Corrections, not erasures.** Mistakes are reversed by compensating entries that reference what they fix. The original always remains visible.

**T3. The data is the customer's.** Full export, always available, even in suspension. This is a sales argument, a retention ethic, and the honest answer to "where are my numbers?"

**T4. Show the math.** Any derived figure — a balance, a total, a stock count — can be expanded into the transactions that produced it. Udhaar disputes end by showing the screen.

**T5. Print like a business.** The receipt is the pharmacy's public face and the product's daily advertisement. It is professional, legible, and correct, every time.

## 4. Brand Values & Personality

**Values: Bharosa (trust), Raftaar (speed), Saadgi (simplicity).** In that order — trust is bought, speed is felt, simplicity is how both are delivered.

**Personality:** the ideal senior salesman — quick, accurate, unflappable, respectful, no wasted words. Never playful at the counter, never bureaucratic, never condescending. The product is confident enough to be plain.

**Voice:** short sentences, concrete words, sentence case, no exclamation marks. English UI baseline with Roman Urdu where it lands more naturally in microcopy and marketing ("Udhaar" is the feature's name — not "Credit Management"). Numbers are always the loudest thing on the screen.

## 5. Design Direction

- **Feel:** premium-clean and calm; the quality gap versus incumbents should be visible in a screenshot before a single click.
- **Its own face within the family.** Mehvar Pharmacy shares the Mehvar wordmark logic and quality bar but carries its own palette and personality — no reuse of the hospital product's royal blue/mint. Family coherence at the brand level, product distinctness at the interface level.
- **Palette direction:** deep green anchor (pharmacy association, trust, "sehat") with warm neutrals and a restrained accent; semantic red/amber reserved exclusively for expiry and stock warnings so alarm colors keep meaning.
- **Typography:** a highly legible grotesk with strong tabular numerals (candidates: Inter, IBM Plex Sans); numerals are the brand's real typeface — prices, totals, and balances must render beautifully and align in columns.
- **Layout:** generous hit targets, high contrast for bright shops and aging screens, density where work happens and whitespace where decisions happen.
- Final tokens, exact palette values, and component language are Phase 10 (IA & Screens) work; this direction is binding on that work.

## 6. Brand Architecture

**Decision: this product joins the Mehvar family as "Mehvar Pharmacy."** A standalone brand (candidates evaluated: Amanat, Meezan, Rasid, Sahih) was considered and set aside.

Rationale: a solo founder can build one brand well or two brands poorly. Every pharmacy demo, receipt footer, and reference story should compound into the same name that hospital demos compound into. "Mehvar" carries the right meaning for a family (axis — the thing operations turn on), survives Roman Urdu conversation naturally ("humne Mehvar lagaya hai"), and positions the company as a healthcare operations software house rather than a one-product shop — which strengthens both products' credibility with buyers who ask "who else uses your software?" The honest caveat: Mehvar's brand equity today is one hospital deep, so the compounding benefit is forward-looking, not inherited. That is acceptable; brand architecture is a decision about where value accumulates, and one account is the right one.

Structure:
- **Mehvar** — master brand: the company and the trust mark. One wordmark logic, one voice foundation.
- **Mehvar Pharmacy** — this product. Full name in formal contexts; "Mehvar" alone at the counter and in conversation.
- The hospital product's own naming within the family is settled on the Mehvar side; nothing here constrains it.
- Future products follow the same pattern: Mehvar + plain descriptor. No sub-brand ever gets its own invented name.

Each family member keeps its own visual identity and personality within shared brand foundations: Mehvar Pharmacy's deep green palette, counter-native voice, and salesman-first personality are its own; the wordmark construction, quality bar, and trust posture are the family's. Domain strategy follows the parent (the product lives under the Mehvar domain, e.g. pharmacy.mehvar.app when that domain activates); no separate domain purchase is needed.

## 7. Enforcement

These principles are cited by number in later phases and in implementation reviews ("violates P2", "fails I2 budget"). Any deliberate exception is recorded as a decision with a reason, in the ADR log, not absorbed silently.
