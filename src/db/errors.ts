/**
 * Database error shapes worth naming.
 *
 * Lives in `src/db` because a SQLSTATE is a database concern, and because both
 * the sale action and sync ingestion need to tell "this receipt number is
 * taken" apart from "the database is unreachable" — one is re-minted and
 * retried, the other is waited out.
 *
 * Inspecting a `code` property is not importing `pg`, so the ADR-2 lint rule is
 * satisfied by callers either way; keeping the knowledge here means there is
 * one place that knows what `23505` means.
 */

/** SQLSTATE 23505 — unique_violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Drizzle wraps driver errors, sometimes more than once, so the cause chain is
 * walked rather than the top-level error inspected.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { code?: string; cause?: unknown };
    if (candidate.code === UNIQUE_VIOLATION) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
