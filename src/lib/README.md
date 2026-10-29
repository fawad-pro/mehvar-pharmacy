# `src/lib` — branded types and unit arithmetic

The two sacred units and the only sanctioned arithmetic over them (Phase 11 §2).

| File              | Role                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `branded.ts`      | `Paisa`, `BaseQty`, `PackFactor` — raw `number` never crosses a domain boundary for money or stock.         |
| `money.ts`        | Integer-paisa arithmetic and formatting. Rounding happens here or nowhere.                                  |
| `quantity.ts`     | Base-unit arithmetic and pack-level conversion — **the only place multiplication by pack factors happens.** |
| `business-day.ts` | Tenant-local business day (Phase 9 §1), Asia/Karachi by default.                                            |
| `expiry.ts`       | Expiry as month and year (PCN-017): the only parser from typed text, and `MM/YYYY` for display.             |

Phase 5 §2: all stock arithmetic happens in base units. "3 strips + 4 tablets"
is stored and computed as 34 tablets; presentation converts back. That single
rule eliminates the classic sub-unit corruption bug.

Phase 9 §1: all money is integer paisa. No floats anywhere near money.
