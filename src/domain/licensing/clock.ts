/**
 * The licence clock — pure, and the part of this design that was wrong twice.
 *
 * ## The threat model, which is asymmetric
 *
 * Rolling a clock **backwards** extends an entitlement: that is the attack.
 * Rolling it **forwards** expires the attacker sooner: that is self-harm, never
 * an exploit — it happens to honest shops with dead CMOS batteries, not to
 * pirates. An earlier revision defended the forward direction by refusing to
 * degrade, which bought nothing against any adversary and made an entitlement
 * indefinite for any installation that simply stopped trading. The ledger cannot
 * advance when nothing happens, so it can never prove that time has passed.
 *
 * ## The anchors
 *
 * `businessNow` is `max()` of all of them. No clamp, no branch, no
 * refuse-to-degrade — a clock anomaly must never withhold the end of the
 * evaluation window (decision D5). Under PCN-006 the clock is consulted ONLY
 * while an installation is unlicensed; an authorized licence is resolved before
 * `businessNow` is ever read, so nothing here participates once a valid bound
 * licence exists.
 *
 *   - `systemNow`     advances on an idle machine. The ELAPSE guarantee (D5a);
 *                     nothing else in an offline install can supply it.
 *   - `witness`       the corroborated clock witness. Makes `systemNow` safe to
 *                     trust by making it monotonic. Kills rollback.
 *   - `ledgerHighWater`  newest event row. Defence in depth if the witness table
 *                     were deleted but the sales ledger survived.
 *   - `installationFirstSeenAt`  covers a brand-new install.
 *
 * ## Why the witness is corroborated rather than maximal
 *
 * Reading it as `max(observed_at)` is poisoned **permanently by one row**: a
 * boot with a failing CMOS battery reading 2099 writes one observation, `max()`
 * makes it authoritative forever, and append-only integrity means it cannot be
 * deleted. The owner correcting Windows a minute later would change nothing.
 *
 * The signal that separates a fault from real time is not the value, it is the
 * shape: real time accrues **continuously**, a fault arrives as a
 * **discontinuity**. So the witness is the K-th largest observation, and a lone
 * outlier is never authoritative (Invariant L5).
 *
 * That costs nothing in rollback protection, because **K-th largest is still
 * monotone under insertion**: a new value below the current K-th leaves the
 * top-K untouched, and one above it displaces a smaller member. An attacker can
 * only add rows, so no sequence of writes can lower the witness.
 *
 * A fault that persisted long enough to be corroborated is bounded by the
 * `ceiling` argument to `corroboratedWitness` — a compensating record, T2
 * applied to time. Never by deletion. (Under PCN-006 the ceiling is unused in
 * practice, since a persistent forward fault can only shorten a pirate's own
 * free evaluation — self-harm, never an exploit — but the mechanism is kept.)
 */

/**
 * How many observations must agree before a reading becomes authoritative.
 *
 * At the 6-hour write interval and typical shop uptime this is roughly two days
 * of operation — comfortably longer than "noticed it and fixed the date", and
 * comfortably shorter than a clock nobody has looked at in a week.
 *
 * Tunable without a format change. `1` reinstates the poisoning bug, which is
 * what `clock.test.ts` asserts by setting it.
 */
export const WITNESS_CORROBORATION = 5;

/** How often the Node records what the system clock says. */
export const WITNESS_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * How far ahead of the other anchors `systemNow` may run before we say so.
 *
 * A display threshold, not a security parameter: it changes what the banner and
 * the support bundle SAY, never what the tier IS.
 */
export const CLOCK_ANOMALY_DAYS = 180;

const DAY_MS = 86_400_000;

export interface ClockAnchors {
  readonly systemNow: Date;
  /** `max(observed_at)` is NOT this — see `corroboratedWitness`. */
  readonly witness?: Date | undefined;
  readonly ledgerHighWater?: Date | undefined;
  readonly installationFirstSeenAt?: Date | undefined;
}

function latest(dates: ReadonlyArray<Date | undefined>): Date | undefined {
  let best: Date | undefined;
  for (const date of dates) {
    if (date === undefined || Number.isNaN(date.getTime())) continue;
    if (best === undefined || date.getTime() > best.getTime()) best = date;
  }
  return best;
}

/**
 * The corroborated witness: the K-th largest observation at or below any signed
 * ceiling (Invariant L5).
 *
 * Returns `undefined` when fewer than K observations survive the ceiling. A
 * brand-new install has no past to be rolled back to, and the other four anchors
 * cover it — so contributing nothing is both safe and the honest answer.
 */
export function corroboratedWitness(
  observations: readonly Date[],
  options: {
    readonly ceiling?: Date | undefined;
    readonly corroboration?: number | undefined;
  } = {},
): Date | undefined {
  const corroboration = options.corroboration ?? WITNESS_CORROBORATION;
  if (corroboration < 1) return undefined;

  const ceilingMs = options.ceiling?.getTime();
  const eligible = observations
    .filter((o) => !Number.isNaN(o.getTime()))
    .filter((o) => ceilingMs === undefined || o.getTime() <= ceilingMs)
    .map((o) => o.getTime())
    .sort((a, b) => b - a);

  if (eligible.length < corroboration) return undefined;
  return new Date(eligible[corroboration - 1] as number);
}

/**
 * `max()` of the five anchors. One line, no branches — deliberately.
 *
 * Every branch previous revisions added here turned out to be a way for a clock
 * anomaly to withhold a lapse. There is nothing to add.
 */
export function businessNow(anchors: ClockAnchors): Date {
  return (
    latest([
      anchors.systemNow,
      anchors.witness,
      anchors.ledgerHighWater,
      anchors.installationFirstSeenAt,
    ]) ?? anchors.systemNow
  );
}

/**
 * Two-sided, because the one-sided version could not see the poisoning case at
 * all: with a poisoned witness `systemNow` is BEHIND it, so a "system far ahead"
 * test returns false and the installation reads as a rollback.
 *
 * `system_behind` has two causes that are genuinely indistinguishable at one
 * instant — a rollback, and a witness poisoned by a past fault. The software
 * does not guess (decision D5e): the banner states both dates it can see, and
 * the support bundle carries the observation histogram so a human can tell a
 * spike from a dense run.
 */
export type ClockDisagreement = 'none' | 'system_ahead' | 'system_behind';

export function clockDisagreement(
  anchors: ClockAnchors,
  anomalyDays: number = CLOCK_ANOMALY_DAYS,
): ClockDisagreement {
  const others = latest([
    anchors.witness,
    anchors.ledgerHighWater,
    anchors.installationFirstSeenAt,
  ]);
  if (others === undefined) return 'none';

  const system = anchors.systemNow.getTime();
  if (system > others.getTime() + anomalyDays * DAY_MS) return 'system_ahead';
  if (system < others.getTime()) return 'system_behind';
  return 'none';
}

/**
 * Whether to write an observation now.
 *
 * At boot, always — a machine that has been off for three months must re-anchor
 * as soon as it comes back, and the interval alone would not do that. Otherwise
 * only once the interval has elapsed.
 *
 * Never writes a row older than the newest observation: an observation behind
 * what is already recorded adds nothing (the witness is monotone anyway) and
 * would only pad the top-K with noise.
 */
export function shouldObserve(input: {
  readonly systemNow: Date;
  readonly newestObservation?: Date | undefined;
  readonly reason: 'boot' | 'interval';
}): boolean {
  const newest = input.newestObservation?.getTime();
  if (newest === undefined) return true;
  if (input.systemNow.getTime() <= newest) return false;
  if (input.reason === 'boot') return true;
  return input.systemNow.getTime() - newest >= WITNESS_INTERVAL_MS;
}

/**
 * When the unlicensed installation's 30-day evaluation started.
 *
 * `min()` is the point, and it is what closes the evaluation-reset hole:
 * deleting `installation.json` does not help, because the database still
 * remembers, and the earliest event row cannot be rewritten by the application
 * at all. Resetting the evaluation therefore requires destroying the pharmacy's
 * own records — and copying a licensed install yields `unbound`, not a fresh
 * evaluation, so there is nothing to reset there either.
 */
export function evaluationAnchor(sources: {
  readonly tenantCreatedAt?: Date | undefined;
  readonly installationFirstSeenAt?: Date | undefined;
  readonly earliestEvent?: Date | undefined;
  readonly earliestObservation?: Date | undefined;
  readonly fallback: Date;
}): Date {
  let best: Date | undefined;
  for (const date of [
    sources.tenantCreatedAt,
    sources.installationFirstSeenAt,
    sources.earliestEvent,
    sources.earliestObservation,
  ]) {
    if (date === undefined || Number.isNaN(date.getTime())) continue;
    if (best === undefined || date.getTime() < best.getTime()) best = date;
  }
  return best ?? sources.fallback;
}
