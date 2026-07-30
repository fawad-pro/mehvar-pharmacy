# `src/client` — counter-side machinery

The browser half of the counter's resilience and speed (Phase 11 §1). Everything
here exists because a round trip is either too slow (ADR-4) or unavailable
(ADR-3).

| Module      | Owns                                                                        | Session |
| ----------- | --------------------------------------------------------------------------- | ------- |
| `search/`   | The local index: build, rank, fuzzy match (ADR-4, Phase 10 §5)              | 2       |
| `sync/`     | Offline queue, idempotent replay (ADR-3)                                    | 5       |
| `keyboard/` | The global key map (Phase 10 §3) — **one registry**, not scattered handlers | 1       |
| `print/`    | Receipt render for 80mm/58mm thermal (ADR-6, Phase 10 §7)                   | 4       |

## Non-negotiables

- **`search/`** serves the tenant catalog from memory. Every keystroke searches
  locally; latency is effectively zero, and Phase 10 §5's ranking ladder is a
  table-driven test surface. Index staleness is bounded and harmless — prices are
  confirmed at commit.
- **`sync/`** never merges. Append-only events with client-generated IDs make
  sync delivery-only: there is nothing to reconcile, only to deliver, and
  replaying the same client-ID batch N times must produce exactly-once effects.
  Offline scope is exactly W1, W2, W3, W6 — cash sales, udhaar sales,
  settlements, quick items. Everything else says "needs internet — selling keeps
  working" (Phase 10 §8).
- **`sync/`** shares its commit contract type with `domain/sales`, and offline
  records are ingested through the _same_ domain writer (ADR-5).
- **`print/`** renders from committed-local state, so the receipt prints
  instantly whether or not the server has heard about the sale yet (ADR-3).
- **`keyboard/`** is the reason the key bar can be trusted furniture: one
  registry means the printed shortcut and the bound handler cannot drift apart.
