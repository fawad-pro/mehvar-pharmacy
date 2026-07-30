# `src/domain` — the core

Pure business logic, one module per concept (Phase 11 §1). This is where the
product's promises are actually kept.

## Rules

- **`domain/` never imports from `app/` or `components/`** — or from any
  framework code. Enforced by lint (`eslint.config.mjs`).
- **Every DB touch goes through `db/scoped.ts`** (ADR-2). Also enforced by lint.
- **Pure or transactional — never half** (Phase 11 §2). Pure calculators (totals,
  FEFO planning, balance math) take data in and return data out. Transactional
  writers (`commitSale`, `ingestSyncedSale`, `receivePurchase`, `adjustStock`)
  own their transaction boundary whole; no caller composes partial writes.
- **Typed results, not thrown errors.** Writers return `ok | rejected(reason)`;
  throwing is reserved for bugs. The UI maps reasons to I5 messages — no error
  strings are composed in domain code.
- **No domain API updates an event row** (ADR-1). Compensating writers only. The
  two sanctioned mutations in the whole system — allocation resolution and
  `batches.qty_remaining` — exist as named functions in `inventory/` and nowhere
  else (ADR-8, Phase 9 §5.1).
- **Vocabulary is Phase 5's, verbatim**: `Batch`, `Allocation`, `PendingLayer`,
  `CashMovement`, `QuickItem`. No synonyms.

## Modules and the sessions that fill them

| Module       | Owns                                                                                    | Session |
| ------------ | --------------------------------------------------------------------------------------- | ------- |
| `sales/`     | `commitSale()` — the one transaction (Phase 9 §5.3), returns (W4)                       | 3, 4, 7 |
| `purchases/` | `receivePurchase()`, batch materialization, price capture at receiving (W7)             | 6       |
| `inventory/` | FEFO allocation, pending-layer resolution, rebuild + verify (ADR-5/8), adjustments (W8) | 3, 6    |
| `udhaar/`    | Balance derivation, settlements (W2/W3)                                                 | 4       |
| `cash/`      | Cash movements, drawer position (W10)                                                   | 7       |
| `catalog/`   | Tenant catalog, global linkage, proposals (Phase 6)                                     | 2       |
| `reporting/` | The derived views' query layer (Phase 9 §7)                                             | 7       |

`sales/` and `client/sync/` share the commit contract type, so online and
offline are provably the same shape — ADR-5's "one code path".
